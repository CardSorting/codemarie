import * as path from "path"
import { AgentStream, AgentTask, orchestrator, TaskAuditMetadata } from "@/infrastructure/ai/Orchestrator"
import { dbPool, WriteOp } from "@/infrastructure/db/BufferedDbPool"
import { Logger } from "@/shared/services/Logger"
import { AgentContext } from "../broccolidb/agent-context"
import { Workspace } from "../broccolidb/workspace"

/**
 * OrchestrationController: Manages the lifecycle of an agent stream and its tasks.
 * It provides a clean interface for Task and ToolExecutor to report progress.
 *
 * It moves "bolted-on" logic out of the core task loop and into a first-class orchestration layer.
 */
export class OrchestrationController {
	private currentTaskId?: string
	private agentContext?: AgentContext

	constructor(
		private streamId: string,
		private userId: string,
		private workspaceId: string,
		private taskId: string,
	) {}

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
	 * Updates the status and metadata of the current task.
	 */
	public async updateTaskProgress(
		status: AgentTask["status"],
		result: string | null = null,
		metadata?: TaskAuditMetadata,
	): Promise<void> {
		if (!this.currentTaskId) return

		try {
			await orchestrator.updateTaskStatus(this.currentTaskId, status, result, metadata)
		} catch (error) {
			Logger.error(`[Orchestration] Failed to update task ${this.currentTaskId}:`, error)
		}
	}

	/**
	 * Marks the current stream as completed.
	 */
	/**
	 * Marks the current stream as completed and commits database changes.
	 * Returns true if both the DB commit and the stream completion were successful.
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

	public getCurrentTaskId(): string | undefined {
		return this.currentTaskId
	}

	/**
	 * Resolves the content of a file, preferring the uncommitted shadow buffer.
	 */
	public resolveVirtualContent(filePath: string): string | undefined {
		if (!this.streamId) return undefined

		const shadow = dbPool.getShadowOps(this.streamId)
		// Find the latest write op for this file in the shadow
		const latestOp = shadow
			.filter((op) => op.type === "insert" || op.type === "update")
			.reverse()
			.find((op) => {
				const values = op.values as any
				const where = op.where as any
				const opPath = values?.path || where?.path
				return opPath && path.resolve(process.cwd(), opPath) === filePath
			})

		return latestOp?.values?.content as string | undefined
	}

	/**
	 * Publishes high-level architectural stability metrics.
	 * Version for high-throughput: Fire-and-forget logging.
	 */
	public async fastPublishArchitecturalTelemetry(): Promise<void> {
		try {
			const state = await this.getCurrentPolicyState()
			// Tier 2: Fire-and-forget (Don't await the DB push for non-critical telemetry)
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

			Logger.info(`[Orchestration] Triggered high-volume telemetry for ${this.streamId}`)
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
			Logger.info(`[Orchestration] Published architectural telemetry for ${this.streamId}`)
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
	 * Tier 4: Unified Cognitive Fabric.
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
	 * Used by StreamPool to create isolated WorkerStream contexts.
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
	 * committed or rolled back. Ensures no orphaned child streams.
	 */
	public async completeWithChildren(
		summary: string,
		validator?: (
			affectedFiles: Set<string>,
			ops: import("@/infrastructure/db/BufferedDbPool").WriteOp[],
		) => Promise<{ success: boolean; errors: string[] }>,
	): Promise<boolean> {
		try {
			const MAX_WAIT_MS = 5 * 60 * 1000 // 5-minute safety timeout
			const CHECK_INTERVAL_MS = 2000
			const startTime = Date.now()

			while (Date.now() - startTime < MAX_WAIT_MS) {
				const children = await this.getChildStreams()
				const activeChildren = children.filter((c) => c.status === "active")

				if (activeChildren.length === 0) {
					Logger.info(`[Orchestration] All child streams settled. Completing parent stream.`)
					return await this.completeStream(summary, validator)
				}

				Logger.info(
					`[Orchestration] Waiting for ${activeChildren.length} child streams to settle... (${Math.round((Date.now() - startTime) / 1000)}s)`,
				)
				await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS))
			}

			Logger.error(
				`[Orchestration] Timeout waiting for child streams after ${MAX_WAIT_MS}ms. Completing anyway to avoid deadlock.`,
			)
			return await this.completeStream(summary, validator)
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
}
