export declare class TaskMutex {
	private static locks
	/**
	 * Acquires a lock for a specific key and executes the provided function exclusively.
	 * Includes timeout protection to prevent deadlocks.
	 */
	static runExclusive<T>(key: string, fn: () => Promise<T>, timeoutMs?: number): Promise<T>
}
//# sourceMappingURL=mutex.d.ts.map
