import { expect } from "chai"
import fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { ApiHandler } from "../../api"
import { ApiStream } from "../../api/transform/stream"
import { IntentGrounder } from "../IntentGrounder"

describe("IntentGrounder (Pass 5 - Autonomous Validation)", () => {
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

	it("should generate telemetry including duration and model ID", async () => {
		const mockResponse = {
			decisionVariables: [],
			constraints: [],
			outputStructure: {},
			rules: [],
			confidenceScore: 1.0,
		}

		const mockStream = (async function* () {
			yield { type: "text", text: JSON.stringify(mockResponse) }
		})() as ApiStream

		mockApiHandler.createMessage.returns(mockStream)

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)
		const spec = await grounder.ground("test task")

		expect(spec.telemetry).to.exist
		expect(spec.telemetry?.model).to.equal("test-model")
		expect(spec.telemetry?.durationMs).to.be.a("number")
	})

	it("should verify entities and penalize confidence for missing files", async () => {
		const mockResponse = {
			decisionVariables: [{ name: "file", description: "target", range: ["existing.ts", "missing.ts"] }],
			constraints: ["Must edit existing.ts"],
			outputStructure: {},
			rules: [],
			confidenceScore: 0.9,
		}

		const mockStream = (async function* () {
			yield { type: "text", text: JSON.stringify(mockResponse) }
		})() as ApiStream

		mockApiHandler.createMessage.returns(mockStream)

		// Mock fs.access
		const accessStub = sandbox.stub(fs, "access")
		accessStub.withArgs(sinon.match("existing.ts")).resolves()
		accessStub.withArgs(sinon.match("missing.ts")).rejects(new Error("ENOENT"))

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)
		const spec = await grounder.ground("task", "context", "/tmp/cwd")

		expect(spec.verifiedEntities).to.contain("existing.ts")
		expect(spec.verifiedEntities).to.not.contain("missing.ts")
		expect(spec.confidenceScore).to.be.lessThan(0.9) // penalized
		expect(spec.ambiguityReasoning).to.contain("referenced files were not found")
	})

	it("should execute self-critique loop to refine the specification", async () => {
		const mockInitialResponse = {
			decisionVariables: [],
			constraints: ["Initial constraint"],
			outputStructure: {},
			rules: [],
			confidenceScore: 0.5,
		}

		const mockCritiqueResponse = {
			decisionVariables: [],
			constraints: ["Refined constraint"],
			outputStructure: {},
			rules: ["Added rule"],
			confidenceScore: 0.9,
		}

		const initialStream = (async function* () {
			yield { type: "text", text: JSON.stringify(mockInitialResponse) }
		})() as ApiStream

		const critiqueStream = (async function* () {
			yield { type: "text", text: JSON.stringify(mockCritiqueResponse) }
		})() as ApiStream

		mockApiHandler.createMessage.onFirstCall().returns(initialStream)
		mockApiHandler.createMessage.onSecondCall().returns(critiqueStream)

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)
		const spec = await grounder.ground("test task")

		expect(spec.constraints[0]).to.equal("Refined constraint")
		expect(spec.rules).to.have.lengthOf(1)
		expect(spec.confidenceScore).to.equal(0.9)
	})
})
