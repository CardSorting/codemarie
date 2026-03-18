import should from "should"
import { StreamCoordinator } from "../StreamCoordinator"

describe("StreamCoordinator", () => {
	let coordinator: StreamCoordinator

	beforeEach(() => {
		coordinator = new StreamCoordinator("parent-stream-id")
	})

	describe("File Lock Registry", () => {
		it("should acquire a file lock for a worker", () => {
			const acquired = coordinator.tryAcquireFileLock("src/main.ts", "worker-1")
			should(acquired).be.true()
		})

		it("should allow the same worker to re-acquire its own lock", () => {
			coordinator.tryAcquireFileLock("src/main.ts", "worker-1")
			const reAcquired = coordinator.tryAcquireFileLock("src/main.ts", "worker-1")
			should(reAcquired).be.true()
		})

		it("should reject a lock request from a different worker", () => {
			coordinator.tryAcquireFileLock("src/main.ts", "worker-1")
			const acquired = coordinator.tryAcquireFileLock("src/main.ts", "worker-2")
			should(acquired).be.false()
		})

		it("should release all locks for a specific worker", () => {
			coordinator.tryAcquireFileLock("src/a.ts", "worker-1")
			coordinator.tryAcquireFileLock("src/b.ts", "worker-1")
			coordinator.releaseWorkerLocks("worker-1")

			// Another worker should now be able to lock those files
			const acquired = coordinator.tryAcquireFileLock("src/a.ts", "worker-2")
			should(acquired).be.true()
		})
	})

	describe("Worker Lifecycle", () => {
		it("should register and deregister workers", () => {
			coordinator.registerWorker("worker-1")
			coordinator.registerWorker("worker-2")
			should(coordinator.getActiveWorkerCount()).equal(2)

			coordinator.deregisterWorker("worker-1")
			should(coordinator.getActiveWorkerCount()).equal(1)
		})

		it("should release file locks upon deregistration", () => {
			coordinator.registerWorker("worker-1")
			coordinator.tryAcquireFileLock("src/file.ts", "worker-1")
			coordinator.deregisterWorker("worker-1")

			const acquired = coordinator.tryAcquireFileLock("src/file.ts", "worker-2")
			should(acquired).be.true()
		})

		it("should correctly report pool drained state", () => {
			should(coordinator.isPoolDrained()).be.true()

			coordinator.registerWorker("worker-1")
			should(coordinator.isPoolDrained()).be.false()

			coordinator.deregisterWorker("worker-1")
			should(coordinator.isPoolDrained()).be.true()
		})

		it("should return active worker IDs", () => {
			coordinator.registerWorker("w1")
			coordinator.registerWorker("w2")
			const ids = coordinator.getActiveWorkerIds()
			should(ids).have.length(2)
			should(ids).containDeep(["w1", "w2"])
		})
	})
})
