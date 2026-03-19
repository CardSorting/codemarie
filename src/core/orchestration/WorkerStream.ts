import pTimeout from "p-timeout"
import { type AgentStream, orchestrator } from "@/infrastructure/ai/Orchestrator"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"
import { OrchestrationController } from "./OrchestrationController"
import { StreamCoordinator } from "./StreamCoordinator"
import { StreamPool } from "./StreamPool"
import { JoyZoningSystem } from "./systems/JoyZoningSystem"
import type { KanbanTask } from "./systems/KanbanSystem"
import { executeMASRequest, WORKER_ACT_SYSTEM_PROMPT, WORKER_PLAN_SYSTEM_PROMPT } from "./utils"
export interface WorkerResult {
	streamId: string
	taskDescription: string
	status: "completed" | "failed"
	result?: string
	error?: string
	durationMs: number
}

export class WorkerStream {
	private name: string
	private childStream?: AgentStream
	private childController?: OrchestrationController

	private taskDescription: string

	constructor(
		private parentController: OrchestrationController,
		private apiHandler: ApiHandler,
		private coordinator: StreamCoordinator,
		private task: KanbanTask,
		private dependencyContext: string,
		private userId: string,
		private workspaceId: string,
	) {
		this.name = `Worker-${task.id}`
		this.taskDescription = task.description
	}

	/**
	 * High-level orchestration.
	 * Can be used as a standalone single-call execution or as part of a Pool wave.
	 */
	public async execute(): Promise<WorkerResult> {
		const startTime = Date.now()
		let childStreamId = "unknown"

		try {
			childStreamId = await this.prepare()
			const plan = await this.executePlan()

			const affectedFiles = (plan.actions || []).map((a: any) => a.file).filter(Boolean)

			// --- Tier 6: Hierarchical Swarm Decomposition (Double Down) ---
			// If the plan is complex (e.g. > 5 actions), we promote this worker
			// to an Orchestrator and spawn a sub-pool.
			const DECOMPOSITION_THRESHOLD = 5
			if (plan.actions && plan.actions.length > DECOMPOSITION_THRESHOLD) {
				Logger.info(
					`[${this.name}] 🚀 Complex plan detected (${plan.actions.length} actions). Decomposing into sub-pool...`,
				)

				const subPool = new StreamPool(this.childController!, this.apiHandler, {
					maxConcurrency: 2, // Sub-pools are more conservative
					parentStreamId: childStreamId,
					userId: this.userId,
					workspaceId: this.workspaceId,
				})

				// Transform plan actions into KanbanTasks
				const subTasks: KanbanTask[] = plan.actions.map((action: any, i: number) => ({
					id: `sub-${i}`,
					description: `Action: ${action.type} on ${action.file} - ${action.description}`,
					depends_on: i > 0 ? [`sub-${i - 1}`] : [], // Sequential by default for sub-tasks
				}))

				const subResult = await subPool.dispatch(subTasks)
				const aggregatedDigest = await subPool.getAggregatedDigest()

				// Finalize as a composite result
				return await this.finalize(
					startTime,
					childStreamId,
					plan,
					[],
					`Decomposed into ${subResult.completed} sub-tasks. Context: ${aggregatedDigest.slice(0, 100)}...`,
				)
			}
			// ---------------------------------------------------------------

			if (affectedFiles.length > 0) {
				await this.acquireLocksWithRetry(childStreamId, affectedFiles)
			}

			const reports = await this.executeAct(plan)
			return await this.finalize(startTime, childStreamId, plan, reports)
		} catch (error: any) {
			return await this.handleFailure(startTime, childStreamId, error)
		}
	}

	/**
	 * Step 0: Prepare environment (Stream, Shadow, Coordinator registration)
	 */
	public async prepare(): Promise<string> {
		const parentStreamId = this.parentController.getStreamId()
		this.childStream = await orchestrator.spawnChildStream(parentStreamId, `Worker: ${this.taskDescription.slice(0, 60)}`)
		const childStreamId = this.childStream.id

		Logger.info(`[${this.name}] Preparing child stream: ${childStreamId.slice(0, 8)}`)

		this.childController = new OrchestrationController(childStreamId, this.userId, this.workspaceId, this.task.id)
		await this.childController.beginDbShadow()
		this.coordinator.registerWorker(childStreamId)

		// check if task already has a plan (Resilience/Restart)
		const tasks = await orchestrator.getStreamTasks(parentStreamId)
		const currentTask = tasks.find((t) => t.id === this.task.id)
		if (currentTask?.status === "planned" && currentTask.metadata) {
			const metadata = currentTask.metadata as any
			if (metadata.task_plan) {
				Logger.info(`[${this.name}] RESUMING from existing plan found in task metadata.`)
				// We still transition to 'running' or similar for visual feedback,
				// but executePlan will return this plan immediately.
			}
		}

		return childStreamId
	}

	/**
	 * Stage 1: Planning (Public for Pool Coordination)
	 */
	public async executePlan(): Promise<any> {
		// Resilience: Check if we already have a plan
		const tasks = await orchestrator.getStreamTasks(this.parentController.getStreamId())
		const currentTask = tasks.find((t) => t.id === this.task.id)
		if (currentTask?.status === "planned" && currentTask.metadata) {
			const metadata = currentTask.metadata as any
			if (metadata.task_plan) {
				return metadata.task_plan
			}
		}

		await this.childController?.beginPlan(this.task.id)
		Logger.info(`[${this.name}] Planning phase...`)
		const parentDigest = await this.parentController.getStreamDigest()
		let enrichedPrompt = `Parent Stream Context:\n${parentDigest}\n\nAssigned Task: ${this.taskDescription}`

		if (this.dependencyContext && this.dependencyContext.trim().length > 0) {
			enrichedPrompt += `\n\n[Context from Direct Dependencies]\n${this.dependencyContext}`
		}

		const plan = await pTimeout(executeMASRequest(this.apiHandler, WORKER_PLAN_SYSTEM_PROMPT, enrichedPrompt), {
			milliseconds: 3 * 60 * 1000,
			message: `Planning phase timed out after 3 minutes`,
		})

		// --- Tier 5: Real-time Architectural Audit (Double Down) ---
		const joyZoning = new JoyZoningSystem()
		const auditResult = await joyZoning.auditPlan(this.childController!, this.apiHandler, this.taskDescription, plan)

		if (!auditResult.approved) {
			Logger.warn(
				`[${this.name}] ⚠️ Architectural Audit Failed: ${auditResult.violations.join("; ")}. Attempting self-correction...`,
			)

			// Nudge the architect with the auditor's feedback for a one-time self-correction
			const correctionPrompt =
				enrichedPrompt +
				`\n\n[Architectural Audit Violation!]\nYour previous plan was REJECTED by JoyZoning for the following reasons:\n- ${auditResult.violations.join("\n- ")}\n\nAuditor's Suggestion: ${auditResult.suggestion}\n\nPlease RE-PLAN this task to strictly adhere to the architectural constraints.`

			const correctedPlan = await pTimeout(
				executeMASRequest(this.apiHandler, WORKER_PLAN_SYSTEM_PROMPT, correctionPrompt),
				{
					milliseconds: 3 * 60 * 1000,
					message: `Self-correction planning phase timed out`,
				},
			)

			await this.childController?.commitPlan(this.task.id, correctedPlan)
			return correctedPlan
		}
		// ----------------------------------------------------------

		await this.childController?.commitPlan(this.task.id, plan)
		return plan
	}

	/**
	 * Stage 2: Acting (Public for Pool Coordination)
	 */
	public async executeAct(fullPlan: any): Promise<any[]> {
		const actions = fullPlan?.actions || []
		if (actions.length === 0) return []

		await this.childController?.beginAct(this.task.id)

		// Resilience: Resume from specific action if partially completed
		const tasks = await orchestrator.getStreamTasks(this.parentController.getStreamId())
		const currentTask = tasks.find((t) => t.id === this.task.id)
		const completedCount = (currentTask?.metadata as any)?.completed_actions_count || 0

		if (completedCount > 0) {
			Logger.info(`[${this.name}] RESUMING Act phase from action index ${completedCount}.`)
		}

		Logger.info(`[${this.name}] Acting phase (implementing ${actions.length - completedCount}/${actions.length} actions)...`)

		const reports: any[] = []
		// Initialize reports from existing metadata if resuming?
		// For now, we'll just implement the remaining ones.

		for (let i = 0; i < actions.length; i++) {
			if (i < completedCount) continue // Skip already done

			const action = actions[i]
			Logger.info(`[${this.name}] [Action ${i + 1}/${actions.length}] Implementing: ${action.type} ${action.file}`)
			const currentContent = action.file ? this.childController?.resolveVirtualContent(action.file) : ""

			const actPrompt = `Task Objectives: ${this.taskDescription}
[Full Execution Plan for Architectural Context]
${JSON.stringify(fullPlan, null, 2)}

Target Action (${i + 1}/${actions.length}): ${action.type} on ${action.file}
Action Description: ${action.description}

Current File Content (if any):
${currentContent || "(New File)"}`

			const result = (await pTimeout(executeMASRequest(this.apiHandler, WORKER_ACT_SYSTEM_PROMPT, actPrompt), {
				milliseconds: 4 * 60 * 1000,
				message: `Implementation of ${action.file} timed out`,
			})) as any

			if (result.file && result.content) {
				await this.childController?.pushDbOp(
					{
						type: result.file === action.file && currentContent ? "update" : "upsert",
						table: "files",
						values: {
							path: result.file,
							content: result.content,
							updatedAt: Date.now(),
							author: this.name,
						},
						where: [{ column: "path", value: result.file }],
					},
					result.file,
				)
			}

			reports.push({ file: result.file, explanation: result.explanation, status: "applied" })

			// Commit progress after each successful action
			await this.childController?.updateActionProgress(this.task.id, i + 1)
		}

		return reports
	}

	/**
	 * Finalize: Commit and return results.
	 */
	public async finalize(
		startTime: number,
		childStreamId: string,
		plan: any,
		reports: any[],
		compositeSummary?: string,
	): Promise<WorkerResult> {
		const finalResult = { ...plan, executionReports: reports, compositeSummary }
		await this.childController!.storeMemory("worker_result", JSON.stringify(finalResult))
		await this.childController!.updateTaskProgress("completed", compositeSummary || JSON.stringify(finalResult))

		const resultSummary = compositeSummary || `Completed: ${this.taskDescription.slice(0, 80)}`
		await this.childController!.completeStream(resultSummary)

		this.coordinator.deregisterWorker(childStreamId)
		Logger.info(`[${this.name}] Completed successfully in ${Date.now() - startTime}ms`)

		return {
			streamId: childStreamId,
			taskDescription: this.taskDescription,
			status: "completed",
			result: JSON.stringify(finalResult),
			durationMs: Date.now() - startTime,
		}
	}

	/**
	 * Handle failure with safe rollback and deregistration.
	 */
	public async handleFailure(startTime: number, childStreamId: string, error: any): Promise<WorkerResult> {
		Logger.error(`[${this.name}] Failed:`, error)

		if (this.childController) {
			try {
				await this.childController.failStream(error.message || String(error))
			} catch (rollbackErr) {
				Logger.error(`[${this.name}] Rollback also failed:`, rollbackErr)
			}
		}

		if (childStreamId !== "unknown") {
			this.coordinator.deregisterWorker(childStreamId)
		}

		return {
			streamId: childStreamId,
			taskDescription: this.taskDescription,
			status: "failed",
			error: error.message || String(error),
			durationMs: Date.now() - startTime,
		}
	}

	/**
	 * Robust lock acquisition with backoff.
	 */
	public async acquireLocksWithRetry(childStreamId: string, affectedFiles: string[]): Promise<void> {
		const MAX_ATTEMPTS = 5
		let attempts = 0
		let acquiredLocks = false

		while (!acquiredLocks && attempts < MAX_ATTEMPTS) {
			const collision = await this.coordinator.checkCollision(childStreamId, affectedFiles)

			if (!collision) {
				let allAcquired = true
				for (const file of affectedFiles) {
					if (!this.coordinator.tryAcquireFileLock(file, childStreamId)) {
						allAcquired = false
						break
					}
				}

				if (allAcquired) {
					acquiredLocks = true
					break
				}
				this.coordinator.releaseWorkerLocks(childStreamId)
			}

			attempts++
			if (attempts >= MAX_ATTEMPTS) {
				throw new Error(`Persistent file collision after ${MAX_ATTEMPTS} attempts. Aborting task to prevent corruption.`)
			}

			Logger.warn(`[${this.name}] File collision detected — applying backoff (attempt ${attempts}/${MAX_ATTEMPTS})...`)
			const backoffMs = Math.min(1000 * 2 ** attempts, 5000) + Math.random() * 1000
			await new Promise((resolve) => setTimeout(resolve, backoffMs))
		}
	}

	/**
	 * Returns the child stream ID, if spawned.
	 */
	public getChildStreamId(): string | undefined {
		return this.childStream?.id
	}
}
