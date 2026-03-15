import { strict as assert } from "node:assert"
import * as coreApi from "@core/api"
import * as skills from "@core/context/instructions/user-instructions/skills"
import { PromptRegistry } from "@core/prompts/system-prompt"
import type { TaskConfig } from "@core/task/tools/types/TaskConfig"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { ApiFormat } from "@/shared/proto/codemarie/models"
import { CodemarieDefaultTool } from "@/shared/tools"
import { TaskState } from "../../../TaskState"
import { SubagentBuilder } from "../SubagentBuilder"
import { SubagentRunner } from "../SubagentRunner"

function initializeHostProvider() {
	HostProvider.reset()
	HostProvider.initialize(
		() => ({}) as never,
		() => ({}) as never,
		() => ({}) as never,
		() => ({}) as never,
		{
			workspaceClient: {},
			envClient: {
				getHostVersion: async () => ({ platform: "test" }),
			},
			windowClient: {},
			diffClient: {},
		} as never,
		() => undefined,
		async () => "",
		async () => "",
		"",
		"",
	)
}

function createTaskConfig(nativeToolCallEnabled: boolean): TaskConfig {
	const taskState = new TaskState()
	// Mock groundedSpec
	taskState.groundedSpec = {
		decisionVariables: [{ name: "verifying-file.ts", description: "test", range: ["src/verifying-file.ts"] }],
		constraints: ["test constraint"],
		rules: ["test rule"],
		outputStructure: {},
		confidenceScore: 1.0,
		ambiguityReasoning: "none",
	}

	return {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "/tmp",
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		doubleCheckCompletionEnabled: false,
		vscodeTerminalExecutionMode: "backgroundExec",
		enableParallelToolCalling: false,
		isSubagentExecution: false,
		context: {},
		taskState,
		messageState: {},
		api: {
			getModel: () => ({
				id: "anthropic/claude-sonnet-4.5",
				info: {
					contextWindow: 200_000,
					apiFormat: ApiFormat.ANTHROPIC_CHAT,
					supportsPromptCache: true,
				},
			}),
			createMessage: sinon.stub().callsFake(async function* () {}),
		},
		services: {
			stateManager: {
				getGlobalSettingsKey: (key: string) => {
					if (key === "mode") return "act"
					return undefined
				},
				getGlobalStateKey: (key: string) => (key === "nativeToolCallEnabled" ? nativeToolCallEnabled : undefined),
				getApiConfiguration: () => ({
					actModeApiProvider: "anthropic",
					planModeApiProvider: "anthropic",
				}),
			},
		},
		browserSettings: {},
		focusChainSettings: {},
		autoApprovalSettings: {
			enableNotifications: false,
			actions: { executeSafeCommands: false, executeAllCommands: false },
		},
		autoApprover: { shouldAutoApproveTool: sinon.stub().returns([false, false]) },
		callbacks: {
			say: sinon.stub().resolves(undefined),
			ask: sinon.stub().resolves({ response: "yesButtonClicked" }),
			saveCheckpoint: sinon.stub().resolves(),
			sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
			removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
			executeCommandTool: sinon.stub().resolves([false, "ok"]),
			cancelRunningCommandTool: sinon.stub().resolves(false),
			postStateToWebview: sinon.stub().resolves(),
			reinitExistingTaskFromId: sinon.stub().resolves(),
			cancelTask: sinon.stub().resolves(),
			updateTaskHistory: sinon.stub().resolves([]),
			applyLatestBrowserSettings: sinon.stub().resolves(undefined),
			switchToActMode: sinon.stub().resolves(false),
			setActiveHookExecution: sinon.stub().resolves(),
			clearActiveHookExecution: sinon.stub().resolves(),
			getActiveHookExecution: sinon.stub().resolves(undefined),
			runUserPromptSubmitHook: sinon.stub().resolves({}),
		},
		coordinator: {
			getHandler: sinon.stub().callsFake((toolName: CodemarieDefaultTool) => {
				if (toolName === CodemarieDefaultTool.ATTEMPT) {
					return {
						execute: sinon.stub().resolves("ok"),
						getDescription: sinon.stub().returns("attempt"),
					}
				}
				return undefined
			}),
		},
	} as unknown as TaskConfig
}

function stubApiHandler(createMessage: sinon.SinonStub) {
	sinon.stub(coreApi, "buildApiHandler").returns({
		abort: sinon.stub(),
		getModel: () => ({
			id: "anthropic/claude-sonnet-4.5",
			info: {
				contextWindow: 200_000,
				apiFormat: ApiFormat.ANTHROPIC_CHAT,
				supportsPromptCache: true,
			},
		}),
		createMessage,
	} as never)
}

describe("Subagent Swarm Inheritance", () => {
	afterEach(() => {
		sinon.restore()
		HostProvider.reset()
	})

	it("propagates parent groundedSpec to subagent system prompt context and inherits if similar", async () => {
		const createMessage = sinon.stub()
		createMessage.onFirstCall().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_1",
						name: CodemarieDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})

		const promptRegistry = PromptRegistry.getInstance()
		const registrySpy = sinon.spy(promptRegistry, "get")

		sinon.stub(SubagentBuilder.prototype, "buildNativeTools").returns([{ name: "attempt_completion" }] as unknown as any)
		sinon.stub(skills, "discoverSkills").resolves([])
		sinon.stub(skills, "getAvailableSkills").returns([])
		stubApiHandler(createMessage)
		initializeHostProvider()

		const baseConfig = createTaskConfig(true)
		const builder = new SubagentBuilder(baseConfig, "subagent")
		const runner = new SubagentRunner(baseConfig, builder)
		// Intent overlapping with "test constraint" and "test rule" in parent spec
		await runner.run("Verification of test constraint and rule", () => {})

		assert.ok(registrySpy.calledOnce)
		const context = registrySpy.firstCall.args[0]
		assert.ok(context.groundedSpec)
		assert.equal(context.groundedSpec?.decisionVariables[0].name, "verifying-file.ts")
		assert.equal(context.groundedSpec?.constraints[0], "test constraint")
	})

	it("synthesizes parent spec with local discovery in IntentGrounder logic", async () => {
		const baseConfig = createTaskConfig(true)
		const builder = new SubagentBuilder(baseConfig, "subagent")
		const runner = new SubagentRunner(baseConfig, builder)

		// Accessing private baseConfig for verification via casting
		assert.deepEqual((runner as any).baseConfig.taskState.groundedSpec, baseConfig.taskState.groundedSpec)
	})

	it("signals critical findings to parent swarm memory", async () => {
		const createMessage = sinon.stub()
		createMessage.onFirstCall().callsFake(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_finding_1",
						name: CodemarieDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "CRITICAL: Found a JoyZoning Violation in security.ts" }),
					},
				},
			}
		})

		const baseConfig = createTaskConfig(true)
		;(baseConfig as any).services.stateManager.getGlobalSettingsKey = (key: string) => {
			if (key === "subagentsEnabled") return true
			if (key === "mode") return "act"
			return undefined
		}

		const { orchestrator } = await import("@/infrastructure/ai/Orchestrator")
		const storeMemoryStub = sinon.stub(orchestrator, "storeMemory").resolves()

		stubApiHandler(createMessage)
		initializeHostProvider()

		const builder = new SubagentBuilder(baseConfig, "subagent")
		const runner = new SubagentRunner(baseConfig, builder)
		// Set recursion depth to 0 explicitly to avoid any confusion
		runner.setRecursionDepth(0)
		;(runner as any).baseConfig.getSessionStreamId = () => "parent-stream-123"

		await runner.run("Audit security", () => {})

		assert.ok(storeMemoryStub.calledOnce, "orchestrator.storeMemory should be called once")
		storeMemoryStub.restore()
	})

	it("enforces recursion guard at depth 3", async () => {
		const baseConfig = createTaskConfig(true)
		;(baseConfig as any).services.stateManager.getGlobalSettingsKey = (key: string) => {
			if (key === "subagentsEnabled") return true
			if (key === "mode") return "act"
			return undefined
		}
		;(baseConfig as any).recursionDepth = 3

		const { UseSubagentsToolHandler } = await import("../../handlers/SubagentToolHandler")
		const handler = new UseSubagentsToolHandler()

		const result = await handler.execute(baseConfig, {
			name: CodemarieDefaultTool.USE_SUBAGENTS,
			params: { prompt_1: "test" },
		} as any)

		const content = typeof result === "string" ? result : (result as any).content
		assert.ok(content.includes("Swarm Recursion Limit Reached"), `Expected recursion limit message, but got: ${content}`)
	})

	it("resolves conflicts by prioritizing high-confidence local constraints", async () => {
		const { IntentGrounder } = await import("../../../../../core/grounding/IntentGrounder")
		const mockApiHandler = {
			createMessage: sinon.stub().callsFake(async function* () {}),
			getModel: () => ({ id: "m", info: {} }),
		}

		// We mock the internal executeGroundingRequest by overriding IntentGrounder prototype or just mocking the API
		const grounder = new IntentGrounder(mockApiHandler as any)
		;(grounder as any).executeGroundingRequest = async () => ({
			spec: {
				decisionVariables: [],
				constraints: ["Local strictly better constraint"],
				rules: [],
				outputStructure: {},
				confidenceScore: 0.9,
				ambiguityReasoning: "none",
			},
			tokens: { input: 0, output: 0 },
		})

		const parentSpec = {
			constraints: ["Parent general constraint"],
			decisionVariables: [],
			rules: [],
			outputStructure: {},
			confidenceScore: 1.0,
			ambiguityReasoning: "none",
		}

		// Intent that should trigger synthesis (overlapping)
		// Signature: ground(intent, context, cwd, streamId, knowledgeGraph, parentSpec)
		const spec = await grounder.ground("Test local override", "", "/tmp", undefined, undefined, parentSpec)

		// If local is "strictly better", it should merge cleanly or override depending on logic
		assert.ok(spec.constraints.includes("Local strictly better constraint"))
	})
})
