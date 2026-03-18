import should from "should"
import { CodemarieStorageMessage } from "../../../../shared/messages/content"
import { ApiHandler } from "../../../api"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { OrchestrationController } from "../../OrchestrationController"
import { IkigaiSystem } from "../IkigaiSystem"

// Mock dependencies
class MockApiHandler implements Partial<ApiHandler> {
	private response: any
	public willThrow = false

	constructor(response: any) {
		this.response = response
	}

	async *createMessage(_systemPrompt: string, _messages: CodemarieStorageMessage[]): AsyncGenerator<ApiStreamChunk> {
		if (this.willThrow) {
			throw new Error("API completely offline")
		}
		yield { type: "text", text: JSON.stringify(this.response) } as ApiStreamChunk
	}
}

class MockOrchestrationController {
	private memory = new Map<string, string>()
	private progress: any[] = []

	getStreamId() {
		return "test-stream-123"
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

describe("IkigaiSystem", () => {
	let ikigai: IkigaiSystem
	let mockController: MockOrchestrationController

	beforeEach(() => {
		ikigai = new IkigaiSystem()
		mockController = new MockOrchestrationController()
	})

	it("should define purpose and scope successfully", async () => {
		const apiHandler = new MockApiHandler({
			purpose: "To build a fast caching layer",
			scope: [{ name: "Cache Component", success_criteria: ["O(1) lookups"] }],
		}) as unknown as ApiHandler

		const result = await ikigai.defineScope(
			mockController as unknown as OrchestrationController,
			apiHandler,
			"Build me a fast caching layer",
		)

		should(result.purpose).equal("To build a fast caching layer")
		should(result.scope.length).equal(1)
		should(result.clarificationNeeded).be.undefined()

		const storedPurpose = await mockController.recallMemory("product_purpose")
		should(storedPurpose).equal("To build a fast caching layer")
	})

	it("should return clarification if intent is ambiguous", async () => {
		const apiHandler = new MockApiHandler({
			clarification_needed: "What kind of caching do you want? Redis or in-memory?",
		}) as unknown as ApiHandler

		const result = await ikigai.defineScope(mockController as unknown as OrchestrationController, apiHandler, "Build a cache")

		should(result.clarificationNeeded).not.be.undefined()
		should(result.purpose).equal("Fulfill the user request: Build a cache") // Fallback purpose is used alongside clarification
	})

	it("should fallback to minimal scope on API error", async () => {
		const errorApiHandler = new MockApiHandler({})
		errorApiHandler.willThrow = true

		const result = await ikigai.defineScope(
			mockController as unknown as OrchestrationController,
			errorApiHandler as unknown as ApiHandler,
			"Do something",
		)

		should(result.purpose).containEql("Do something")
		should(result.scope).deepEqual(["Implement core functionality"])
	})
})
