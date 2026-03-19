import * as fs from "fs/promises"
import * as path from "path"
import { AgentStream, AgentTask, orchestrator, TaskAuditMetadata } from "@/infrastructure/ai/Orchestrator"
import { dbPool, WriteOp } from "@/infrastructure/db/BufferedDbPool"
import { OrchestrationEventMetadata, WaveApprovalMetadata } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { AgentContext } from "../broccolidb/agent-context"
import { Workspace } from "../broccolidb/workspace"

/**
 * OrchestrationController: Manages the lifecycle of an agent stream and its tasks.
 * It provides a clean interface for Task and ToolExecutor to report progress.
 */
export class OrchestrationController {
	private currentTaskId?: string
	private agentContext?: AgentContext

	// --- Wave Approval Registry (Shared) ---
	private static pendingWaves = new Map<string, (approved: boolean) => void>()
	private static pendingWaveMetadata = new Map<string, WaveApprovalMetadata>()
	private static eventCallbacks = new Map<string, (metadata: OrchestrationEventMetadata) => Promise<void>>()
	private static approvalCallbacks = new Map<string, (waveId: string, metadata?: WaveApprovalMetadata) => Promise<boolean>>()

	constructor(
		private streamId: string,
		private userId: string,
		private workspaceId: string,
		private taskId: string,
	) {}

	/**
	 * Registers an approval callback for this controller's stream.
	 */
	public static setApprovalCallback(
		streamId: string,
		callback: (waveId: string, metadata?: WaveApprovalMetadata) => Promise<boolean>,
	): void {
		OrchestrationController.approvalCallbacks.set(streamId, callback)
	}

	/**
	 * Registers an event callback for this controller's stream.
	 */
	public static setEventCallback(streamId: string, callback: (metadata: OrchestrationEventMetadata) => Promise<void>): void {
		OrchestrationController.eventCallbacks.set(streamId, callback)
	}

	/**
	 * Registers a wave as pending approval.
	 * Returns a promise that resolves when approval is granted or denied.
	 */
	public async requestWaveApproval(waveId: string, metadata?: WaveApprovalMetadata): Promise<boolean> {
		if (metadata) {
			metadata.streamId = this.streamId
			OrchestrationController.pendingWaveMetadata.set(waveId, metadata)
		}

		return new Promise((resolve) => {
			;(async () => {
				OrchestrationController.pendingWaves.set(waveId, resolve)

				// Route back to the task UI if a callback is registered
				const callback = OrchestrationController.approvalCallbacks.get(this.streamId)
				if (callback) {
					const approved = await callback(waveId, metadata)
					// If approval came back through the callback, complete the wave
					if (OrchestrationController.pendingWaves.has(waveId)) {
						OrchestrationController.approveWave(waveId, approved)
					}
				}
			})()
		})
	}

	public static getWaveMetadata(waveId: string): WaveApprovalMetadata | undefined {
		return OrchestrationController.pendingWaveMetadata.get(waveId)
	}

	public static removeWaveMetadata(waveId: string): void {
		OrchestrationController.pendingWaveMetadata.delete(waveId)
	}

	/**
	 * Reports an orchestration event for the current stream.
	 */
	public async reportEvent(
		event: string,
		type: OrchestrationEventMetadata["type"],
		details?: string,
		totalTasks?: number,
	): Promise<void> {
		const metadata: OrchestrationEventMetadata = {
			event,
			type,
			details,
			totalTasks,
			streamId: this.streamId,
			taskId: this.taskId,
			timestamp: Date.now(),
		}

		// Route back to the task UI if a callback is registered
		const callback = OrchestrationController.eventCallbacks.get(this.streamId)
		if (callback) {
			await callback(metadata)
		}
	}

	/**
	 * Grants or denies approval for a pending wave.
	 */
	public static approveWave(waveId: string, approved: boolean): void {
		const resolve = OrchestrationController.pendingWaves.get(waveId)
		if (resolve) {
			resolve(approved)
			OrchestrationController.pendingWaves.delete(waveId)
			OrchestrationController.pendingWaveMetadata.delete(waveId)
		}
	}
	// ----------------------------------------------------

	/**
	 * Returns the native AgentContext for BroccoliDB operations.
	 */
	public async getAgentContext(): Promise<AgentContext> {
		if (this.agentContext) return this.agentContext

		const workspace = new Workspace(dbPool, this.userId, this.workspaceId, this.taskId)
		await workspace.init()

		this.agentContext = new AgentContext(workspace)
		return this.agentContext
	}

	/**
	 * Creates a new task within the current stream.
	 */
	public async beginTask(description: string): Promise<string> {
		try {
			const task = await orchestrator.createTask(this.streamId, description)
			this.currentTaskId = task.id
			return task.id
		} catch (error) {
			Logger.error(`[Orchestration] Failed to create task:`, error)
			return ""
		}
	}

	/**
	 * Starts a database shadow for the current stream.
	 */
	public async beginDbShadow(): Promise<void> {
		try {
			await dbPool.beginWork(this.streamId)
		} catch (error) {
			Logger.error(`[Orchestration] Failed to begin DB shadow for ${this.streamId}:`, error)
		}
	}

	/**
	 * Pushes a database operation to the stream's shadow.
	 */
	public async pushDbOp(op: WriteOp, affectedFile?: string): Promise<void> {
		try {
			await dbPool.push(op, this.streamId, affectedFile)
		} catch (error) {
			Logger.error(`[Orchestration] Failed to push DB op:`, error)
		}
	}

	/**
	 * Transitions the task to the planning phase.
	 */
	public async beginPlan(taskId: string): Promise<void> {
		this.currentTaskId = taskId
		await this.updateTaskProgress("planning")
	}

	/**
	 * Commits a generated plan to the task metadata and transitions to 'planned'.
	 */
	public async commitPlan(taskId: string, plan: any): Promise<void> {
		const metadata: TaskAuditMetadata = {
			...(await this.getTaskMetadata(taskId)),
			// @ts-expect-error - dynamic extension for plan storage
			task_plan: plan,
		}
		await this.updateTaskStatus(taskId, "planned", null, metadata)
	}

	/**
	 * Transitions the task to the acting phase.
	 */
	public async beginAct(taskId: string): Promise<void> {
		await this.updateTaskProgress("acting")
	}

	/**
	 * Records the completion of a specific action within a task's plan.
	 */
	public async updateActionProgress(taskId: string, completedCount: number, reports?: any[]): Promise<void> {
		const metadata: TaskAuditMetadata = {
			...(await this.getTaskMetadata(taskId)),
			// @ts-expect-error - dynamic extension for tracking
			completed_actions_count: completedCount,
		}
		if (reports) {
			// @ts-expect-error - dynamic extension
			metadata.execution_reports = reports
		}
		await this.updateTaskStatus(taskId, "acting", null, metadata)
	}

	/**
	 * Updates the status and metadata of the current task.
	 */
	public async updateTaskProgress(
		status: AgentTask["status"],
		result?: string,
		metadata?: Partial<TaskAuditMetadata>,
	): Promise<void> {
		await this.updateTaskStatus(this.currentTaskId || "", status, result, metadata)
	}

	/**
	 * Low-level task status update.
	 */
	public async updateTaskStatus(
		taskId: string,
		status: AgentTask["status"],
		result: string | null = null,
		metadata?: TaskAuditMetadata,
	): Promise<void> {
		try {
			await orchestrator.updateTaskStatus(taskId, status, result, metadata)
		} catch (error) {
			Logger.error(`[Orchestration] Failed to update task ${taskId}:`, error)
		}
	}

	private async getTaskMetadata(taskId: string): Promise<TaskAuditMetadata | undefined> {
		try {
			const tasks = await orchestrator.getStreamTasks(this.streamId)
			const task = tasks.find((t) => t.id === taskId)
			return task?.metadata
		} catch (_e) {
			return undefined
		}
	}

	/**
	 * Marks the current stream as completed and commits database changes.
	 */
	public async completeStream(
		summary: string,
		validator?: (affectedFiles: Set<string>, ops: WriteOp[]) => Promise<{ success: boolean; errors: string[] }>,
	): Promise<boolean> {
		try {
			await dbPool.commitWork(this.streamId, validator)
			await orchestrator.completeStream(this.streamId, summary)
			return true
		} catch (error) {
			Logger.error(`[Orchestration] Failed to complete stream ${this.streamId}:`, error)
			return false
		}
	}

	/**
	 * Marks the current stream as failed and rolls back changes.
	 */
	public async failStream(reason: string): Promise<void> {
		try {
			await dbPool.rollbackWork(this.streamId, reason)
			await orchestrator.failStream(this.streamId, reason)
		} catch (error) {
			Logger.error(`[Orchestration] Failed to fail stream ${this.streamId}:`, error)
		}
	}

	/**
	 * Returns a snapshot of the current policy health and recent violations.
	 */
	public async getCurrentPolicyState(): Promise<{ violations: string[]; avgEntropy: number }> {
		try {
			const digest = JSON.parse(await orchestrator.getCompressedContext(this.streamId))
			return {
				violations: digest.uniqueViolations || [],
				avgEntropy: digest.avgEntropy || 0,
			}
		} catch (_error) {
			return { violations: [], avgEntropy: 0 }
		}
	}

	/**
	 * Returns the compressed context digest for the stream.
	 */
	public async getStreamDigest(): Promise<string> {
		try {
			return await orchestrator.getCompressedContext(this.streamId)
		} catch (error) {
			Logger.error(`[Orchestration] Failed to get digest for ${this.streamId}:`, error)
			return "{}"
		}
	}

	/**
	 * Returns the underlying stream ID.
	 */
	public getStreamId(): string {
		return this.streamId
	}

	public getUserId(): string {
		return this.userId
	}

	public getWorkspaceId(): string {
		return this.workspaceId
	}

	public getCurrentTaskId(): string | undefined {
		return this.currentTaskId
	}

	/**
	 * Resolves the content of a file, preferring the uncommitted shadow buffer.
	 */
	public resolveVirtualContent(filePath: string): string | undefined {
		if (!this.streamId) return undefined

		const shadow = dbPool.getShadowOps(this.streamId)
		const latestOp = shadow
			.filter((op) => op.type === "insert" || op.type === "update" || op.type === "upsert")
			.reverse()
			.find((op) => {
				const values = op.values as any
				const where = op.where as any
				const opPath = values?.path || (where as any)?.column === "path" ? (where as any).value : undefined
				if (!opPath) return false
				const absOpPath = path.isAbsolute(opPath) ? opPath : path.resolve(process.cwd(), opPath)
				return absOpPath === filePath
			})

		return latestOp?.values?.content as string | undefined
	}

	/**
	 * Updates the virtual content of a file in the stream's shadow.
	 */
	public async updateVirtualContent(filePath: string, content: string): Promise<void> {
		const relPath = path.relative(process.cwd(), filePath)
		await this.pushDbOp(
			{
				type: "upsert",
				table: "files",
				where: [{ column: "path", value: relPath }],
				values: {
					path: relPath,
					content: content,
					author: `MainAgent-${this.streamId.slice(0, 8)}`,
					repoPath: `workspaces/${this.workspaceId}`,
					id: `main-${Buffer.from(relPath).toString("hex")}`,
				},
				layer: "infrastructure",
			},
			filePath,
		)
	}

	/**
	 * Publishes high-level architectural stability metrics.
	 */
	public async fastPublishArchitecturalTelemetry(): Promise<void> {
		try {
			const state = await this.getCurrentPolicyState()
			this.pushDbOp({
				type: "insert",
				table: "agent_tasks",
				values: {
					id: `telemetry-${this.streamId}-${Date.now()}`,
					streamId: this.streamId,
					description: "Architectural Stability Telemetry (High-Volume)",
					status: "completed",
					result: `Stability Report: ${state.violations.length} violations, Entropy: ${state.avgEntropy.toFixed(2)}`,
					metadata: JSON.stringify({
						violations: state.violations,
						avgEntropy: state.avgEntropy,
						timestamp: Date.now(),
					}),
					createdAt: Date.now(),
				},
				layer: "infrastructure",
			}).catch((err) => Logger.warn(`[Orchestration] Failed to fire-and-forget telemetry:`, err))
		} catch (error) {
			Logger.error(`[Orchestration] Failed to prepare telemetry:`, error)
		}
	}

	/**
	 * Publishes high-level architectural stability metrics to the persistent audit log.
	 */
	public async publishArchitecturalTelemetry(): Promise<void> {
		try {
			const state = await this.getCurrentPolicyState()
			await this.pushDbOp({
				type: "insert",
				table: "agent_tasks",
				values: {
					id: `telemetry-${this.streamId}-${Date.now()}`,
					streamId: this.streamId,
					description: "Architectural Stability Telemetry",
					status: "completed",
					result: `Stability Report: ${state.violations.length} violations, Entropy: ${state.avgEntropy.toFixed(2)}`,
					metadata: JSON.stringify({
						violations: state.violations,
						avgEntropy: state.avgEntropy,
						timestamp: Date.now(),
					}),
					createdAt: Date.now(),
				},
				layer: "infrastructure",
			})
		} catch (error) {
			Logger.error(`[Orchestration] Failed to publish telemetry:`, error)
		}
	}

	/**
	 * Stores a value in the stream's memory.
	 */
	public async storeMemory(key: string, value: string): Promise<void> {
		try {
			await orchestrator.storeMemory(this.streamId, key, value)
		} catch (error) {
			Logger.error(`[Orchestration] Failed to store memory ${key}:`, error)
		}
	}

	/**
	 * Annotates a piece of knowledge in the graph.
	 */
	public async annotateKnowledge(targetId: string, agentId: string, annotation: string, metadata?: any): Promise<void> {
		try {
			const ctx = await this.getAgentContext()
			await ctx.annotateKnowledge(targetId, agentId, annotation, metadata)
		} catch (error) {
			Logger.error(`[Orchestration] Failed to annotate knowledge ${targetId}:`, error)
		}
	}

	/**
	 * Recalls a value from the stream's memory.
	 */
	public async recallMemory(key: string): Promise<string | undefined> {
		try {
			const value = await orchestrator.recallMemory(this.streamId, key)
			return value || undefined
		} catch (error) {
			Logger.error(`[Orchestration] Failed to recall memory ${key}:`, error)
			return undefined
		}
	}

	/**
	 * Spawns a child stream linked to this controller's stream.
	 */
	public async spawnChildStream(focus: string): Promise<AgentStream> {
		return orchestrator.spawnChildStream(this.streamId, focus)
	}

	/**
	 * Returns all child streams for this controller's stream.
	 */
	public async getChildStreams(): Promise<AgentStream[]> {
		return orchestrator.getChildStreams(this.streamId)
	}

	/**
	 * Returns an aggregated digest merging this stream's context
	 * with all child stream digests.
	 */
	public async getAggregatedDigest(): Promise<string> {
		try {
			const parentDigest = JSON.parse(await this.getStreamDigest())
			const children = await this.getChildStreams()
			const childDigests: any[] = []

			for (const child of children) {
				try {
					const raw = await orchestrator.getCompressedContext(child.id)
					childDigests.push(JSON.parse(raw))
				} catch (_e) {
					// Skip failed digests
				}
			}

			return JSON.stringify(
				{
					parent: parentDigest,
					children: childDigests,
					totalChildStreams: children.length,
					activeChildStreams: children.filter((c) => c.status === "active").length,
				},
				null,
				2,
			)
		} catch (error) {
			Logger.error(`[Orchestration] Failed to get aggregated digest:`, error)
			return "{}"
		}
	}

	/**
	 * Completes this stream only after all child streams have been
	 * committed or rolled back.
	 */
	public async completeWithChildren(
		summary: string,
		validator?: (affectedFiles: Set<string>, ops: WriteOp[]) => Promise<{ success: boolean; errors: string[] }>,
	): Promise<boolean> {
		try {
			const MAX_WAIT_MS = 5 * 60 * 1000

			return await new Promise<boolean>((resolve) => {
				const timeoutId = setTimeout(async () => {
					cleanup()
					Logger.warn(
						`[Orchestration] completeWithChildren timed out after ${MAX_WAIT_MS}ms for stream ${this.streamId}`,
					)
					resolve(await this.completeStream(summary, validator))
				}, MAX_WAIT_MS)

				const checkChildren = async () => {
					try {
						const children = await this.getChildStreams()
						const activeChildren = children.filter((c) => c.status === "active")

						if (activeChildren.length === 0) {
							cleanup()
							resolve(await this.completeStream(summary, validator))
						}
					} catch (err) {
						Logger.error(`[Orchestration] Error checking child streams during completeWithChildren:`, err)
					}
				}

				const onStatusChanged = () => {
					checkChildren()
				}

				const cleanup = () => {
					clearTimeout(timeoutId)
					orchestrator.events.removeListener("streamStatusChanged", onStatusChanged)
				}

				orchestrator.events.on("streamStatusChanged", onStatusChanged)

				// Fire an initial check in case children are already finished
				checkChildren()
			})
		} catch (error) {
			Logger.error(`[Orchestration] Failed to complete with children:`, error)
			return false
		}
	}

	/**
	 * Gets all tasks for the current stream.
	 */
	public async getStreamTasks(): Promise<AgentTask[]> {
		try {
			return await orchestrator.getStreamTasks(this.streamId)
		} catch (error) {
			Logger.error(`[Orchestration] Failed to get tasks for ${this.streamId}:`, error)
			return []
		}
	}

	/**
	 * Materializes all virtual files in the BroccoliDB 'files' table for this stream
	 * to the physical filesystem.
	 */
	public async materialize(): Promise<void> {
		try {
			const files = await dbPool.selectWhere("files", [
				{ column: "author", value: `%Worker-${this.streamId.slice(0, 8)}%`, operator: "like" } as any,
			])

			// If no files found by author, try fetching ALL if this is a parent stream
			let targetFiles = files
			if (targetFiles.length === 0) {
				const allFiles = await dbPool.selectAllFrom("files")
				// Filter by paths touched in this stream context if possible
				targetFiles = allFiles
			}

			Logger.info(`[Orchestration] Materializing ${targetFiles.length} files to disk...`)

			for (const file of targetFiles) {
				const absolutePath = path.isAbsolute(file.path) ? file.path : path.resolve(process.cwd(), file.path)
				const dir = path.dirname(absolutePath)

				await fs.mkdir(dir, { recursive: true })
				await fs.writeFile(absolutePath, file.content, "utf8")
				Logger.info(`[Orchestration] Materialized: ${file.path}`)
			}
		} catch (error) {
			Logger.error(`[Orchestration] Failed to materialize files:`, error)
		}
	}
}
