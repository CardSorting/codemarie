/**
 * Shared types for storage.
 * Extracted to a separate file to break circular dependencies between
 * storage implementations and adapters.
 */
export interface BlobStoreSettings {
	bucket: string
	adapterType: "s3" | "r2" | string
	accessKeyId: string
	secretAccessKey: string
	region?: string
	endpoint?: string
	accountId?: string

	/** Interval between sync attempts in milliseconds (default: 30000 = 30s) */
	intervalMs?: number
	/** Maximum number of retries before giving up on an item (default: 5) */
	maxRetries?: number
	/** Batch size - how many items to process per interval (default: 10) */
	batchSize?: number
	/** Maximum queue size before eviction (default: 1000) */
	maxQueueSize?: number
	/** Maximum age for failed items in milliseconds (default: 7 days) */
	maxFailedAgeMs?: number
	/** Whether to backfill existing unsynced items on startup (default: false) */
	backfillEnabled?: boolean
}

export interface StorageAdapter {
	read(path: string): Promise<string | undefined>
	write(path: string, value: string): Promise<void>
	remove(path: string): Promise<void>
}

export type Mode = "plan" | "act"
export type OpenaiReasoningEffort = "low" | "medium" | "high" | "none" | undefined

export const OPENAI_REASONING_EFFORT_OPTIONS = ["low", "medium", "high", "none"] as const

export function isOpenaiReasoningEffort(effort: any): effort is OpenaiReasoningEffort {
	return effort === "low" || effort === "medium" || effort === "high" || effort === "none" || effort === undefined
}

export function normalizeOpenaiReasoningEffort(effort?: any): OpenaiReasoningEffort {
	if (isOpenaiReasoningEffort(effort)) {
		return effort
	}
	return undefined
}
