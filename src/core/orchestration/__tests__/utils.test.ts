import should from "should"
import { CodemarieStorageMessage } from "../../../shared/messages/content"
import { ApiHandler } from "../../api"
import { ApiStreamChunk } from "../../api/transform/stream"
import { executeMASRequest } from "../utils"

// Mock ApiHandler
class MockApiHandler implements Partial<ApiHandler> {
	private responses: string[] = []
	private callCount = 0

	constructor(responses: string[]) {
		this.responses = responses
	}

	async *createMessage(_systemPrompt: string, _messages: CodemarieStorageMessage[]): AsyncGenerator<ApiStreamChunk> {
		const currentResponse = this.responses[this.callCount] || this.responses[this.responses.length - 1]
		this.callCount++

		yield { type: "text", text: currentResponse } as ApiStreamChunk
	}

	getCallCount() {
		return this.callCount
	}
}

describe("executeMASRequest", () => {
	it("should parse standard JSON correctly", async () => {
		const handler = new MockApiHandler(['{"success": true, "message": "hello"}']) as unknown as ApiHandler
		const result = await executeMASRequest(handler, "system", "user")
		should(result).deepEqual({ success: true, message: "hello" })
	})

	it("should parse markdown enclosed JSON correctly", async () => {
		const rawResponse = 'Here is your output:\n```json\n{"data": 123}\n```'
		const handler = new MockApiHandler([rawResponse]) as unknown as ApiHandler
		const result = await executeMASRequest(handler, "system", "user")
		should(result).deepEqual({ data: 123 })
	})

	it("should auto-retry with a System Nudge upon malformed JSON", async () => {
		const handler = new MockApiHandler([
			"Malformed { JSON } object without quotes",
			'{"recovered": true}',
		]) as unknown as ApiHandler

		const result = await executeMASRequest(handler, "system", "user")
		const mockInstance = handler as unknown as MockApiHandler
		should(mockInstance.getCallCount()).equal(2)
		should(result).deepEqual({ recovered: true })
	})

	it("should throw an error after exhausting max retries", async () => {
		const handler = new MockApiHandler(["Unparseable garbage", "Still bad", "Nope."]) as unknown as ApiHandler

		try {
			await executeMASRequest(handler, "system", "user")
			throw new Error("Expected executeMASRequest to throw")
		} catch (error) {
			should(error).be.instanceOf(SyntaxError)
		}

		const mockInstance = handler as unknown as MockApiHandler
		// 1 initial + 2 retries = 3 total attempts
		should(mockInstance.getCallCount()).equal(3)
	})
})
