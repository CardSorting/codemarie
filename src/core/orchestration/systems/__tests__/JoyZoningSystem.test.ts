import should from "should"
import { CodemarieStorageMessage } from "../../../../shared/messages/content"
import { ApiHandler } from "../../../api"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { OrchestrationController } from "../../OrchestrationController"
import { JoyZoningSystem } from "../JoyZoningSystem"

class MockApiHandler implements Partial<ApiHandler> {
	private response: any
	public willThrow = false

	constructor(response: any) {
		this.response = response
	}

	async *createMessage(_systemPrompt: string, _messages: CodemarieStorageMessage[]): AsyncGenerator<ApiStreamChunk> {
		if (this.willThrow) {
			throw new Error("API offline")
		}
		yield { type: "text", text: JSON.stringify(this.response) } as ApiStreamChunk
	}
}

class MockOrchestrationController {
	private memory = new Map<string, string>()
	private progress: any[] = []

	constructor() {
		this.memory.set("product_purpose", "Build a cache")
		this.memory.set("product_scope", JSON.stringify([{ name: "Cache" }]))
	}

	getStreamId() {
		return "test-joy-stream"
	}

	async getAgentContext() {
		return {
			addKnowledge: async () => true,
			appendMemoryLayer: async () => true,
			detectContradictions: async () => [],
			flush: async () => true,
		}
	}

	async beginTask(name: string) {
		this.progress.push({ type: "begin", name })
	}

	async updateTaskProgress(status: string, message?: string) {
		this.progress.push({ type: "progress", status, message })
	}

	async storeMemory(key: string, value: string) {
		this.memory.set(key, value)
	}

	async recallMemory(key: string) {
		return this.memory.get(key) || null
	}
}

describe("JoyZoningSystem", () => {
	let joy: JoyZoningSystem
	let mockController: MockOrchestrationController

	beforeEach(() => {
		joy = new JoyZoningSystem()
		mockController = new MockOrchestrationController()
	})

	it("should analyze and apply architectural constraints successfully", async () => {
		const apiHandler = new MockApiHandler({
			architectural_plan: "Use LRU Cache",
			layer_assignments: { cache: ["src/cache"] },
			constraints: ["Concurrency safe"],
		}) as unknown as ApiHandler

		const result = await joy.reviewArchitecture(
			mockController as unknown as OrchestrationController,
			apiHandler as unknown as ApiHandler,
			"Build a cache",
			["Cache"],
		)

		should(result).equal("Use LRU Cache")
	})

	it("should fallback intelligently if API throws", async () => {
		const handler = new MockApiHandler({})
		handler.willThrow = true

		const result = await joy.reviewArchitecture(
			mockController as unknown as OrchestrationController,
			handler as unknown as ApiHandler,
			"Build a cache",
			["Cache"],
		)

		should(result).containEql("Adhere to standard layered architecture")
	})
})
