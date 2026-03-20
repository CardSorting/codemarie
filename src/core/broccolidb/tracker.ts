import * as crypto from "node:crypto"
import * as os from "os"
import { BufferedDbPool } from "@/infrastructure/db/BufferedDbPool"
import { Logger } from "@/shared/services/Logger"
import { LRUCache } from "./lru-cache"

export interface EnvironmentMetadata {
	osName: string
	osVersion: string
	osArch: string
	hostName: string
	nodeVersion: string
	timestamp: string
}

export class EnvironmentTracker {
	// Production Parameterized Constants
	private static CONFIG = {
		DEFAULT_PRICING: {
			"tier-high": { input: 0.01, output: 0.03 },
			"tier-medium": { input: 0.003, output: 0.015 },
			"tier-low": { input: 0.0005, output: 0.0015 },
			default: { input: 0.002, output: 0.008 },
		},
		CACHE_SIZE: 100,
	}

	private static PRICING: Record<string, { input: number; output: number }> = { ...EnvironmentTracker.CONFIG.DEFAULT_PRICING }
	private static trackerCache = new LRUCache<string, any>(EnvironmentTracker.CONFIG.CACHE_SIZE)

	/**
	 * Captures the current system and process environment metadata.
	 */
	static capture(): EnvironmentMetadata {
		return {
			osName: os.platform(),
			osVersion: os.release(),
			osArch: os.arch(),
			hostName: os.hostname(),
			nodeVersion: process.version,
			timestamp: new Date().toISOString(),
		}
	}

	/**
	 * Configure model pricing rates.
	 */
	static setPricing(modelId: string, rates: { input: number; output: number }) {
		EnvironmentTracker.PRICING[modelId] = rates
	}

	/**
	 * Estimates cost for a given usage.
	 */
	static estimateCost(usage: {
		promptTokens: number
		completionTokens: number
		modelId?: string
		pricingTier?: string
	}): number {
		const tier = usage.pricingTier || usage.modelId || "default"
		const rates = EnvironmentTracker.PRICING[tier] || EnvironmentTracker.PRICING.default!
		return (usage.promptTokens / 1000) * rates.input + (usage.completionTokens / 1000) * rates.output
	}

	/**
	 * Persists usage data to the repository's telemetry collection and updates O(1) aggregates.
	 */
	static async recordUsage(
		db: BufferedDbPool,
		basePath: string,
		agentId: string,
		usage: { promptTokens: number; completionTokens: number; modelId?: string },
		taskId?: string | null,
	) {
		const cost = EnvironmentTracker.estimateCost(usage)
		const tokens = usage.promptTokens + usage.completionTokens

		// 1. Detailed Audit Record
		await db.push({
			type: "insert",
			table: "telemetry",
			values: {
				id: crypto.randomUUID(),
				repoPath: basePath,
				agentId,
				taskId: taskId || null,
				promptTokens: usage.promptTokens,
				completionTokens: usage.completionTokens,
				totalTokens: tokens,
				modelId: usage.modelId || "default",
				cost,
				timestamp: Date.now(),
				environment: JSON.stringify(EnvironmentTracker.capture()),
			},
			layer: "infrastructure",
		})

		const inc = (v: number) => BufferedDbPool.increment(v)

		// 2. Global Aggregates
		await db.push({
			type: "upsert",
			table: "telemetry_aggregates",
			where: [
				{ column: "repoPath", value: basePath },
				{ column: "id", value: "global" },
			],
			values: {
				repoPath: basePath,
				id: "global",
				totalCommits: inc(1),
				totalTokens: inc(tokens),
				totalCost: inc(cost),
			},
			layer: "infrastructure",
		})

		// 3. Agent Aggregates
		await db.push({
			type: "upsert",
			table: "telemetry_aggregates",
			where: [
				{ column: "repoPath", value: basePath },
				{ column: "id", value: `agent_${agentId}` },
			],
			values: {
				repoPath: basePath,
				id: `agent_${agentId}`,
				totalCommits: inc(1),
				totalTokens: inc(tokens),
				totalCost: inc(cost),
			},
			layer: "infrastructure",
		})

		// 4. Task Aggregates
		if (taskId) {
			await db.push({
				type: "upsert",
				table: "telemetry_aggregates",
				where: [
					{ column: "repoPath", value: basePath },
					{ column: "id", value: `task_${taskId}` },
				],
				values: {
					repoPath: basePath,
					id: `task_${taskId}`,
					totalCommits: inc(1),
					totalTokens: inc(tokens),
					totalCost: inc(cost),
				},
				layer: "infrastructure",
			})
		}

		// Invalidate caches
		EnvironmentTracker.trackerCache.delete("global")
		EnvironmentTracker.trackerCache.delete(`agent_${agentId}`)
		if (taskId) EnvironmentTracker.trackerCache.delete(`task_${taskId}`)
	}

	/**
	 * Retrieves aggregate telemetry stats.
	 * Optimized to read from pre-computed aggregate documents (O(1)).
	 */
	static async getStats(
		db: BufferedDbPool,
		basePath: string,
		agentId?: string,
		taskId?: string,
	): Promise<{ totalCommits: number; totalTokens: number; totalCost: number }> {
		let docId = "global"

		if (taskId) docId = `task_${taskId}`
		else if (agentId) docId = `agent_${agentId}`

		const cached = EnvironmentTracker.trackerCache.get(docId)
		if (cached) return cached

		const row = await db.selectOne("telemetry_aggregates", [
			{ column: "repoPath", value: basePath },
			{ column: "id", value: docId },
		])

		if (!row) {
			return { totalCommits: 0, totalTokens: 0, totalCost: 0 }
		}

		const statsObj = {
			totalCommits: row.totalCommits || 0,
			totalTokens: row.totalTokens || 0,
			totalCost: row.totalCost || 0,
		}
		EnvironmentTracker.trackerCache.set(docId, statsObj)
		return statsObj
	}

	static getReport(stats: { totalCommits: number; totalTokens: number; totalCost: number }): string {
		const efficiency = stats.totalCommits > 0 ? (stats.totalTokens / stats.totalCommits).toFixed(0) : "0"

		return `
=== AgentGit Usage Report ===
Total Commits:  ${stats.totalCommits}
Total Tokens:   ${stats.totalTokens.toLocaleString()}
Estimated Cost: $${stats.totalCost.toFixed(4)}
-----------------------------
Avg Tokens/Commit: ${efficiency}
=============================
    `.trim()
	}
}

export interface TelemetryPayload {
	agentId: string
	usage: { promptTokens: number; completionTokens: number; modelId?: string }
	taskId?: string | null
}

/**
 * Background queue for async telemetry offloading to ensure commit hot-path remains unblocked.
 *
 * Batches telemetry requests and periodically persists them to Firestore.
 */
export class AsyncTelemetryQueue {
	private queue: Array<{ payload: TelemetryPayload; db: BufferedDbPool; basePath: string }> = []
	private flushTimer: ReturnType<typeof setTimeout> | null = null
	private isFlushing = false

	constructor(
		private maxBatchSize = 10,
		private flushIntervalMs = 2000,
	) {}

	enqueue(db: BufferedDbPool, basePath: string, payload: TelemetryPayload) {
		this.queue.push({ payload, db, basePath })
		if (this.queue.length >= this.maxBatchSize && !this.isFlushing) {
			this.flush()
		} else if (!this.flushTimer) {
			this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs)
		}
	}

	async flush(): Promise<void> {
		if (this.queue.length === 0 || this.isFlushing) return
		this.isFlushing = true

		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
			this.flushTimer = null
		}

		const batchToProcess = this.queue.splice(0, this.maxBatchSize)

		try {
			// Process in parallel using Promise.allSettled
			await Promise.allSettled(
				batchToProcess.map(({ payload, db, basePath }) =>
					EnvironmentTracker.recordUsage(db, basePath, payload.agentId, payload.usage, payload.taskId),
				),
			)
		} catch (err) {
			Logger.error("[AsyncTelemetryQueue] Batch flush failed:", err)
		} finally {
			this.isFlushing = false
			// If items accumulated while flushing, trigger next flush
			if (this.queue.length > 0 && !this.flushTimer) {
				this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs)
			}
		}
	}

	/**
	 * Immediately drains all items in the queue.
	 */
	async drain(): Promise<void> {
		while (this.queue.length > 0 || this.isFlushing) {
			if (this.isFlushing) {
				await new Promise((r) => setTimeout(r, 50))
			} else {
				await this.flush()
			}
		}
	}

	get stats() {
		return {
			pending: this.queue.length,
			isFlushing: this.isFlushing,
		}
	}
}

export const telemetryQueue = new AsyncTelemetryQueue()
