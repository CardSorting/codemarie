import { expect } from "chai"
import { Stats } from "fs"
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

		mockApiHandler.createMessage.callsFake(
			() =>
				(async function* () {
					yield { type: "text", text: JSON.stringify(mockResponse) }
				})() as ApiStream,
		)

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

		mockApiHandler.createMessage.callsFake(
			() =>
				(async function* () {
					yield { type: "text", text: JSON.stringify(mockResponse) }
				})() as ApiStream,
		)

		// Mock fs.stat
		const statStub = sandbox.stub(fs, "stat")
		statStub
			.withArgs(sinon.match("existing.ts"))
			.resolves({ isDirectory: () => false, isFile: () => true } as unknown as Stats)
		statStub.withArgs(sinon.match("missing.ts")).rejects(new Error("ENOENT"))

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)
		const spec = await grounder.ground("task", "context", "/tmp/cwd")

		expect(spec.verifiedEntities).to.be.an("array")
		expect(spec.verifiedEntities).to.contain("existing.ts (File)")
		expect(spec.verifiedEntities).to.not.contain("missing.ts")
		expect(spec.confidenceScore).to.be.lessThan(0.9) // penalized
		expect(spec.ambiguityReasoning).to.contain("Referenced entities not verified")
	})

	it("should return a cached result on subsequent calls with the same intent", async () => {
		const mockResponse = {
			decisionVariables: [],
			constraints: ["Cached constraint"],
			outputStructure: {},
			rules: [],
			confidenceScore: 1.0,
		}

		mockApiHandler.createMessage.callsFake(
			() =>
				(async function* () {
					yield { type: "text", text: JSON.stringify(mockResponse) }
				})() as ApiStream,
		)

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)

		// First call (cache miss)
		const spec1 = await grounder.ground("cache test task")
		expect(spec1.telemetry?.isCacheHit).to.be.false
		// Note: ground() might call createMessage multiple times (keywords, then main grounding)
		// But it should be consistent across calls
		const initialCallCount = mockApiHandler.createMessage.callCount

		// Second call (cache hit)
		const spec2 = await grounder.ground("cache test task")
		expect(spec2.telemetry?.isCacheHit).to.be.true
		expect(spec2.constraints).to.deep.equal(["Cached constraint"])
		expect(mockApiHandler.createMessage.callCount).to.equal(initialCallCount)
	})

	it("should robustly extract JSON from conversational noise and markdown blocks", async () => {
		const mockResponse = {
			decisionVariables: [],
			constraints: ["Noise test"],
			outputStructure: {},
			rules: [],
			confidenceScore: 1.0,
		}

		const noisyText =
			"Of course, I can help with that. Here is the structured specification you requested:\n\n" +
			"```json\n" +
			JSON.stringify(mockResponse) +
			"\n```\n\n" +
			"I hope this helps! Let me know if you have any questions."

		mockApiHandler.createMessage.callsFake(
			() =>
				(async function* () {
					yield { type: "text", text: noisyText }
				})() as ApiStream,
		)

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)
		const spec = await grounder.ground("noisy task")

		expect(spec.constraints).to.deep.equal(["Noise test"])
		expect(spec.confidenceScore).to.equal(1.0)
	})

	it("should salvage spec when schema validation fails due to missing fields", async () => {
		// missing decisionVariables, constraints, etc.
		const malformedResponse = {
			confidenceScore: 0.8,
			ambiguityReasoning: "Partial output",
		}

		mockApiHandler.createMessage.callsFake(
			() =>
				(async function* () {
					yield { type: "text", text: JSON.stringify(malformedResponse) }
				})() as ApiStream,
		)

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)
		const spec = await grounder.ground("malformed task")

		// Should have defaulted fields from Zod or salvage logic
		expect(spec.decisionVariables).to.be.an("array")
		expect(spec.rules).to.be.an("array")
		expect(spec.confidenceScore).to.equal(0.8)
		expect(spec.ambiguityReasoning).to.equal("Partial output")
	})

	it("should return a fallback spec when grounding fails critically", async () => {
		mockApiHandler.createMessage.callsFake(() => {
			throw new Error("API Down")
		})

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)
		const spec = await grounder.ground("failed task")

		expect(spec.confidenceScore).to.equal(0.1)
		expect(spec.ambiguityReasoning).to.contain("Grounding failed: API Down")
		expect(spec.missingInformation).to.contain("The system failed to structure your intent. Please try rephrasing.")
	})

	it("should perform architectural layer discovery (Joy-Zoning)", async () => {
		const mockResponse = {
			decisionVariables: [{ name: "service", description: "target", range: ["src/domain/service.ts"] }],
			constraints: [],
			outputStructure: {},
			rules: [],
			confidenceScore: 1.0,
		}

		mockApiHandler.createMessage.callsFake(
			() =>
				(async function* () {
					yield { type: "text", text: JSON.stringify(mockResponse) }
				})() as ApiStream,
		)

		// Mock fs.stat to allow entity verification
		const statStub = sandbox.stub(fs, "stat")
		statStub
			.withArgs(sinon.match("src/domain/service.ts"))
			.resolves({ isDirectory: () => false, isFile: () => true } as unknown as Stats)

		const grounder = new IntentGrounder(mockApiHandler as unknown as ApiHandler)
		const spec = await grounder.ground("domain task", "", "/abs/path")

		expect(spec.architecturalLayers).to.exist
		expect(spec.architecturalLayers?.["src/domain/service.ts (File)"]).to.equal("domain")
		expect(spec.policyCompliance?.isAligned).to.be.true
	})
})
