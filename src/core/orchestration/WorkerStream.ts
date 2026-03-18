import pTimeout from "p-timeout"
import { type AgentStream, orchestrator } from "@/infrastructure/ai/Orchestrator"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"
import { OrchestrationController } from "./OrchestrationController"
import { StreamCoordinator } from "./StreamCoordinator"
import type { KanbanTask } from "./systems/KanbanSystem"
import { executeMASRequest } from "./utils"

/**
 * WorkerStream: An individual build agent that executes a single task
 * within its own isolated orchestration context (child stream + DB shadow).
 *
 * Each WorkerStream:
 * 1. Creates a child stream linked to the parent.
 * 2. Begins an isolated DB shadow for its writes.
 * 3. Performs file collision checks before mutating state.
 * 4. Reports progress to the parent via stream memory.
 * 5. Commits on success / rolls back on failure.
 */
export interface WorkerResult {
	streamId: string
	taskDescription: string
	status: "completed" | "failed"
	result?: string
	error?: string
	durationMs: number
}

const WORKER_SYSTEM_PROMPT = `You are a Build Worker Agent. You are given a single task to execute from a larger project plan.

Your goal is to produce a structured JSON object with:
1. "actions": A list of concrete file-level actions (create, modify, delete) needed to complete the task.
2. "dependencies": Any other tasks or files this depends on.
3. "verification": How to verify this task was completed correctly.

Rules:
- Focus ONLY on your assigned task. Do not attempt to complete other tasks.
- Be specific about file paths and code changes.
- Respect architectural layer boundaries.

Response Format (JSON ONLY):
{
  "actions": [
    { "type": "create|modify|delete", "file": "path/to/file", "description": "What to do" }
  ],
  "dependencies": ["dependency 1", ...],
  "verification": "How to verify completion"
}`

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
	 * Executes the worker's assigned task within an isolated child stream.
	 * Returns a WorkerResult with status, result, and timing information.
	 */
	public async execute(): Promise<WorkerResult> {
		const startTime = Date.now()
		const parentStreamId = this.parentController.getStreamId()
		let childStreamId = "unknown"

		try {
			// 1. Spawn a child stream linked to the parent
			this.childStream = await orchestrator.spawnChildStream(parentStreamId, `Worker: ${this.taskDescription.slice(0, 60)}`)
			childStreamId = this.childStream.id

			Logger.info(
				`[${this.name}] Spawned child stream: ${childStreamId.slice(0, 8)} for task: ${this.taskDescription.slice(0, 50)}...`,
			)

			// 2. Create an isolated controller + begin DB shadow
			this.childController = new OrchestrationController(
				childStreamId,
				this.userId,
				this.workspaceId,
				`worker-${this.task.id}`,
			)
			await this.childController.beginDbShadow()

			// 3. Register with coordinator
			this.coordinator.registerWorker(childStreamId)

			// 4. Begin the task
			await this.childController.beginTask(this.taskDescription)
			await this.childController.updateTaskProgress("running")

			// 5. Execute the LLM request for this task with a 5-minute timeout (Deadlock Prevention)
			const parentDigest = await this.parentController.getStreamDigest()
			let enrichedPrompt = `Parent Stream Context:\n${parentDigest}\n\nAssigned Task: ${this.taskDescription}`

			if (this.dependencyContext && this.dependencyContext.trim().length > 0) {
				enrichedPrompt += `\n\n[Context from Direct Dependencies]\nThe tasks this task depends on produced the following results and files. Use this context to guarantee architectural harmony:\n${this.dependencyContext}`
			}

			const masRequestPromise = executeMASRequest(this.apiHandler, WORKER_SYSTEM_PROMPT, enrichedPrompt)

			const result = (await pTimeout(masRequestPromise, {
				milliseconds: 5 * 60 * 1000,
				message: `Task execution timed out after 5 minutes`,
			})) as any

			// 6. Check for file collisions before committing (Robust Lock Acquisition)
			const affectedFiles = (result.actions || []).map((a: any) => a.file).filter(Boolean)

			if (affectedFiles.length > 0) {
				const MAX_ATTEMPTS = 5
				let attempts = 0
				let acquiredLocks = false

				while (!acquiredLocks && attempts < MAX_ATTEMPTS) {
					// Check collisions globally first
					const collision = await this.coordinator.checkCollision(childStreamId, affectedFiles)

					if (!collision) {
						// Attempt to acquire all locks atomically (test-and-set)
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
						// Release any partially acquired locks so we don't deadlock
						this.coordinator.releaseWorkerLocks(childStreamId)
					}

					// Collision or lock contention occurred, applying backoff
					attempts++
					if (attempts >= MAX_ATTEMPTS) {
						throw new Error(
							`Persistent file collision after ${MAX_ATTEMPTS} attempts. Aborting task to prevent corruption.`,
						)
					}

					Logger.warn(
						`[${this.name}] File collision detected — applying backoff (attempt ${attempts}/${MAX_ATTEMPTS})...`,
					)
					const backoffMs = Math.min(1000 * 2 ** attempts, 5000) + Math.random() * 1000
					await new Promise((resolve) => setTimeout(resolve, backoffMs))
				}
			}

			// 7. Store worker results in the child stream's memory
			await this.childController.storeMemory("worker_result", JSON.stringify(result))
			await this.childController.updateTaskProgress("completed", JSON.stringify(result))

			// 8. Commit the child stream
			const resultSummary = `Completed: ${this.taskDescription.slice(0, 80)}`
			await this.childController.completeStream(resultSummary)

			Logger.info(`[${this.name}] Completed successfully in ${Date.now() - startTime}ms`)

			return {
				streamId: childStreamId,
				taskDescription: this.taskDescription,
				status: "completed",
				result: JSON.stringify(result),
				durationMs: Date.now() - startTime,
			}
		} catch (error: any) {
			Logger.error(`[${this.name}] Failed:`, error)

			// Rollback on failure
			if (this.childController) {
				try {
					await this.childController.failStream(error.message || String(error))
				} catch (rollbackErr) {
					Logger.error(`[${this.name}] Rollback also failed:`, rollbackErr)
				}
			}

			return {
				streamId: childStreamId,
				taskDescription: this.taskDescription,
				status: "failed",
				error: error.message || String(error),
				durationMs: Date.now() - startTime,
			}
		} finally {
			// 9. Guarantee deregistration from coordinator (Cleanup Guarantee)
			if (childStreamId !== "unknown") {
				this.coordinator.deregisterWorker(childStreamId)
			}
		}
	}

	/**
	 * Returns the child stream ID, if spawned.
	 */
	public getChildStreamId(): string | undefined {
		return this.childStream?.id
	}
}
