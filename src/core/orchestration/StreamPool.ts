import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"
import { OrchestrationController } from "./OrchestrationController"
import { StreamCoordinator } from "./StreamCoordinator"
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
			// Phase 4: Synchronous I/O Flush BEFORE dispatching new workers.
			// This guarantees parent file mutations are physically written to SQLite/disk
			// before child workers spin up and read the file space.
			try {
				const ctx = await this.controller.getAgentContext()
				await ctx.flush()
			} catch (flushErr) {
				Logger.warn(`[${this.name}] Failed to synchronously flush I/O buffer before DAG wave:`, flushErr)
			}

			// Find tasks whose dependencies are fully met
			const readyTasks = Array.from(pendingTasks).filter((task) =>
				task.depends_on.every((depId) => completedTaskIds.has(depId)),
			)

			// Deadlock / Cascade failure detection
			if (readyTasks.length === 0 && inFlight.size === 0 && pendingTasks.size > 0) {
				const stalledIds = Array.from(pendingTasks)
					.map((t) => t.id)
					.join(", ")
				Logger.warn(
					`[${this.name}] DAG Execution halted. Remaining tasks missing dependencies or skipped due to parent failure: ${stalledIds}`,
				)

				// Mark remaining as failed/skipped
				for (const stalled of pendingTasks) {
					results.push({
						streamId: "skipped",
						taskDescription: stalled.description,
						status: "failed",
						error: "Skipped due to unmet dependencies or DAG deadlock",
						durationMs: 0,
					})
				}
				break
			}

			// Dispatch ready tasks up to the concurrency limit
			for (const task of readyTasks) {
				if (inFlight.size >= this.maxConcurrency) {
					break // Wait for a slot to free up
				}

				pendingTasks.delete(task)

				// Phase 4: Context Baton Pass (Aggregate dependency LLM outcomes)
				const depResults = task.depends_on
					.map((depId) => `[Dependency Task: ${depId}]\n${taskResults.get(depId) || "No result"}`)
					.join("\n\n")

				const worker = new WorkerStream(
					this.controller,
					this.apiHandler,
					this.coordinator,
					task,
					depResults,
					this.userId,
					this.workspaceId,
				)

				const workerPromise = (async () => {
					try {
						const result = await worker.execute()
						results.push(result)

						if (result.status === "completed") {
							completedTaskIds.add(task.id)
							taskResults.set(task.id, result.result || "Success")
						}

						Logger.info(
							`[${this.name}] Worker for task ${task.id} finished (${result.status}). Progress: ${results.length}/${total}`,
						)
					} catch (err: any) {
						Logger.error(`[${this.name}] Unexpected worker error for task ${task.id}:`, err)
						results.push({
							streamId: "unknown",
							taskDescription: task.description,
							status: "failed",
							error: err.message || String(err),
							durationMs: Date.now() - startTime,
						})
					}
				})()

				inFlight.add(workerPromise)
				workerPromise.finally(() => inFlight.delete(workerPromise))
			}

			// Wait for at least one flight to finish before making another DAG evaluation pass
			if (inFlight.size > 0 && (inFlight.size >= this.maxConcurrency || readyTasks.length === 0)) {
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
