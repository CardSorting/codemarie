import * as assert from "assert"
import * as sinon from "sinon"

// Use proxyquire to avoid loading the entire core dependency chain which causes MODULE_NOT_FOUND in unit tests
const proxyquire = require("proxyquire").noCallThru()

describe("SuggestionService", () => {
	// Define minimal interfaces for mocks to satisfy the linter without absolute type inheritance
	interface MockObject {
		[key: string]: sinon.SinonStub | MockObject | string | number | boolean | string[] | undefined | null | object
	}

	// biome-ignore lint/suspicious/noExplicitAny: proxyquire returns a constructor that is difficult to type precisely without importing the target class
	let SuggestionService: any
	// biome-ignore lint/suspicious/noExplicitAny: The instance of the dynamically loaded service
	let service: any

	let getActiveEditorStub: sinon.SinonStub
	let buildApiHandlerStub: sinon.SinonStub
	let readFileStub: sinon.SinonStub
	let captureSuggestionGeneratedStub: sinon.SinonStub

	let mockStateManager: MockObject
	let mockHostProvider: MockObject
	let mockTelemetryService: MockObject
	let mockFs: MockObject
	let mockPathUtils: MockObject
	let mockAgentContext: sinon.SinonStub
	let mockWorkspace: sinon.SinonStub
	let mockDbPool: sinon.SinonStub
	let mockLanguageParser: MockObject
	let mockTreeSitterIndex: MockObject

	beforeEach(() => {
		const mockHandler = {
			createMessage: sinon.stub().returns(
				(async function* () {
					yield {
						type: "text",
						text: JSON.stringify([
							{ text: "Suggestion 1", type: "fix" },
							{ text: "Suggestion 2", type: "design" },
							{ text: "Suggestion 3", type: "learn" },
						]),
					}
				})(),
			),
		}

		buildApiHandlerStub = sinon.stub().returns(mockHandler)

		mockLanguageParser = {
			loadRequiredLanguageParsers: sinon.stub().resolves({ ts: { parser: {}, query: {} } }),
		}
		mockTreeSitterIndex = {
			parseFile: sinon.stub().resolves("|----\n│class Test {}\n|----\n"),
		}

		mockHostProvider = {
			get: sinon.stub().returns({
				getWorkspacePaths: sinon.stub().resolves({ paths: ["/mock/workspace"] }),
			}),
			window: {
				getActiveEditor: sinon.stub(),
			},
			workspace: {
				getDiagnostics: sinon.stub().resolves({ fileDiagnostics: [] }),
				getWorkspacePaths: sinon.stub().resolves({ paths: ["/mock/workspace"] }),
			},
		}
		getActiveEditorStub = (mockHostProvider.window as MockObject).getActiveEditor as sinon.SinonStub

		mockStateManager = {
			get: sinon.stub(),
			instance: {
				getApiConfiguration: sinon.stub().returns({}),
				getGlobalSettingsKey: sinon.stub().withArgs("mode").returns("plan"),
			},
		}
		const getStub = mockStateManager.get as sinon.SinonStub
		getStub.returns(mockStateManager.instance)

		mockTelemetryService = {
			telemetryService: {
				captureSuggestionGenerated: sinon.stub(),
			},
		}
		captureSuggestionGeneratedStub = (mockTelemetryService.telemetryService as MockObject)
			.captureSuggestionGenerated as sinon.SinonStub

		readFileStub = sinon.stub()
		mockFs = {
			readFile: readFileStub,
			"@noCallThru": true,
		}

		mockPathUtils = {
			asRelativePath: sinon.stub().callsFake((p: string) => Promise.resolve(p)),
		}

		mockAgentContext = sinon.stub().returns({
			getStructuralImpact: sinon.stub().returns({
				summary: "Architectural Importance: High",
				importance: "HIGH",
				blastRadius: { affectedNodes: ["node1", "node2"], centralityScore: 0.2, criticalDependents: [] },
			}),
			searchKnowledge: sinon.stub().resolves([{ content: "semantic snippet 1" }]),
		})

		mockWorkspace = sinon.stub().returns({
			init: sinon.stub().resolves(),
		})

		mockDbPool = sinon.stub().returns({})

		SuggestionService = proxyquire("../SuggestionService", {
			"@/core/api": { buildApiHandler: buildApiHandlerStub },
			"@/hosts/host-provider": { HostProvider: mockHostProvider },
			"@/core/storage/StateManager": { StateManager: mockStateManager },
			"@/core/broccolidb/agent-context.js": { AgentContext: mockAgentContext },
			"@/core/broccolidb/workspace.js": { Workspace: mockWorkspace },
			"@/infrastructure/db/BufferedDbPool.js": { BufferedDbPool: mockDbPool },
			"@/services/tree-sitter/languageParser.js": mockLanguageParser,
			"@/services/tree-sitter/index.js": mockTreeSitterIndex,
			"@/services/telemetry": mockTelemetryService,
			"@/utils/path": mockPathUtils,
			"@/utils/string": { calculateSimilarity: sinon.stub().returns(0) },
			"fs/promises": mockFs,
		}).SuggestionService

		service = new SuggestionService()
	})

	afterEach(() => {
		sinon.restore()
	})

	it("should provide AI-driven suggestions when everything works", async () => {
		getActiveEditorStub.resolves({ filePath: "/path/to/file.ts" })
		readFileStub.resolves("some file content")

		const suggestions = await service.getSuggestions([], "test-ulid")
		assert.strictEqual(suggestions.length, 3)
		assert.strictEqual(suggestions[0].text, "Suggestion 1")
		assert.strictEqual(suggestions[0].type, "fix")
		assert.strictEqual(suggestions[1].text, "Suggestion 2")
		assert.strictEqual(suggestions[1].type, "design")
		assert.strictEqual(suggestions[2].text, "Suggestion 3")
		assert.strictEqual(suggestions[2].type, "learn")
		assert.ok(captureSuggestionGeneratedStub.calledOnce)
	})

	it("should fallback to basic suggestions on AI failure", async () => {
		getActiveEditorStub.resolves({ filePath: "/path/to/file.ts" })
		buildApiHandlerStub.throws(new Error("AI error"))

		const suggestions = await service.getSuggestions()
		assert.ok(
			suggestions.some(
				(s: { text: string }) => s.text.includes("Refactor") || s.text.includes("test") || s.text.includes("Explain"),
			),
		)
		assert.strictEqual(suggestions.length, 3)
	})

	it("should handle debouncing", async () => {
		getActiveEditorStub.resolves({ filePath: "/path/to/file.ts" })
		readFileStub.resolves("some file content")

		// First call
		await service.getSuggestions([])
		assert.strictEqual(buildApiHandlerStub.callCount, 1)

		// Second call immediately after (debounced)
		await service.getSuggestions([])
		assert.strictEqual(buildApiHandlerStub.callCount, 1)
	})

	it("should use cache correctly", async () => {
		getActiveEditorStub.resolves({ filePath: "/path/to/file.ts" })
		readFileStub.resolves("some file content")

		// First call (calls AI)
		await service.getSuggestions([])
		assert.strictEqual(buildApiHandlerStub.callCount, 1)

		// Reset internal state to allow another call bypass
		// biome-ignore lint/suspicious/noExplicitAny: Resetting internal private state for testing
		;(service as any).isGenerating = false
		// biome-ignore lint/suspicious/noExplicitAny: Resetting internal private state for testing
		;(service as any).lastFetchTime = 0

		// Second call with same content (should hit cache)
		await service.getSuggestions([])
		assert.strictEqual(buildApiHandlerStub.callCount, 1)
	})

	it("should gather deep context from BroccoliDB", async () => {
		getActiveEditorStub.resolves({ filePath: "/path/to/file.ts" })
		readFileStub.resolves("some file content")

		await service.getSuggestions([])

		// Verify AgentContext was used
		// biome-ignore lint/suspicious/noExplicitAny: Accessing private agentContext for verification
		const agentContextInstance = (service as any).agentContext
		assert.ok(agentContextInstance)
		assert.ok(agentContextInstance.getStructuralImpact.called)
		assert.ok(agentContextInstance.searchKnowledge.called)
	})
})
