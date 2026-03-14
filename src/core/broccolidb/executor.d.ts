/**
 * ExecuteOptions defines the reliability parameters for an agent action.
 */
export interface ExecuteOptions {
	timeoutMs?: number
	maxRetries?: number
	backoffMs?: number
	concurrencyGroup?: string
}
/**
 * ActionExecutor manages the lifecycle of agent-initiated repository actions.
 * It provides concurrency limiting, retries, and timeout protection.
 *
 * Inspired by production-grade hardening in openclaw-marie.
 */
export declare class ActionExecutor {
	private static activeOperations
	private static MAX_CONCURRENCY
	/**
	 * Execute an async task with retries and timeout protection.
	 */
	execute<T>(taskId: string, operation: () => Promise<T>, options?: ExecuteOptions): Promise<T>
	private static queues
	private withConcurrency
	private withTimeout
	private isRetryableError
}
export declare const executor: ActionExecutor
//# sourceMappingURL=executor.d.ts.map
