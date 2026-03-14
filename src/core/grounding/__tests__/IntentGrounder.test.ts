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
		IntentGrounder.clearCache()
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

	it("should return a cached result on subsequent calls with the same intent", async () => {
		const mockResponse = {
			decisionVariables: [],
			constraints: ["Cached constraint"],
			outputStructure: {},
			rules: [],
			confidenceScore: 1.0,
		}

		const mockStream = (async function* () {
			yield { type: "text", text: JSON.stringify(mockResponse) }
		})() as ApiStream

		mockApiHandler.createMessage.returns(mockStream)

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)

		// First call (cache miss)
		const spec1 = await grounder.ground("cache test task")
		expect(spec1.telemetry?.isCacheHit).to.be.false
		expect(mockApiHandler.createMessage.calledOnce).to.be.true

		// Second call (cache hit)
		const spec2 = await grounder.ground("cache test task")
		expect(spec2.telemetry?.isCacheHit).to.be.true
		expect(spec2.constraints).to.deep.equal(["Cached constraint"])
		expect(mockApiHandler.createMessage.calledOnce).to.be.true // No second API call
	})
})
