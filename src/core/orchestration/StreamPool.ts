import { WaveApprovalMetadata } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"
import { OrchestrationController } from "./OrchestrationController"
import { StreamCoordinator } from "./StreamCoordinator"
import { KaizenSystem } from "./systems/KaizenSystem"
import type { KanbanTask } from "./systems/KanbanSystem"
import { type WorkerResult, WorkerStream } from "./WorkerStream"

/**
 * StreamPool: Central concurrency manager for MAS parallel builds.
 *
 * Governs how many WorkerStreams run simultaneously using a semaphore-based
 * concurrency limiter. Each worker executes a single Kanban task within
 * its own isolated child stream.
 *
 * Tier 5: Swarm-Parallel Execution — the next evolution of the MAS pipeline.
 */
export interface StreamPoolOptions {
	/** Maximum number of concurrent workers. Default: 3 */
	maxConcurrency?: number
	/** The parent stream ID for linking child streams. */
	parentStreamId: string
	/** User identity for BroccoliDB scoping. */
	userId?: string
	/** Workspace identity for BroccoliDB scoping. */
	workspaceId?: string
}

export interface StreamPoolResult {
	totalTasks: number
	completed: number
	failed: number
	results: WorkerResult[]
	durationMs: number
}

export class StreamPool {
	private name = "StreamPool"
	private maxConcurrency: number
	private coordinator: StreamCoordinator
	private userId: string
	private workspaceId: string
	private parentStreamId: string

	constructor(
		private controller: OrchestrationController,
		private apiHandler: ApiHandler,
		options: StreamPoolOptions,
	) {
		this.maxConcurrency = options.maxConcurrency ?? 3
		this.parentStreamId = options.parentStreamId
		this.userId = options.userId ?? "anonymous"
		this.workspaceId = options.workspaceId ?? "default"
		this.coordinator = new StreamCoordinator(this.parentStreamId)

		Logger.info(
			`[${this.name}] Initialized with maxConcurrency=${this.maxConcurrency} for parent stream ${this.parentStreamId.slice(0, 8)}`,
		)
	}

	/**
	 * Dispatches a batch of Kanban tasks using a Topological Execution Engine.
	 *
	 * Uses a DAG (Directed Acyclic Graph) approach: a task is only dispatched
	 * when all its `depends_on` parents have successfully completed.
	 * Uses a semaphore pattern to ensure at most `maxConcurrency` tasks execute
	 * simultaneously.
	 *
	 * All workers are isolated via their own child streams and DB shadows.
	 * A single worker failure skips its dependents but does not crash the pool.
	 */
	public async dispatch(tasks: KanbanTask[]): Promise<StreamPoolResult> {
		const startTime = Date.now()
		const total = tasks.length

		if (total === 0) {
			Logger.info(`[${this.name}] No tasks to dispatch.`)
			return { totalTasks: 0, completed: 0, failed: 0, results: [], durationMs: 0 }
		}

		Logger.info(
			`[${this.name}] Dispatching ${total} tasks with topological DAG engine (concurrency limit: ${this.maxConcurrency})...`,
		)

		const results: WorkerResult[] = []
		const inFlight = new Set<Promise<void>>()
		const completedTaskIds = new Set<string>()
		const pendingTasks = new Set(tasks)
		const taskResults = new Map<string, string>()

		while (pendingTasks.size > 0 || inFlight.size > 0) {
			// Phase 4: Synchronous I/O Flush BEFORE finding next wave
			try {
				const ctx = await this.controller.getAgentContext()
				await ctx.flush()
			} catch (flushErr) {
				Logger.warn(`[${this.name}] I/O flush failed:`, flushErr)
			}

			// 1. Identify the 'Next Wave': All tasks whose dependencies are met.
			const wave = Array.from(pendingTasks).filter((task) => task.depends_on.every((depId) => completedTaskIds.has(depId)))

			// Deadlock / Cascade failure detection
			if (wave.length === 0 && inFlight.size === 0 && pendingTasks.size > 0) {
				const stalledIds = Array.from(pendingTasks)
					.map((t) => t.id)
					.join(", ")
				Logger.warn(`[${this.name}] DAG Halted. Stalled: ${stalledIds}`)
				for (const stalled of pendingTasks) {
					results.push({
						streamId: "skipped",
						taskDescription: stalled.description,
						status: "failed",
						error: "DAG deadlock",
						durationMs: 0,
					})
				}
				break
			}

			if (wave.length > 0) {
				Logger.info(`[${this.name}] 🌊 Starting wave of ${wave.length} tasks...`)

				// Stage 1: Parallel Preparation & Planning for the entire wave
				const waveWorkers = wave.map((task) => {
					pendingTasks.delete(task)
					const depResults = task.depends_on
						.map((depId) => `[Dependency Task: ${depId}]\n${taskResults.get(depId) || "No result"}`)
						.join("\n\n")

					return new WorkerStream(
						this.controller,
						this.apiHandler,
						this.coordinator,
						task,
						depResults,
						this.userId,
						this.workspaceId,
					)
				})

				// Sub-Stage A: Parallel Plan (ALL tasks in the wave)
				Logger.info(`[${this.name}] 📝 Wave Planning Phase (${waveWorkers.length} tasks)...`)
				const wavePlans: any[] = []
				for (let i = 0; i < waveWorkers.length; i += this.maxConcurrency) {
					const batch = waveWorkers.slice(i, i + this.maxConcurrency)
					const batchPlans = await Promise.all(
						batch.map(async (worker) => {
							try {
								await worker.prepare()
								return await worker.executePlan()
							} catch (e) {
								return { error: e }
							}
						}),
					)
					wavePlans.push(...batchPlans)
				}

				// --- Tier 5: Wave-Wide Soundness Check (Double Down) ---
				const successPlans = wavePlans.filter((p) => !p.error)
				if (successPlans.length > 0) {
					const kaizen = new KaizenSystem()
					const ctx = await this.controller.getAgentContext()
					const soundness = await ctx.getLogicalSoundness(successPlans.map((_, i) => `plan-${i}`))

					if (soundness < 0.7) {
						Logger.warn(
							`[${this.name}] ⚠️ Wave Architectural Soundness is LOW (${soundness.toFixed(2)}). Collective plans may be inconsistent!`,
						)
						// We could trigger a Kaizen reflection pass here in a future update
					} else {
						Logger.info(`[${this.name}] ✅ Wave Architectural Soundness: ${soundness.toFixed(2)}`)
					}
				}
				// ------------------------------------------------------

				// Sub-Stage A.1: Wave-Wide Collision Pre-Scan
				// Check if any two successfully planned tasks in this wave target the same file.
				// This doubles down on collision safety at the planning level.
				const fileToTaskMap = new Map<string, string>()
				for (let i = 0; i < waveWorkers.length; i++) {
					const plan = wavePlans[i]
					if (plan && !plan.error && plan.actions) {
						for (const action of plan.actions) {
							if (action.file) {
								if (fileToTaskMap.has(action.file)) {
									const otherTaskId = fileToTaskMap.get(action.file)
									Logger.warn(
										`[${this.name}] ⚠️ WAVE COLLISION DETECTED: Task ${wave[i]!.id} and Task ${otherTaskId} both plan to mutate '${action.file}'. One will be deferred/retried.`,
									)
								} else {
									fileToTaskMap.set(action.file, wave[i]!.id)
								}
							}
						}
					}
				}

				// --- Tier 6: Human-in-the-Loop Governance (Double Down) ---
				if (this.controller.getStreamId() === this.parentStreamId) {
					// Only for top-level waves for now to prevent spam
					const waveId = `wave-${this.parentStreamId.slice(0, 8)}-${Date.now()}`
					Logger.info(`[${this.name}] 🚦 Requesting Human Approval for wave ${waveId}...`)

					// Collect metadata for the UI
					const metadata: WaveApprovalMetadata = {
						waveId,
						tasks: waveWorkers.map((worker, idx) => {
							const task = wave[idx]!
							const plan = wavePlans[idx]
							return {
								id: task.id,
								description: task.description,
								plan: {
									actions: plan.actions || [],
								},
							}
						}),
					}

					// Register with the registry and notify the UI
					const approvalPromise = this.controller.requestWaveApproval(waveId, metadata)

					// Simple VS Code notification as a trigger
					const HostProvider = require("@/hosts/host-provider").HostProvider
					const { ShowMessageType } = require("@/shared/proto/host/window")

					HostProvider.get().window.showMessage({
						type: ShowMessageType.INFO,
						message: `[MAS] Swarm Wave Ready: ${waveWorkers.length} tasks planned. Review and Approve to proceed.`,
					})

					const approved = await approvalPromise
					if (!approved) {
						throw new Error(`Wave ${waveId} was REJECTED by the user. Aborting swarm execution.`)
					}
					Logger.info(`[${this.name}] ✅ Wave ${waveId} APPROVED. Proceeding to Act phase.`)
				}
				// ----------------------------------------------------------

				// Sub-Stage B: Parallel Act & Finalize
				Logger.info(`[${this.name}] 🛠️ Wave Acting Phase (${waveWorkers.length} tasks)...`)

				const isTopLevel = this.controller.getStreamId() === this.parentStreamId
				const waveId = `wave-${this.parentStreamId.slice(0, 8)}-${Date.now()}`

				if (isTopLevel) {
					await this.controller.reportEvent(
						`Wave ${waveId} Started`,
						"wave_start",
						`Executing ${wave.length} tasks in parallel.`,
						wave.length,
					)
				}

				const waveResults: WorkerResult[] = []
				for (let i = 0; i < waveWorkers.length; i += this.maxConcurrency) {
					const batchIndices = Array.from(
						{ length: Math.min(this.maxConcurrency, waveWorkers.length - i) },
						(_, k) => i + k,
					)

					const batchResults = await Promise.all(
						batchIndices.map(async (idx) => {
							const worker = waveWorkers[idx]!
							const plan = wavePlans[idx]
							const startTime = Date.now()
							const childStreamId = worker.getChildStreamId() || "unknown"

							if (plan.error) {
								return await worker.handleFailure(startTime, childStreamId, plan.error)
							}

							try {
								// Collision Check (Planning-phase lock acquisition)
								const affectedFiles = (plan.actions || []).map((a: any) => a.file).filter(Boolean)
								if (affectedFiles.length > 0) {
									await worker.acquireLocksWithRetry(childStreamId, affectedFiles)
								}

								const reports = await worker.executeAct(plan)
								return await worker.finalize(startTime, childStreamId, plan, reports)
							} catch (e) {
								return await worker.handleFailure(startTime, childStreamId, e)
							}
						}),
					)
					waveResults.push(...batchResults)
				}

				if (isTopLevel) {
					await this.controller.reportEvent(
						`Wave ${waveId} Completed`,
						"wave_complete",
						`All ${wave.length} tasks in wave ${waveId} have finished.`,
					)
				}

				// Correct bookkeeping:
				waveWorkers.forEach((_w, idx) => {
					const res = waveResults[idx]!
					if (res.status === "completed") {
						completedTaskIds.add(wave[idx]!.id)
						taskResults.set(wave[idx]!.id, res.result || "Success")
						results.push(res)
					} else {
						// Result should still be tracked even if failed
						results.push(res)
					}
				})

				Logger.info(
					`[${this.name}] 🌊 Wave complete. ${waveResults.filter((r) => r.status === "completed").length}/${wave.length} succeeded.`,
				)
			} else if (inFlight.size > 0) {
				// This shouldn't happen with the new wave-sync logic unless I refactor inFlight back in.
				// For now, wave-sync is blocking per wave.
				await Promise.race(inFlight)
			}
		}

		const durationMs = Date.now() - startTime
		const completed = results.filter((r) => r.status === "completed").length
		const failed = results.filter((r) => r.status === "failed").length

		Logger.info(`[${this.name}] Pool complete: ${completed}/${total} succeeded, ${failed} failed, ${durationMs}ms total`)

		// Store aggregated results in parent stream memory
		try {
			await this.controller.storeMemory(
				"concurrent_build_results",
				JSON.stringify({
					totalTasks: total,
					completed,
					failed,
					durationMs,
					workerResults: results.map((r) => ({
						task: r.taskDescription.slice(0, 80),
						status: r.status,
						streamId: r.streamId.slice(0, 8),
						durationMs: r.durationMs,
					})),
				}),
			)
		} catch (err) {
			Logger.warn(`[${this.name}] Failed to store aggregated results:`, err)
		}

		return { totalTasks: total, completed, failed, results, durationMs }
	}

	/**
	 * Returns the coordinator for external access to file locks and progress.
	 */
	public getCoordinator(): StreamCoordinator {
		return this.coordinator
	}

	/**
	 * Returns the aggregated digest from all active/completed workers.
	 */
	public async getAggregatedDigest(): Promise<string> {
		return this.coordinator.getAggregatedDigest()
	}
}
