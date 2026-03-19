import pTimeout from "p-timeout"
import { type AgentStream, orchestrator } from "@/infrastructure/ai/Orchestrator"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"
import { OrchestrationController } from "./OrchestrationController"
import { StreamCoordinator } from "./StreamCoordinator"
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
			if (affectedFiles.length > 0) {
				await this.acquireLocksWithRetry(childStreamId, affectedFiles)
			}

			const reports = await this.executeAct(plan.actions || [])
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

		this.childController = new OrchestrationController(childStreamId, this.userId, this.workspaceId, `worker-${this.task.id}`)
		await this.childController.beginDbShadow()
		this.coordinator.registerWorker(childStreamId)
		await this.childController.beginTask(this.taskDescription)
		await this.childController.updateTaskProgress("running")

		return childStreamId
	}

	/**
	 * Stage 1: Planning (Public for Pool Coordination)
	 */
	public async executePlan(): Promise<any> {
		Logger.info(`[${this.name}] Planning phase...`)
		const parentDigest = await this.parentController.getStreamDigest()
		let enrichedPrompt = `Parent Stream Context:\n${parentDigest}\n\nAssigned Task: ${this.taskDescription}`

		if (this.dependencyContext && this.dependencyContext.trim().length > 0) {
			enrichedPrompt += `\n\n[Context from Direct Dependencies]\n${this.dependencyContext}`
		}

		return await pTimeout(executeMASRequest(this.apiHandler, WORKER_PLAN_SYSTEM_PROMPT, enrichedPrompt), {
			milliseconds: 3 * 60 * 1000,
			message: `Planning phase timed out after 3 minutes`,
		})
	}

	/**
	 * Stage 2: Acting (Public for Pool Coordination)
	 */
	public async executeAct(actions: any[]): Promise<any[]> {
		if (!actions || actions.length === 0) return []
		Logger.info(`[${this.name}] Acting phase (implementing ${actions.length} actions)...`)

		const reports: any[] = []
		for (const action of actions) {
			Logger.info(`[${this.name}] Implementing action: ${action.type} ${action.file}`)
			const currentContent = action.file ? this.childController?.resolveVirtualContent(action.file) : ""

			const actPrompt = `Task Objectives: ${this.taskDescription}
Requested Action: ${action.type} on ${action.file}
Instruction: ${action.description}

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
		}

		return reports
	}

	/**
	 * Finalize: Commit and return results.
	 */
	public async finalize(startTime: number, childStreamId: string, plan: any, reports: any[]): Promise<WorkerResult> {
		const finalResult = { ...plan, executionReports: reports }
		await this.childController!.storeMemory("worker_result", JSON.stringify(finalResult))
		await this.childController!.updateTaskProgress("completed", JSON.stringify(finalResult))

		const resultSummary = `Completed: ${this.taskDescription.slice(0, 80)}`
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
