import * as assert from "assert"
import * as sinon from "sinon"

// Use proxyquire to avoid loading the entire core dependency chain which causes MODULE_NOT_FOUND in unit tests
const proxyquire = require("proxyquire").noCallThru()

describe("SuggestionService", () => {
	let SuggestionService: any
	let service: any
	let getActiveEditorStub: sinon.SinonStub
	let buildApiHandlerStub: sinon.SinonStub
	let readFileStub: sinon.SinonStub
	let captureSuggestionGeneratedStub: sinon.SinonStub
	let mockStateManager: any
	let mockHostProvider: any
	let mockTelemetryService: any
	let mockFs: any
	let mockPathUtils: any
	let mockAgentContext: any
	let mockWorkspace: any
	let mockDbPool: any
	let mockLanguageParser: any
	let mockTreeSitterIndex: any

	beforeEach(() => {
		const mockHandler = {
			createMessage: sinon.stub().returns(
				(async function* () {
					yield { type: "text", text: "Suggestion 1\nSuggestion 2\nSuggestion 3" }
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
		getActiveEditorStub = mockHostProvider.window.getActiveEditor

		mockStateManager = {
			get: sinon.stub(),
			instance: {
				getApiConfiguration: sinon.stub().returns({}),
				getGlobalSettingsKey: sinon.stub().withArgs("mode").returns("plan"),
			},
		}
		mockStateManager.get.returns(mockStateManager.instance)

		mockTelemetryService = {
			telemetryService: {
				captureSuggestionGenerated: sinon.stub(),
			},
		}
		captureSuggestionGeneratedStub = mockTelemetryService.telemetryService.captureSuggestionGenerated

		readFileStub = sinon.stub()
		mockFs = {
			readFile: readFileStub,
			"@noCallThru": true,
		}

		mockPathUtils = {
			asRelativePath: sinon.stub().callsFake((p: string) => Promise.resolve(p)),
		}

		mockAgentContext = sinon.stub().returns({
			getStructuralImpact: sinon
				.stub()
				.returns({
					summary: "Architectural Importance: High",
					blastRadius: { dependents: [], dependencies: [], level: 1 },
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
		assert.strictEqual(suggestions[0], "Suggestion 1")
		assert.strictEqual(suggestions[1], "Suggestion 2")
		assert.strictEqual(suggestions[2], "Suggestion 3")
		assert.ok(captureSuggestionGeneratedStub.calledOnce)
	})

	it("should fallback to basic suggestions on AI failure", async () => {
		getActiveEditorStub.resolves({ filePath: "/path/to/file.ts" })
		buildApiHandlerStub.throws(new Error("AI error"))

		const suggestions = await service.getSuggestions()
		assert.ok(suggestions.some((s: string) => s.includes("Refactor") || s.includes("test") || s.includes("Fix")))
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
		;(service as any).isGenerating = false
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
		const agentContextInstance = (service as any).agentContext
		assert.ok(agentContextInstance)
		assert.ok(agentContextInstance.getStructuralImpact.called)
		assert.ok(agentContextInstance.searchKnowledge.called)
	})
})
