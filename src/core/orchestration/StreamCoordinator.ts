import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { Logger } from "@/shared/services/Logger"

/**
 * StreamCoordinator: Inter-stream signaling and coordination layer.
 *
 * Manages file-level locks, collision resolution, progress aggregation,
 * and shutdown coordination for concurrent WorkerStreams within a StreamPool.
 */
export class StreamCoordinator {
	private name = "StreamCoordinator"

	/** Maps file paths to the streamId currently editing them. */
	private fileLocks = new Map<string, string>()

	/** Tracks active worker stream IDs for aggregation. */
	private activeWorkers = new Set<string>()

	constructor(private parentStreamId: string) {}

	// ── File Lock Registry ──────────────────────────────────────────

	/**
	 * Attempts to acquire a file lock for a given worker stream.
	 * Returns true if the lock was acquired, false if the file is
	 * already locked by another worker.
	 */
	public tryAcquireFileLock(filePath: string, workerStreamId: string): boolean {
		const holder = this.fileLocks.get(filePath)
		if (holder && holder !== workerStreamId) {
			Logger.info(
				`[${this.name}] File lock contention: '${filePath}' held by ${holder.slice(0, 8)}, requested by ${workerStreamId.slice(0, 8)}`,
			)
			return false
		}
		this.fileLocks.set(filePath, workerStreamId)
		return true
	}

	/**
	 * Releases all file locks held by a specific worker stream.
	 */
	public releaseWorkerLocks(workerStreamId: string): void {
		for (const [file, holder] of this.fileLocks.entries()) {
			if (holder === workerStreamId) {
				this.fileLocks.delete(file)
			}
		}
	}

	/**
	 * Checks for file collisions using the Orchestrator's native collision detection.
	 * This consults the BufferedDbPool's active affected files across all streams.
	 */
	public async checkCollision(workerStreamId: string, files: string[]): Promise<string | null> {
		// First check local coordinator locks
		for (const file of files) {
			const holder = this.fileLocks.get(file)
			if (holder && holder !== workerStreamId) {
				return `Collision: '${file}' is locked by worker ${holder.slice(0, 8)}.`
			}
		}
		// Then check global orchestrator-level collisions
		return orchestrator.checkCollision(workerStreamId, files)
	}

	// ── Worker Lifecycle ────────────────────────────────────────────

	/**
	 * Registers a worker stream as active.
	 */
	public registerWorker(workerStreamId: string): void {
		this.activeWorkers.add(workerStreamId)
	}

	/**
	 * Deregisters a worker stream and releases its locks.
	 */
	public deregisterWorker(workerStreamId: string): void {
		this.activeWorkers.delete(workerStreamId)
		this.releaseWorkerLocks(workerStreamId)
	}

	/**
	 * Returns the count of currently active workers.
	 */
	public getActiveWorkerCount(): number {
		return this.activeWorkers.size
	}

	// ── Progress Aggregation ────────────────────────────────────────

	/**
	 * Collects and merges StreamDigests from all active child streams
	 * into a unified parent digest.
	 */
	public async getAggregatedDigest(): Promise<string> {
		const childDigests: any[] = []

		for (const workerId of this.activeWorkers) {
			try {
				const raw = await orchestrator.getCompressedContext(workerId)
				childDigests.push(JSON.parse(raw))
			} catch (err) {
				Logger.warn(`[${this.name}] Failed to get digest for worker ${workerId.slice(0, 8)}:`, err)
			}
		}

		try {
			const parentRaw = await orchestrator.getCompressedContext(this.parentStreamId)
			const parentDigest = JSON.parse(parentRaw)

			const aggregated = {
				parentStream: parentDigest,
				activeWorkers: this.activeWorkers.size,
				childStreams: childDigests,
				totalTasks: childDigests.reduce((sum, d) => sum + (d.taskCount || 0), 0),
				totalCompleted: childDigests.reduce((sum, d) => sum + (d.completedTasks || 0), 0),
				totalFailed: childDigests.reduce((sum, d) => sum + (d.failedTasks || 0), 0),
				allViolations: [...new Set(childDigests.flatMap((d) => d.uniqueViolations || []))],
			}

			return JSON.stringify(aggregated, null, 2)
		} catch (err) {
			Logger.error(`[${this.name}] Failed to aggregate digests:`, err)
			return "{}"
		}
	}

	// ── Shutdown Coordination ───────────────────────────────────────

	/**
	 * Returns true if all workers have been deregistered (pool is drained).
	 */
	public isPoolDrained(): boolean {
		return this.activeWorkers.size === 0
	}

	/**
	 * Returns the set of active worker stream IDs (for monitoring/UI).
	 */
	public getActiveWorkerIds(): string[] {
		return [...this.activeWorkers]
	}
}
