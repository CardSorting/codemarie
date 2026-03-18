import should from "should"
import { CodemarieStorageMessage } from "../../../../shared/messages/content"
import { ApiHandler } from "../../../api"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { OrchestrationController } from "../../OrchestrationController"
import { KaizenSystem } from "../KaizenSystem"

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
	private progress: any[] = []

	constructor() {
		this.memory.set("product_purpose", "Build a cache")
		this.memory.set("kanban_active_tasks", JSON.stringify([{ id: "T1", title: "Cache Setup", priority: "low" }]))
	}

	getStreamId() {
		return "test-kaizen"
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

describe("KaizenSystem", () => {
	let kaizen: KaizenSystem
	let mockController: MockOrchestrationController

	beforeEach(() => {
		kaizen = new KaizenSystem()
		mockController = new MockOrchestrationController()
	})

	it("should evaluate task completion successfully", async () => {
		const apiHandler = new MockApiHandler({
			improvements: ["Add more logging"],
		}) as unknown as ApiHandler

		const result = await kaizen.reflect(mockController as unknown as OrchestrationController, apiHandler, "Added LRU Cache")

		should(result).be.Array()
		should(result[0]).equal("Add more logging")
	})

	it("should adjust reprioritization logic when soundness is low", async () => {
		const handler = new MockApiHandler({
			improvements: ["Fix tests"],
		}) as unknown as ApiHandler

		// Mock `getLogicalSoundness` inside getAgentContext to return a low score
		mockController.getAgentContext = async () => {
			return {
				addKnowledge: async () => true,
				appendMemoryLayer: async () => true,
				detectContradictions: async () => [],
				flush: async () => true,
				getLogicalSoundness: async () => 0.5,
				updateTaskStatus: async () => true,
			} as unknown as any
		}

		// Mock getStreamTasks to simulate existing tasks
		;(mockController as any).getStreamTasks = async () => [{ id: "T1", status: "pending", result: "{}" }]

		const improvements = await kaizen.reflect(
			mockController as unknown as OrchestrationController,
			handler as unknown as ApiHandler,
			"Fail Cache Setup",
		)

		// Due to low soundness, Kaizen pushes a refinement improvement automatically
		should(improvements).containEql("Fix tests")
		should(improvements[improvements.length - 1]).containEql("Perform a secondary architectural audit")
	})

	it("should provide graceful fallback if evaluation throws", async () => {
		const handler = new MockApiHandler({})
		handler.willThrow = true

		const result = await kaizen.reflect(
			mockController as unknown as OrchestrationController,
			handler as unknown as ApiHandler,
			"Error Cache Setup",
		)

		should(result.length).equal(1)
		should(result[0]).containEql("Review latest changes manually")
	})
})
