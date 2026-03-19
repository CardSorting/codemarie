import should from "should"
import { CodemarieStorageMessage } from "../../../shared/messages/content"
import { ApiHandler } from "../../api"
import { ApiStreamChunk } from "../../api/transform/stream"
import { OrchestrationController } from "../OrchestrationController"
import { StreamPool } from "../StreamPool"
import type { KanbanTask } from "../systems/KanbanSystem"

// ── Mock Infrastructure ──────────────────────────────────────────

class MockApiHandler implements Partial<ApiHandler> {
	public callCount = 0

	async *createMessage(_prompt: string, _msgs: CodemarieStorageMessage[]): AsyncGenerator<ApiStreamChunk> {
		this.callCount++
		// Simulate a short async delay to test concurrency
		await new Promise((resolve) => setTimeout(resolve, 10))
		yield {
			type: "text",
			text: JSON.stringify({
				actions: [{ type: "create", file: `src/task-${this.callCount}.ts`, description: "Create file" }],
				file: `src/task-${this.callCount}.ts`,
				content: `// Content for task ${this.callCount}`,
				explanation: "Implemented successfully",
				dependencies: [],
				verification: "Unit test",
			}),
		} as ApiStreamChunk
	}
}

class FailingApiHandler implements Partial<ApiHandler> {
	public callCount = 0

	async *createMessage(_prompt: string, _msgs: CodemarieStorageMessage[]): AsyncGenerator<ApiStreamChunk> {
		this.callCount++
		if (this.callCount === 2) {
			throw new Error("Simulated API failure for worker 2")
		}
		yield {
			type: "text",
			text: JSON.stringify({
				actions: [],
				dependencies: [],
				verification: "OK",
			}),
		} as ApiStreamChunk
	}
}

class MockOrchestrationController {
	private memory = new Map<string, string>()

	getStreamId() {
		return "test-pool-parent"
	}

	async getAgentContext() {
		return {
			addKnowledge: async () => true,
			appendMemoryLayer: async () => true,
			detectContradictions: async () => [],
			flush: async () => true,
			selfHealGraph: async () => ({ prunedNodes: [] }),
			spawnTask: async () => true,
			autoDiscoverRelationships: async () => ({ discovered: 0 }),
		}
	}

	async beginTask() {}
	async updateTaskProgress() {}
	async beginDbShadow() {}
	async completeStream() {
		return true
	}
	async failStream() {}
	async getStreamDigest() {
		return "{}"
	}

	async storeMemory(key: string, value: string) {
		this.memory.set(key, value)
	}

	async recallMemory(key: string) {
		return this.memory.get(key) || null
	}
}

// ── Tests ────────────────────────────────────────────────────────

describe("StreamPool", () => {
	let mockController: MockOrchestrationController

	beforeEach(() => {
		mockController = new MockOrchestrationController()
	})

	it("should dispatch all tasks and return aggregated results", async () => {
		const handler = new MockApiHandler() as unknown as ApiHandler
		const pool = new StreamPool(mockController as unknown as OrchestrationController, handler, {
			maxConcurrency: 3,
			parentStreamId: "test-pool-parent",
		})

		const tasks: KanbanTask[] = [
			{ id: "task-a", description: "Task A", depends_on: [] },
			{ id: "task-b", description: "Task B", depends_on: [] },
			{ id: "task-c", description: "Task C", depends_on: [] },
		]
		const result = await pool.dispatch(tasks)

		should(result.totalTasks).equal(3)
		should(result.results.length).equal(3)
		should(result.durationMs).be.greaterThan(0)
	})

	it("should return empty result for zero tasks", async () => {
		const handler = new MockApiHandler() as unknown as ApiHandler
		const pool = new StreamPool(mockController as unknown as OrchestrationController, handler, {
			maxConcurrency: 3,
			parentStreamId: "test-pool-parent",
		})

		const tasks: KanbanTask[] = []
		const result = await pool.dispatch(tasks)

		should(result.totalTasks).equal(0)
		should(result.completed).equal(0)
		should(result.failed).equal(0)
		should(result.results.length).equal(0)
	})

	it("should handle more tasks than concurrency limit", async () => {
		const handler = new MockApiHandler() as unknown as ApiHandler
		const pool = new StreamPool(mockController as unknown as OrchestrationController, handler, {
			maxConcurrency: 2, // Lower than total tasks
			parentStreamId: "test-pool-parent",
		})

		const result = await pool.dispatch([
			{ id: "t1", description: "T1", depends_on: [] },
			{ id: "t2", description: "T2", depends_on: [] },
			{ id: "t3", description: "T3", depends_on: [] },
			{ id: "t4", description: "T4", depends_on: [] },
			{ id: "t5", description: "T5", depends_on: [] },
		])

		should(result.totalTasks).equal(5)
		should(result.results.length).equal(5)
	})

	it("should isolate failures so one worker crashing doesn't kill the pool", async () => {
		const handler = new FailingApiHandler() as unknown as ApiHandler
		const pool = new StreamPool(mockController as unknown as OrchestrationController, handler, {
			maxConcurrency: 3,
			parentStreamId: "test-pool-parent",
		})

		const result = await pool.dispatch([
			{ id: "good1", description: "Good Task 1", depends_on: [] },
			{ id: "bad", description: "Bad Task", depends_on: [] },
			{ id: "good2", description: "Good Task 2", depends_on: [] },
		])

		should(result.totalTasks).equal(3)
		// At least 2 should succeed, 1 should fail
		should(result.results.length).equal(3)
		const failedResults = result.results.filter((r: any) => r.status === "failed")
		should(failedResults.length).be.greaterThan(0)
	})

	it("should store aggregated results in parent stream memory", async () => {
		const handler = new MockApiHandler() as unknown as ApiHandler
		const pool = new StreamPool(mockController as unknown as OrchestrationController, handler, {
			maxConcurrency: 2,
			parentStreamId: "test-pool-parent",
		})

		await pool.dispatch([{ id: "tx", description: "Task X", depends_on: [] }])

		const stored = await mockController.recallMemory("concurrent_build_results")
		should(stored).not.be.null()
		const parsed = JSON.parse(stored!)
		should(parsed.totalTasks).equal(1)
	})
})
