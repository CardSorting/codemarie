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
		const runner = new SubagentRunner(baseConfig)
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
		const runner = new SubagentRunner(baseConfig)

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
		// Properly stub the orchestrator which is imported at the top of SubagentRunner or other files
		// Note: SubagentRunner imports orchestrator from "@/infrastructure/ai/Orchestrator"
		const orchestrator = await import("@/infrastructure/ai/Orchestrator")
		sinon.stub(orchestrator, "orchestrator").value({
			storeMemory: sinon.stub().resolves(),
		})

		stubApiHandler(createMessage)
		initializeHostProvider()

		const runner = new SubagentRunner(baseConfig)
		// Mock the session ID getter
		;(runner as any).baseConfig.getSessionStreamId = () => "parent-stream-123"

		await runner.run("Audit security", () => {})

		// Verify signalling occurred
		assert.ok((orchestrator.orchestrator as any).storeMemory.calledOnce)
		const [streamId, key, value] = (orchestrator.orchestrator as any).storeMemory.firstCall.args
		assert.equal(streamId, "parent-stream-123")
		assert.ok(key.startsWith("swarm_finding_"))
		assert.ok(value.includes("JoyZoning Violation"))
	})
})
