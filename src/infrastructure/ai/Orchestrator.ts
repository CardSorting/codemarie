import * as path from "path"
import { v4 as uuidv4 } from "uuid"
import { dbPool } from "../db/BufferedDbPool"

export interface AgentStream {
	id: string
	externalId: string | null
	parentId: string | null
	focus: string
	status: "active" | "completed" | "failed"
	createdAt: number
}

export interface TaskAuditMetadata {
	joy_zoning_violations?: string[]
	result_checksum?: string
	divergence_detected?: boolean
	entropy_score?: number
	violations?: string[]
}

export interface AgentTask {
	id: string
	streamId: string
	description: string
	status: "pending" | "running" | "completed" | "failed"
	result: string | null
	metadata?: TaskAuditMetadata
	createdAt: number
}

export class AgentOrchestrator {
	public async createStream(
		focus: string,
		parentId: string | null = null,
		externalId: string | null = null,
	): Promise<AgentStream> {
		const streamId = uuidv4()
		await dbPool.beginWork(streamId)

		try {
			const stream: AgentStream = {
				id: streamId,
				externalId,
				parentId,
				focus,
				status: "active",
				createdAt: Date.now(),
			}

			await dbPool.push(
				{
					type: "insert",
					table: "agent_streams",
					values: { ...stream },
					layer: "infrastructure",
				},
				streamId,
			)

			await dbPool.commitWork(streamId)
			return stream
		} catch (error) {
			await dbPool.rollbackWork(
				streamId,
				`Stream creation failed: ${error instanceof Error ? error.message : String(error)}`,
			)
			throw error
		}
	}

	public async createTask(streamId: string, description: string): Promise<AgentTask> {
		const now = Date.now()
		const task: AgentTask = {
			id: uuidv4(),
			streamId,
			description,
			status: "pending",
			result: null,
			createdAt: now,
		}

		// Push directly to global buffer — no shadow needed since this is
		// a single atomic insert that should be flushed immediately.
		await dbPool.push({
			type: "insert",
			table: "agent_tasks",
			values: { ...task, metadata: null },
			layer: "infrastructure",
		})

		return task
	}

	public async updateTaskStatus(
		taskId: string,
		status: AgentTask["status"],
		result: string | null = null,
		metadata?: TaskAuditMetadata,
	): Promise<void> {
		await dbPool.push({
			type: "update",
			table: "agent_tasks",
			values: { status, result, metadata: metadata ? JSON.stringify(metadata) : undefined },
			where: { column: "id", value: taskId },
			layer: "infrastructure",
		})
	}

	public async getActiveStreams(requestingAgentId?: string): Promise<AgentStream[]> {
		const all = await dbPool.selectAllFrom("agent_streams", requestingAgentId)
		return all.filter((s) => s.status === "active")
	}

	public async getStreamByExternalId(externalId: string): Promise<AgentStream | null> {
		return dbPool.selectOne("agent_streams", { column: "externalId", value: externalId })
	}

	public async storeMemory(streamId: string, key: string, value: string): Promise<void> {
		await dbPool.push(
			{
				type: "upsert",
				table: "agent_memory",
				values: { streamId, key, value, updatedAt: Date.now() },
				layer: "domain",
			},
			streamId,
			`agent_memory:${streamId}:${key}`,
		)
	}

	public async recallMemory(streamId: string, key: string): Promise<string | null> {
		const found = await dbPool.selectOne(
			"agent_memory",
			[
				{ column: "streamId", value: streamId },
				{ column: "key", value: key },
			],
			streamId,
		)
		return found ? found.value : null
	}

	public async getStreamTasks(streamId: string, requestingAgentId?: string): Promise<AgentTask[]> {
		const results = await dbPool.selectWhere("agent_tasks", { column: "streamId", value: streamId }, requestingAgentId)
		return results.map((t) => ({
			...t,
			metadata: t.metadata ? JSON.parse(t.metadata) : undefined,
		})) as AgentTask[]
	}

	// ── Subagent Signaling Protocol ──────────────────────────────────

	/**
	 * Spawn a child stream linked to a parent. The parent stream ID
	 * is recorded to reconstruct the execution tree later.
	 */
	public async spawnChildStream(parentStreamId: string, focus: string): Promise<AgentStream> {
		return this.createStream(focus, parentStreamId)
	}

	/**
	 * Get all child streams for a given parent.
	 */
	public async getChildStreams(parentStreamId: string): Promise<AgentStream[]> {
		return dbPool.selectWhere("agent_streams", { column: "parentId", value: parentStreamId })
	}

	/**
	 * Mark a stream as completed and store a summary in agent memory.
	 */
	public async completeStream(streamId: string, summary: string): Promise<void> {
		// Commit any pending shadow work before storing the completion summary
		await dbPool.commitWork(streamId)

		await dbPool.push({
			type: "update",
			table: "agent_streams",
			values: { status: "completed" },
			where: { column: "id", value: streamId },
			layer: "infrastructure",
		})
		// Persist the final summary — pushed directly to global since shadow was just committed
		await dbPool.push({
			type: "upsert",
			table: "agent_memory",
			values: { streamId, key: "stream_summary", value: summary, updatedAt: Date.now() },
			layer: "domain",
		})
	}

	/**
	 * Mark a stream as failed and store the error reason.
	 */
	public async failStream(streamId: string, reason: string): Promise<void> {
		await dbPool.push({
			type: "update",
			table: "agent_streams",
			values: { status: "failed" },
			where: { column: "id", value: streamId },
			layer: "infrastructure",
		})
		await this.storeMemory(streamId, "failure_reason", reason)
	}

	// ── Context-Window Compression ──────────────────────────────────

	/**
	 * Generate a compressed context digest for a stream.
	 * Retrieves all tasks and memory entries, then produces
	 * a compact JSON summary suitable for injection into a
	 * new agent's context window.
	 */
	public async getCompressedContext(streamId: string): Promise<string> {
		const tasks = await this.getStreamTasks(streamId)
		const summary = await this.recallMemory(streamId, "stream_summary")
		const failureReason = await this.recallMemory(streamId, "failure_reason")

		// Count child streams
		const allStreams = await dbPool.selectAllFrom("agent_streams")
		const childStreams = allStreams.filter((s) => s.parentId === streamId)

		const completedTasks = tasks.filter((t) => t.status === "completed").length
		const failedTasks = tasks.filter((t) => t.status === "failed").length
		const violations = tasks
			.filter((t) => t.metadata?.joy_zoning_violations)
			.flatMap((t) => t.metadata!.joy_zoning_violations as string[])

		const avgEntropy =
			tasks
				.filter((t) => t.metadata?.entropy_score !== undefined)
				.reduce((acc, t) => acc + (t.metadata!.entropy_score || 0), 0) /
			(tasks.filter((t) => t.metadata?.entropy_score !== undefined).length || 1)

		const digest = {
			streamId,
			summary: summary || "No summary available",
			failureReason: failureReason || undefined,
			taskCount: tasks.length,
			completedTasks,
			failedTasks,
			childStreamCount: childStreams.length,
			activeChildStreams: childStreams.filter((s) => s.status === "active").length,
			uniqueViolations: [...new Set(violations)],
			avgEntropy: Number(avgEntropy.toFixed(2)),
			lastActivity: tasks.length > 0 ? Math.max(...tasks.map((t) => t.createdAt)) : null,
		}

		return JSON.stringify(digest, null, 2)
	}

	// ── Fluid Coordination Hooks ─────────────────────────────────────

	/**
	 * Check if any files being touched by the requesting stream
	 * are currently locked/mutated by a sibling stream.
	 */
	public async checkCollision(requestingStreamId: string, files: string[]): Promise<string | null> {
		const activeFiles = await dbPool.getActiveAffectedFiles()
		for (const file of files) {
			const agentId = activeFiles.get(file)
			if (agentId && agentId !== requestingStreamId) {
				return `Collision detected: File '${path.basename(file)}' is currently being modified by Stream ${agentId.slice(0, 8)}.`
			}
		}
		return null
	}

	/**
	 * Calculate result entropy (divergence severity).
	 * Simple length-based delta for now, but provides a 0-1 score.
	 */
	/**
	 * Calculates a physical entropy score (0.0-1.0) based on content divergence.
	 * Uses Jaccard Similarity on 3-gram sets for structural comparison.
	 */
	public calculateEntropy(prev: string | null, current: string): number {
		if (!prev) return 0
		if (prev === current) return 0

		const getGrams = (str: string, size = 3): Set<string> => {
			const grams = new Set<string>()
			for (let i = 0; i <= str.length - size; i++) {
				grams.add(str.slice(i, i + size))
			}
			return grams
		}

		const gramsPrev = getGrams(prev)
		const gramsCurr = getGrams(current)

		if (gramsPrev.size === 0 || gramsCurr.size === 0) return 1.0

		const intersection = new Set([...gramsPrev].filter((x) => gramsCurr.has(x)))
		const union = new Set([...gramsPrev, ...gramsCurr])

		const similarity = intersection.size / union.size
		const entropy = 1 - similarity

		return Number(entropy.toFixed(2))
	}
}

export const orchestrator = new AgentOrchestrator()
