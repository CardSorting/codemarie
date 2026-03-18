import should from "should"
import { CodemarieStorageMessage } from "../../../../shared/messages/content"
import { ApiHandler } from "../../../api"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { OrchestrationController } from "../../OrchestrationController"
import { KanbanSystem } from "../KanbanSystem"

// Mock dependencies
class MockApiHandler implements Partial<ApiHandler> {
	private response: any
	public willThrow = false

	constructor(response: any) {
		this.response = response
	}

	async *createMessage(_prompt: string, _msgs: CodemarieStorageMessage[]): AsyncGenerator<ApiStreamChunk> {
		if (this.willThrow) {
			throw new Error("API completely offline")
		}
		yield { type: "text", text: JSON.stringify(this.response) } as ApiStreamChunk
	}
}

class MockOrchestrationController {
	private memory = new Map<string, string>()

	constructor() {
		this.memory.set("product_purpose", "Build a cache")
		this.memory.set("system_architecture_zoning", JSON.stringify({ primary_directories: ["src"] }))
	}

	getStreamId() {
		return "test-kanban"
	}

	async getAgentContext() {
		return {
			addKnowledge: async () => true,
			appendMemoryLayer: async () => true,
			detectContradictions: async () => [],
			flush: async () => true,
		}
	}

	async beginTask() {}
	async updateTaskProgress() {}

	async storeMemory(key: string, value: string) {
		this.memory.set(key, value)
	}

	async recallMemory(key: string) {
		return this.memory.get(key) || null
	}
}

describe("KanbanSystem", () => {
	let kanban: KanbanSystem
	let mockController: MockOrchestrationController

	beforeEach(() => {
		kanban = new KanbanSystem()
		mockController = new MockOrchestrationController()
	})

	it("should generate tasks successfully based on purpose and zoning", async () => {
		const apiHandler = new MockApiHandler({
			tasks: ["Setup Cache Class", "Write Cache Tests"],
		}) as unknown as ApiHandler

		const tasks = await kanban.planFlow(
			mockController as unknown as OrchestrationController,
			apiHandler as unknown as ApiHandler,
			"Build a cache",
			["Cache"],
			"Layered",
		)

		should(tasks).be.Array()
		should(tasks.length).equal(2)
		should(tasks[0]).equal("Setup Cache Class")

		const stored = await mockController.recallMemory("task_flow")
		should(stored).not.be.null()
		const parsed = JSON.parse(stored!)
		should(parsed.length).equal(2)
	})

	it("should handle extraction failure by emitting a fallback task", async () => {
		const handler = new MockApiHandler({})
		handler.willThrow = true

		const tasks = await kanban.planFlow(
			mockController as unknown as OrchestrationController,
			handler as unknown as ApiHandler,
			"Build a cache",
			["Cache"],
		)

		should(tasks.length).equal(1)
		should(tasks[0]).containEql("Analyze codebase and determine next steps")
	})
})
