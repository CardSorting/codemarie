import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { ApiHandler } from "../../api"
import { ApiStream } from "../../api/transform/stream"
import { IntentGrounder } from "../IntentGrounder"

describe("IntentGrounder", () => {
	let sandbox: sinon.SinonSandbox
	let mockApiHandler: {
		createMessage: sinon.SinonStub
		getModel: sinon.SinonStub
	}

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		mockApiHandler = {
			createMessage: sandbox.stub(),
			getModel: sandbox.stub().returns({ id: "test-model", info: {} }),
		}
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should ground a simple intent into a spec", async () => {
		const mockResponse = {
			decisionVariables: [{ name: "color", description: "The primary color", range: ["red", "blue"] }],
			constraints: ["Must be vibrant"],
			outputStructure: { theme: "vibrant" },
			rules: ["Prioritize blue"],
		}

		const mockStream = (async function* () {
			yield { type: "text", text: JSON.stringify(mockResponse) }
		})() as ApiStream

		mockApiHandler.createMessage.returns(mockStream)

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)
		const spec = await grounder.ground("Design a vibrant UI")

		expect(spec).to.deep.equal(mockResponse)
		expect(mockApiHandler.createMessage.calledOnce).to.be.true
	})

	it("should extract JSON even if wrapped in markdown", async () => {
		const mockResponse = {
			decisionVariables: [],
			constraints: [],
			outputStructure: {},
			rules: [],
		}

		const mockStream = (async function* () {
			yield { type: "text", text: "Here is the grounding:\n```json\n" + JSON.stringify(mockResponse) + "\n```" }
		})() as ApiStream

		mockApiHandler.createMessage.returns(mockStream)

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)
		const spec = await grounder.ground("test")

		expect(spec).to.deep.equal(mockResponse)
	})

	it("should throw error if no JSON found", async () => {
		const mockStream = (async function* () {
			yield { type: "text", text: "No JSON here" }
		})() as ApiStream

		mockApiHandler.createMessage.returns(mockStream)

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)
		try {
			await grounder.ground("test")
			expect.fail("Should have thrown error")
		} catch (error: any) {
			expect(error.message).to.equal("No JSON found in grounding response")
		}
	})
})
