import admin from "firebase-admin"
export interface EnvironmentMetadata {
	osName: string
	osVersion: string
	osArch: string
	hostName: string
	nodeVersion: string
	timestamp: string
}
export declare class EnvironmentTracker {
	private static PRICING
	private static DEFAULT_TASK_BUDGET
	private static trackerCache
	/**
	 * Captures the current system and process environment metadata.
	 */
	static capture(): EnvironmentMetadata
	/**
	 * Configure model pricing rates.
	 */
	static setPricing(
		modelId: string,
		rates: {
			input: number
			output: number
		},
	): void
	/**
	 * Estimates cost for a given usage.
	 */
	static estimateCost(usage: { promptTokens: number; completionTokens: number; modelId?: string; pricingTier?: string }): number
	/**
	 * Persists usage data to the repository's telemetry collection and updates O(1) aggregates.
	 */
	static recordUsage(
		db: admin.firestore.Firestore,
		basePath: string,
		agentId: string,
		usage: {
			promptTokens: number
			completionTokens: number
			modelId?: string
		},
		taskId?: string,
	): Promise<void>
	/**
	 * Retrieves aggregate telemetry stats.
	 * Optimized to read from pre-computed aggregate documents (O(1)).
	 */
	static getStats(
		db: admin.firestore.Firestore,
		basePath: string,
		agentId?: string,
		taskId?: string,
	): Promise<{
		totalCommits: number
		totalTokens: number
		totalCost: number
	}>
	/**
	 * Generates a usage report string with efficiency metrics and budget status.
	 */
	static getReport(
		stats: {
			totalCommits: number
			totalTokens: number
			totalCost: number
		},
		budget?: number,
	): string
	/**
	 * Calculates the dynamic budget for a specific task based on its complexity.
	 */
	static getTaskBudget(db: admin.firestore.Firestore, basePath: string, taskId: string): Promise<number>
	/**
	 * Checks if a task has exceeded its budget.
	 * Now dynamic: Limit = DEFAULT_TASK_BUDGET * Task.Complexity
	 */
	static isOverBudget(db: admin.firestore.Firestore, basePath: string, taskId: string): Promise<boolean>
}
export interface TelemetryPayload {
	agentId: string
	usage: {
		promptTokens: number
		completionTokens: number
		modelId?: string
	}
	taskId?: string
}
/**
 * Background queue for async telemetry offloading to ensure commit hot-path remains unblocked.
 *
 * Batches telemetry requests and periodically persists them to Firestore.
 */
export declare class AsyncTelemetryQueue {
	private maxBatchSize
	private flushIntervalMs
	private queue
	private flushTimer
	private isFlushing
	constructor(maxBatchSize?: number, flushIntervalMs?: number)
	enqueue(db: admin.firestore.Firestore, basePath: string, payload: TelemetryPayload): void
	flush(): Promise<void>
	/**
	 * Immediately drains all items in the queue.
	 */
	drain(): Promise<void>
	get stats(): {
		pending: number
		isFlushing: boolean
	}
}
export declare const telemetryQueue: AsyncTelemetryQueue
//# sourceMappingURL=tracker.d.ts.map
