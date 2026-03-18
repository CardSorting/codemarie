import should from "should"
import { ApiHandler } from "../../api"
import { ApiStreamChunk } from "../../api/transform/stream"
import { OrchestrationController } from "../OrchestrationController"
import { StreamCoordinator } from "../StreamCoordinator"
import type { KanbanTask } from "../systems/KanbanSystem"
import { WorkerStream } from "../WorkerStream"

class MockApiHandler implements Partial<ApiHandler> {
	async *createMessage(): AsyncGenerator<ApiStreamChunk> {
		yield {
			type: "text",
			text: JSON.stringify({
				actions: [{ type: "modify", file: `src/main.ts`, description: "edit" }],
			}),
		} as ApiStreamChunk
	}
}

class MockCoordinator extends StreamCoordinator {
	public collisionCheckCount = 0
	public acquireFailures = 0
	public registerCount = 0
	public deregisterCount = 0
	public releaseLocksCount = 0

	override async checkCollision() {
		this.collisionCheckCount++
		return null
	}

	override tryAcquireFileLock(_filePath: string, _streamId: string) {
		if (this.acquireFailures > 0) {
			this.acquireFailures--
			return false
		}
		return true
	}

	override registerWorker() {
		this.registerCount++
	}

	override deregisterWorker() {
		this.deregisterCount++
	}

	override releaseWorkerLocks() {
		this.releaseLocksCount++
	}
}

class MockController {
	public failStreamThrows = false

	getStreamId() {
		return "parent-id"
	}
	async beginDbShadow() {}
	async beginTask() {}
	async updateTaskProgress() {}
	async storeMemory() {}
	async completeStream() {
		return true
	}

	async failStream(_error: any) {
		if (this.failStreamThrows) {
			throw new Error("Simulated rollback crash")
		}
	}

	async getStreamDigest() {
		return "{}"
	}
}

describe("WorkerStream Hardening", () => {
	it("should apply test-and-set retry loop for lock acquisition", async () => {
		const handler = new MockApiHandler() as unknown as ApiHandler
		const coordinator = new MockCoordinator("parent")
		coordinator.acquireFailures = 2 // Fail twice, succeed on third

		const controller = new MockController() as unknown as OrchestrationController

		const dummyTask: KanbanTask = { id: "t1", description: "Test", depends_on: [] }
		const worker = new WorkerStream(controller, handler, coordinator, dummyTask, "", "u1", "w1")

		// Speed up backoff for test
		const originalMathRandom = Math.random
		Math.random = () => 0 // Eliminate jitter

		const result = await worker.execute()

		Math.random = originalMathRandom

		should(result.status).equal("completed")
		// 1 initial + 2 retries = 3 checks total
		should(coordinator.collisionCheckCount).equal(3)
		// It should have released locks during the 2 failures
		should(coordinator.releaseLocksCount).equal(2)
	})

	it("should abort after MAX_ATTEMPTS for lock acquisition", async () => {
		const handler = new MockApiHandler() as unknown as ApiHandler
		const coordinator = new MockCoordinator("parent")
		coordinator.acquireFailures = 10 // Fail forever

		const controller = new MockController() as unknown as OrchestrationController

		const dummyTask: KanbanTask = { id: "t1", description: "Test", depends_on: [] }
		const worker = new WorkerStream(controller, handler, coordinator, dummyTask, "", "u1", "w1")

		const originalMathRandom = Math.random
		Math.random = () => 0

		const result = await worker.execute()

		Math.random = originalMathRandom

		should(result.status).equal("failed")
		should(result.error).match(/Persistent file collision after 5 attempts/)
		should(coordinator.collisionCheckCount).equal(5)
	})

	it("should guarantee deregistration even if failStream crashes", async () => {
		const handler = new MockApiHandler() as unknown as ApiHandler
		const coordinator = new MockCoordinator("parent")
		coordinator.acquireFailures = 10 // Force failure

		const controller = new MockController()
		controller.failStreamThrows = true // Crash during rollback

		const dummyTask: KanbanTask = { id: "t1", description: "Test", depends_on: [] }
		const worker = new WorkerStream(
			controller as unknown as OrchestrationController,
			handler,
			coordinator,
			dummyTask,
			"",
			"u1",
			"w1",
		)

		const originalMathRandom = Math.random
		Math.random = () => 0
		const result = await worker.execute()
		Math.random = originalMathRandom

		should(result.status).equal("failed")
		// Deregister must run despite the crash in catch block
		should(coordinator.deregisterCount).equal(1)
	})
})
