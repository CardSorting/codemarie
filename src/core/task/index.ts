import crypto from "node:crypto"
import { ApiHandler, ApiProviderInfo, buildApiHandler } from "@core/api"
import { ToolUse } from "@core/assistant-message"
import { ContextManager } from "@core/context/context-management/ContextManager"
import { EnvironmentContextTracker } from "@core/context/context-tracking/EnvironmentContextTracker"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { ModelContextTracker } from "@core/context/context-tracking/ModelContextTracker"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { CodemarieIgnoreController } from "@core/ignore/CodemarieIgnoreController"
import { CommandPermissionController } from "@core/permissions"
import { releaseTaskLock } from "@core/task/TaskLockUtils"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { buildCheckpointManager, shouldUseMultiRoot } from "@integrations/checkpoints/factory"
import { ICheckpointManager } from "@integrations/checkpoints/types"
import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { ITerminalManager } from "@integrations/terminal/types"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { McpHub } from "@services/mcp/McpHub"
import { ApiConfiguration } from "@shared/api"
import { findLastIndex } from "@shared/array"
import { CodemarieApiReqInfo, CodemarieAsk, CodemarieSay, OrchestrationEventMetadata } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import { CodemarieDefaultTool } from "@shared/tools"
import { CodemarieAskResponse } from "@shared/WebviewMessage"
import { isParallelToolCallingEnabled } from "@utils/model-utils"
import Mutex from "p-mutex"
import { ulid } from "ulid"
import { HostProvider } from "@/hosts/host-provider"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import {
	type CommandExecutionOptions,
	CommandExecutor,
	CommandExecutorCallbacks,
	FullCommandExecutorConfig,
	StandaloneTerminalManager,
} from "@/integrations/terminal"
import { telemetryService } from "@/services/telemetry"
import { CodemarieContent, CodemarieTextContentBlock, CodemarieToolResponseContent } from "@/shared/messages"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Logger } from "@/shared/services/Logger"
import { KnowledgeGraphService } from "../context/KnowledgeGraphService"
import { Controller } from "../controller"
import { executeHook } from "../hooks/hook-executor"
import { MultiAgentStreamSystem } from "../orchestration/MultiAgentStreamSystem"
import { OrchestrationController } from "../orchestration/OrchestrationController"
import { FluidPolicyEngine } from "../policy/FluidPolicyEngine"
import { StateManager } from "../storage/StateManager"
import { FocusChainManager } from "./focus-chain"
import { MessageStateHandler } from "./message-state"
import { TaskAIStreamHandler } from "./TaskAIStreamHandler"
import { TaskContextHandler } from "./TaskContextHandler"
import { TaskLifecycleManager } from "./TaskLifecycleManager"
import { TaskState } from "./TaskState"
import { TaskUIManager } from "./TaskUIManager"
import { ToolExecutor } from "./ToolExecutor"
import { extractProviderDomainFromUrl } from "./utils"

export type { ToolResponse } from "./task-types"

type TaskParams = {
	controller: Controller
	mcpHub: McpHub
	updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	postStateToWebview: () => Promise<void>
	cancelTask: () => Promise<void>
	shellIntegrationTimeout: number
	terminalReuseEnabled: boolean
	terminalOutputLineLimit: number
	defaultTerminalProfile: string
	vscodeTerminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	cwd: string
	stateManager: StateManager
	workspaceManager?: WorkspaceRootManager
	task?: string
	images?: string[]
	files?: string[]
	historyItem?: HistoryItem
	taskId: string
	taskLockAcquired: boolean
	reinitExistingTaskFromId: (taskId: string, initialState?: Partial<TaskState>) => Promise<void>
	initialTaskState?: Partial<TaskState>
}

export class Task {
	// Core task variables
	readonly taskId: string
	readonly ulid: string
	private taskIsFavorited?: boolean
	private cwd: string

	taskState: TaskState

	// ONE mutex for ALL state modifications to prevent race conditions
	private stateMutex = new Mutex()

	/**
	 * Execute function with exclusive lock on all task state
	 * Use this for ANY state modification to prevent races
	 */
	private async withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
		return await this.stateMutex.withLock(fn)
	}

	/**
	 * Atomically set active hook execution with mutex protection
	 * Prevents TOCTOU races when setting hook execution state
	 * PUBLIC: Exposed for ToolExecutor to use
	 */
	public async setActiveHookExecution(hookExecution: typeof this.taskState.activeHookExecution): Promise<void> {
		await this.withStateLock(() => {
			this.taskState.activeHookExecution = hookExecution
		})
	}

	/**
	 * Atomically clear active hook execution with mutex protection
	 * Prevents TOCTOU races when clearing hook execution state
	 * PUBLIC: Exposed for ToolExecutor to use
	 */
	public async clearActiveHookExecution(): Promise<void> {
		this.taskState.activeHookExecution = undefined
	}

	/**
	 * Atomically read active hook execution state with mutex protection
	 * Returns a snapshot of the current state to prevent TOCTOU races
	 * PUBLIC: Exposed for ToolExecutor to use
	 */
	public async getActiveHookExecution(): Promise<typeof this.taskState.activeHookExecution> {
		return await this.withStateLock(() => {
			return this.taskState.activeHookExecution
		})
	}

	// Core dependencies
	private controller: Controller
	private mcpHub: McpHub

	// Service handlers
	api: ApiHandler
	terminalManager: ITerminalManager
	private urlContentFetcher: UrlContentFetcher
	browserSession: BrowserSession
	contextManager: ContextManager
	private diffViewProvider: DiffViewProvider
	public checkpointManager?: ICheckpointManager
	private codemarieIgnoreController: CodemarieIgnoreController
	private commandPermissionController: CommandPermissionController
	private toolExecutor: ToolExecutor

	private terminalExecutionMode: "vscodeTerminal" | "backgroundExec"

	// Metadata tracking
	private fileContextTracker: FileContextTracker
	private modelContextTracker: ModelContextTracker
	private environmentContextTracker: EnvironmentContextTracker

	// Focus Chain
	private FocusChainManager?: FocusChainManager

	// Callbacks
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private postStateToWebview: () => Promise<void>
	private cancelTask: () => Promise<void>

	// Cache service
	private stateManager: StateManager

	// Message and conversation state
	messageStateHandler: MessageStateHandler

	// Workspace manager
	workspaceManager?: WorkspaceRootManager

	// Task Locking (Sqlite)
	private taskLockAcquired: boolean

	// Command executor for running shell commands (extracted from executeCommandTool)
	private commandExecutor!: CommandExecutor

	private contextHandler!: TaskContextHandler
	private uiManager!: TaskUIManager
	private lifecycleManager!: TaskLifecycleManager
	private aiStreamHandler!: TaskAIStreamHandler

	private orchestrationController?: OrchestrationController
	private multiAgentSystem?: MultiAgentStreamSystem
	private policyEngine!: FluidPolicyEngine
	private streamReadyPromise?: Promise<void>

	constructor(params: TaskParams) {
		const {
			controller,
			mcpHub,
			updateTaskHistory,
			postStateToWebview,
			cancelTask,
			shellIntegrationTimeout,
			terminalReuseEnabled,
			terminalOutputLineLimit,
			defaultTerminalProfile,
			vscodeTerminalExecutionMode,
			cwd,
			stateManager,
			workspaceManager,
			task,
			images,
			files,
			historyItem,
			taskId,
			taskLockAcquired,
		} = params

		this.taskState = new TaskState()
		if (params.initialTaskState) {
			Object.assign(this.taskState, params.initialTaskState)
		}
		this.policyEngine = new FluidPolicyEngine(cwd, undefined, stateManager)
		this.controller = controller
		this.mcpHub = mcpHub
		this.updateTaskHistory = updateTaskHistory
		this.postStateToWebview = postStateToWebview
		this.cancelTask = cancelTask
		this.codemarieIgnoreController = new CodemarieIgnoreController(cwd)
		this.commandPermissionController = new CommandPermissionController()
		this.taskLockAcquired = taskLockAcquired
		// Determine terminal execution mode and create appropriate terminal manager
		this.terminalExecutionMode = vscodeTerminalExecutionMode || "vscodeTerminal"

		// When backgroundExec mode is selected, use StandaloneTerminalManager for hidden execution
		// Otherwise, use the HostProvider's terminal manager (VSCode terminal in VSCode, standalone in CLI)
		if (this.terminalExecutionMode === "backgroundExec") {
			// Import StandaloneTerminalManager for background execution
			this.terminalManager = new StandaloneTerminalManager()
			Logger.info(`[Task ${taskId}] Using StandaloneTerminalManager for backgroundExec mode`)
		} else {
			// Use the host-provided terminal manager (VSCode terminal in VSCode environment)
			this.terminalManager = HostProvider.get().createTerminalManager()
			Logger.info(`[Task ${taskId}] Using HostProvider terminal manager for vscodeTerminal mode`)
		}
		this.terminalManager.setShellIntegrationTimeout(shellIntegrationTimeout)
		this.terminalManager.setTerminalReuseEnabled(terminalReuseEnabled ?? true)
		this.terminalManager.setTerminalOutputLineLimit(terminalOutputLineLimit)
		this.terminalManager.setDefaultTerminalProfile(defaultTerminalProfile)

		this.urlContentFetcher = new UrlContentFetcher()
		this.browserSession = new BrowserSession(stateManager)
		this.contextManager = new ContextManager()
		this.cwd = cwd
		this.stateManager = stateManager
		this.workspaceManager = workspaceManager

		// DiffViewProvider opens Diff Editor during edits while FileEditProvider performs
		// edits in the background without stealing user's editor's focus.
		const backgroundEditEnabled = this.stateManager.getGlobalSettingsKey("backgroundEditEnabled")
		this.diffViewProvider = backgroundEditEnabled ? new FileEditProvider() : HostProvider.get().createDiffViewProvider()

		// Set up MCP notification callback for real-time notifications
		this.mcpHub.setNotificationCallback(async (serverName: string, _level: string, message: string) => {
			// Display notification in chat immediately
			await this.say("mcp_notification", `[${serverName}] ${message}`)
		})

		this.taskId = taskId

		// Initialize Orchestration Stream — store promise for deferred resolution
		this.streamReadyPromise = (async () => {
			try {
				// Resolve identity for BroccoliDB scoping
				const machineId =
					((StateManager.get() as StateManager).getGlobalStateKey("codemarie.generatedMachineId") as string) ||
					"anonymous"
				const userId = machineId
				const workspaceId = crypto.createHash("sha256").update(params.cwd).digest("hex").slice(0, 12)

				// Check if a stream already exists for this taskId (fluid resumption)
				const existing = await orchestrator.getStreamByExternalId(taskId)
				if (existing) {
					this.orchestrationController = new OrchestrationController(existing.id, userId, workspaceId, taskId)
					this.policyEngine.setController(this.orchestrationController) // Integrate for native persistence
					await this.orchestrationController.beginDbShadow()
					this.policyEngine.setStreamId(existing.id)

					// Register wave approval callback
					OrchestrationController.setApprovalCallback(existing.id, async (waveId, metadata) => {
						const result = await this.ask("wave_approval" as CodemarieAsk, JSON.stringify(metadata))
						OrchestrationController.removeWaveMetadata(waveId)
						return result.response === "yesButtonClicked"
					})

					OrchestrationController.setEventCallback(existing.id, async (metadata) => {
						await this.updateSwarmState(metadata)
						await this.say("orchestration_event", JSON.stringify(metadata))
					})

					Logger.info(`[Task ${taskId}] Resumed existing orchestration stream: ${existing.id} (WS: ${workspaceId})`)
					return
				}

				// Otherwise create new stream mapped to this taskId
				const stream = await orchestrator.createStream(task || "Resumed Task", null, taskId)
				this.orchestrationController = new OrchestrationController(stream.id, userId, workspaceId, taskId)
				this.policyEngine.setController(this.orchestrationController) // Integrate for native persistence
				await this.orchestrationController.beginDbShadow()
				this.policyEngine.setStreamId(stream.id)

				// Register wave approval callback
				OrchestrationController.setApprovalCallback(stream.id, async (waveId, metadata) => {
					const result = await this.ask("wave_approval" as CodemarieAsk, JSON.stringify(metadata))
					OrchestrationController.removeWaveMetadata(waveId)
					return result.response === "yesButtonClicked"
				})

				OrchestrationController.setEventCallback(stream.id, async (metadata) => {
					await this.updateSwarmState(metadata)
					await this.say("orchestration_event", JSON.stringify(metadata))
				})

				Logger.info(`[Task ${taskId}] Registered new orchestration stream: ${stream.id} (WS: ${workspaceId})`)
			} catch (err) {
				Logger.error(`[Task ${taskId}] Failed to initialize orchestration stream:`, err)
			}
		})()

		// Initialize taskId first
		if (historyItem) {
			this.ulid = historyItem.ulid ?? ulid()
			this.taskIsFavorited = historyItem.isFavorited
			this.taskState.conversationHistoryDeletedRange = historyItem.conversationHistoryDeletedRange
			if (historyItem.checkpointManagerErrorMessage) {
				this.taskState.checkpointManagerErrorMessage = historyItem.checkpointManagerErrorMessage
			}
		} else if (task || images || files) {
			this.ulid = ulid()
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}

		this.messageStateHandler = new MessageStateHandler({
			taskId: this.taskId,
			ulid: this.ulid,
			taskState: this.taskState,
			taskIsFavorited: this.taskIsFavorited,
			updateTaskHistory: this.updateTaskHistory,
		})

		// Initialize context trackers
		this.fileContextTracker = new FileContextTracker(controller, this.taskId)
		this.modelContextTracker = new ModelContextTracker(this.taskId)
		this.environmentContextTracker = new EnvironmentContextTracker(this.taskId)

		// Initialize focus chain manager only if enabled
		const focusChainSettings = this.stateManager.getGlobalSettingsKey("focusChainSettings")
		if (focusChainSettings.enabled) {
			this.FocusChainManager = new FocusChainManager({
				taskId: this.taskId,
				taskState: this.taskState,
				mode: this.stateManager.getGlobalSettingsKey("mode"),
				stateManager: this.stateManager,
				postStateToWebview: this.postStateToWebview,
				say: this.say.bind(this),
				focusChainSettings: focusChainSettings,
			})
		}

		// Check for multiroot workspace and warn about checkpoints
		const isMultiRootWorkspace = this.workspaceManager && this.workspaceManager.getRoots().length > 1
		const checkpointsEnabled = this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting")

		if (isMultiRootWorkspace && checkpointsEnabled) {
			// Set checkpoint manager error message to display warning in TaskHeader
			this.taskState.checkpointManagerErrorMessage = "Checkpoints are not currently supported in multi-root workspaces."
		}

		// Prepare effective API configuration
		const apiConfiguration = this.stateManager.getApiConfiguration()
		const effectiveApiConfiguration: ApiConfiguration = {
			...apiConfiguration,
			ulid: this.ulid,
			onRetryAttempt: async (attempt: number, maxRetries: number, delay: number, error: Error) => {
				const codemarieMessages = this.messageStateHandler.getCodemarieMessages()
				const lastApiReqStartedIndex = findLastIndex(codemarieMessages, (m) => m.say === "api_req_started")
				if (lastApiReqStartedIndex !== -1) {
					try {
						const currentApiReqInfo: CodemarieApiReqInfo = JSON.parse(
							codemarieMessages[lastApiReqStartedIndex].text || "{}",
						)
						currentApiReqInfo.retryStatus = {
							attempt: attempt, // attempt is already 1-indexed from retry.ts
							maxAttempts: maxRetries, // total attempts
							delaySec: Math.round(delay / 1000),
							errorSnippet: error?.message ? `${String(error.message).substring(0, 50)}...` : undefined,
						}
						// Clear previous cancelReason and streamingFailedMessage if we are retrying
						delete currentApiReqInfo.cancelReason
						delete currentApiReqInfo.streamingFailedMessage
						await this.messageStateHandler.updateCodemarieMessage(lastApiReqStartedIndex, {
							text: JSON.stringify(currentApiReqInfo),
						})

						// Post the updated state to the webview so the UI reflects the retry attempt
						await this.postStateToWebview().catch((e) =>
							Logger.error("Error posting state to webview in onRetryAttempt:", e),
						)
					} catch (e) {
						Logger.error(`[Task ${this.taskId}] Error updating api_req_started with retryStatus:`, e)
					}
				}
			},
		}
		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const currentProvider = mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider

		// Now that ulid is initialized, we can build the API handler
		this.api = buildApiHandler(effectiveApiConfiguration, mode)

		// Set ulid on browserSession for telemetry tracking
		this.browserSession.setUlid(this.ulid)

		this.contextHandler = new TaskContextHandler({
			cwd: this.cwd,
			stateManager: this.stateManager,
			workspaceManager: this.workspaceManager,
			codemarieIgnoreController: this.codemarieIgnoreController,
			terminalManager: this.terminalManager,
			fileContextTracker: this.fileContextTracker,
			urlContentFetcher: this.urlContentFetcher,
			focusChainManager: this.FocusChainManager,
			taskState: this.taskState,
			controller: this.controller,
			ulid: this.ulid,
			mcpHub: this.mcpHub,
			api: this.api,
			messageStateHandler: this.messageStateHandler,
		})

		this.uiManager = new TaskUIManager({
			taskState: this.taskState,
			messageStateHandler: this.messageStateHandler,
			postStateToWebview: this.postStateToWebview.bind(this),
			api: this.api,
			ulid: this.ulid,
			getCurrentProviderInfo: this.getCurrentProviderInfo.bind(this),
		})

		// Initialize checkpoint manager based on workspace configuration
		if (!isMultiRootWorkspace) {
			try {
				this.checkpointManager = buildCheckpointManager({
					taskId: this.taskId,
					messageStateHandler: this.messageStateHandler,
					fileContextTracker: this.fileContextTracker,
					diffViewProvider: this.diffViewProvider,
					taskState: this.taskState,
					workspaceManager: this.workspaceManager,
					getKnowledgeGraphService: this.getKnowledgeGraphService.bind(this),
					updateTaskHistory: this.updateTaskHistory,
					say: this.say.bind(this),
					cancelTask: this.cancelTask,
					postStateToWebview: this.postStateToWebview,
					initialConversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
					initialCheckpointManagerErrorMessage: this.taskState.checkpointManagerErrorMessage,
					stateManager: this.stateManager,
				})

				// If multi-root, kick off non-blocking initialization
				// Unreachable for now, leaving in for future multi-root checkpoint support
				if (
					shouldUseMultiRoot({
						workspaceManager: this.workspaceManager,
						enableCheckpoints: this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting"),
						stateManager: this.stateManager,
					})
				) {
					this.checkpointManager.initialize?.().catch((error: Error) => {
						Logger.error("Failed to initialize multi-root checkpoint manager:", error)
						this.taskState.checkpointManagerErrorMessage = error?.message || String(error)
					})
				}
			} catch (error) {
				Logger.error("Failed to initialize checkpoint manager:", error)
				if (this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting")) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error"
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: `Failed to initialize checkpoint manager: ${errorMessage}`,
					})
				}
			}
		}

		// Note: Task initialization (startTask/resumeTaskFromHistory) is now called
		// from Controller.initTask() AFTER the task instance is fully assigned.
		// This prevents race conditions where hooks run before controller.task is ready.

		// Set up focus chain file watcher (async, runs in background) only if focus chain is enabled
		if (this.FocusChainManager) {
			this.FocusChainManager.setupFocusChainFileWatcher().catch((error) => {
				Logger.error(`[Task ${this.taskId}] Failed to setup focus chain file watcher:`, error)
			})
		}

		// initialize telemetry

		// Extract domain of the provider endpoint if using OpenAI Compatible provider
		let openAiCompatibleDomain: string | undefined
		if (currentProvider === "openai" && apiConfiguration.openAiBaseUrl) {
			openAiCompatibleDomain = extractProviderDomainFromUrl(apiConfiguration.openAiBaseUrl)
		}

		// Initialize MAS after both API and orchestration stream are ready
		this.streamReadyPromise?.then(() => {
			if (this.orchestrationController && this.api) {
				this.multiAgentSystem = new MultiAgentStreamSystem(this.orchestrationController, this.api)
				this.taskState.multiAgentStreamSystem = this.multiAgentSystem
			}
		})

		if (historyItem) {
			// Open task from history
			telemetryService.captureTaskRestarted(this.ulid, currentProvider, openAiCompatibleDomain)
		} else {
			// New task started
			telemetryService.captureTaskCreated(this.ulid, currentProvider, openAiCompatibleDomain)
		}

		// Initialize command executor with config and callbacks
		const commandExecutorConfig: FullCommandExecutorConfig = {
			cwd: this.cwd,
			terminalExecutionMode: this.terminalExecutionMode,
			terminalManager: this.terminalManager,
			taskId: this.taskId,
			ulid: this.ulid,
		}

		const commandExecutorCallbacks: CommandExecutorCallbacks = {
			say: this.say.bind(this) as CommandExecutorCallbacks["say"],
			ask: async (type: string, text?: string, partial?: boolean) => {
				const result = await this.ask(type as CodemarieAsk, text, partial)
				return {
					response: result.response,
					text: result.text,
					images: result.images,
					files: result.files,
				}
			},
			updateBackgroundCommandState: (isRunning: boolean) =>
				this.controller.updateBackgroundCommandState(isRunning, this.taskId),
			updateCodemarieMessage: async (index: number, updates: { commandCompleted?: boolean; text?: string }) => {
				await this.messageStateHandler.updateCodemarieMessage(index, updates)
			},
			getCodemarieMessages: () => this.messageStateHandler.getCodemarieMessages() as Array<{ ask?: string; say?: string }>,
			addToUserMessageContent: (content: { type: string; text: string }) => {
				// Cast to CodemarieTextContentBlock which is compatible with CodemarieContent
				this.taskState.userMessageContent.push({ type: "text", text: content.text } as CodemarieTextContentBlock)
			},
		}

		this.commandExecutor = new CommandExecutor(commandExecutorConfig, commandExecutorCallbacks)

		this.toolExecutor = new ToolExecutor(
			this.taskState,
			this.messageStateHandler,
			this.api,
			this.urlContentFetcher,
			this.browserSession,
			this.diffViewProvider,
			this.mcpHub,
			this.fileContextTracker,
			this.codemarieIgnoreController,
			this.commandPermissionController,
			this.contextManager,
			this.stateManager,
			cwd,
			this.taskId,
			this.ulid,
			this.terminalExecutionMode,
			this.workspaceManager,
			isMultiRootEnabled(this.stateManager),
			this.say.bind(this),
			this.ask.bind(this),
			this.saveCheckpointCallback.bind(this),
			this.sayAndCreateMissingParamError.bind(this),
			this.removeLastPartialMessageIfExistsWithType.bind(this),
			this.executeCommandTool.bind(this),
			this.cancelBackgroundCommand.bind(this),
			() => this.checkpointManager?.doesLatestTaskCompletionHaveNewChanges() ?? Promise.resolve(false),
			this.FocusChainManager?.updateFCListFromToolResponse.bind(this.FocusChainManager) || (async () => {}),
			this.switchToActModeCallback.bind(this),
			this.cancelTask,
			// Atomic hook state helpers for ToolExecutor
			this.setActiveHookExecution.bind(this),
			this.clearActiveHookExecution.bind(this),
			this.getActiveHookExecution.bind(this),
			this.runUserPromptSubmitHook.bind(this),
			() => this.orchestrationController,
			this.getKnowledgeGraphService.bind(this),
		)

		this.lifecycleManager = new TaskLifecycleManager({
			taskId: this.taskId,
			ulid: this.ulid,
			cwd: this.cwd,
			codemarieIgnoreController: this.codemarieIgnoreController,
			messageStateHandler: this.messageStateHandler,
			taskState: this.taskState,
			postStateToWebview: this.postStateToWebview.bind(this),
			say: this.uiManager.say.bind(this.uiManager),
			ask: this.uiManager.ask.bind(this.uiManager),
			getMultiAgentSystem: () => this.multiAgentSystem,
			streamReadyPromise: this.streamReadyPromise,
			environmentContextTracker: this.environmentContextTracker,
			getCheckpointManager: () => this.checkpointManager,
			contextManager: this.contextManager,
			fileContextTracker: this.fileContextTracker,
			stateManager: this.stateManager,
			cancelTask: this.cancelTask.bind(this),
			setActiveHookExecution: this.setActiveHookExecution.bind(this),
			clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
			getActiveHookExecution: this.getActiveHookExecution.bind(this),
			initiateTaskLoop: (userContent) => this.aiStreamHandler.recursivelyMakeCodemarieRequests(userContent),
		})

		this.aiStreamHandler = new TaskAIStreamHandler({
			taskId: this.taskId,
			ulid: this.ulid,
			cwd: this.cwd,
			api: this.api,
			stateManager: this.stateManager,
			mcpHub: this.mcpHub,
			messageStateHandler: this.messageStateHandler,
			uiManager: this.uiManager,
			contextManager: this.contextManager,
			fileContextTracker: this.fileContextTracker,
			modelContextTracker: this.modelContextTracker,
			environmentContextTracker: this.environmentContextTracker,
			codemarieIgnoreController: this.codemarieIgnoreController,
			workspaceManager: this.workspaceManager as WorkspaceRootManager,
			controller: this.controller,
			taskState: this.taskState,
			terminalExecutionMode: this.terminalExecutionMode,
			isParallelToolCallingEnabled: () => this.isParallelToolCallingEnabled(),
			postStateToWebview: this.postStateToWebview.bind(this),
			cancelTask: this.cancelTask.bind(this),
			getKnowledgeGraphService: this.getKnowledgeGraphService.bind(this),
			setActiveHookExecution: this.setActiveHookExecution.bind(this),
			clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
			getActiveHookExecution: this.getActiveHookExecution.bind(this),
			updateSwarmState: async (metadata) => this.updateSwarmState(metadata),
			contextHandler: this.contextHandler,
			getCheckpointManager: () => this.checkpointManager,
			getMultiAgentSystem: () => this.multiAgentSystem,
			executeTool: this.toolExecutor.executeTool.bind(this.toolExecutor),
		})
		// The original lifecycleManager initialization was here. It has been replaced by the new one above.
		// The original lifecycleManager initialization was:
		// this.lifecycleManager = new TaskLifecycleManager({
		// 	taskId: this.taskId,
		// 	ulid: this.ulid,
		// 	cwd: this.cwd,
		// 	codemarieIgnoreController: this.codemarieIgnoreController,
		// 	messageStateHandler: this.messageStateHandler,
		// 	postStateToWebview: this.postStateToWebview.bind(this),
		// 	say: this.say.bind(this),
		// 	ask: this.ask.bind(this),
		// 	getMultiAgentSystem: () => this.multiAgentSystem,
		// 	streamReadyPromise: this.streamReadyPromise,
		// 	taskState: this.taskState,
		// 	environmentContextTracker: this.environmentContextTracker,
		// 	getCheckpointManager: () => this.checkpointManager,
		// 	contextManager: this.contextManager,
		// 	fileContextTracker: this.fileContextTracker,
		// 	stateManager: this.stateManager,
		// 	cancelTask: this.cancelTask.bind(this),
		// 	setActiveHookExecution: this.setActiveHookExecution.bind(this),
		// 	clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
		// 	getActiveHookExecution: this.getActiveHookExecution.bind(this),
		// 	initiateTaskLoop: this.initiateTaskLoop.bind(this),
		// })
	}

	// Communicate with webview

	// partial has three valid states true (partial message), false (completion of partial message), undefined (individual complete message)
	async ask(type: CodemarieAsk, text?: string, partial?: boolean) {
		return this.uiManager.ask(type, text, partial)
	}

	async handleWebviewAskResponse(askResponse: CodemarieAskResponse, text?: string, images?: string[], files?: string[]) {
		return this.uiManager.handleWebviewAskResponse(askResponse, text, images, files)
	}

	async say(type: CodemarieSay, text?: string, images?: string[], files?: string[], partial?: boolean) {
		return this.uiManager.say(type, text, images, files, partial)
	}

	async sayAndCreateMissingParamError(toolName: CodemarieDefaultTool, paramName: string, relPath?: string) {
		return this.uiManager.sayAndCreateMissingParamError(toolName, paramName, relPath)
	}

	async removeLastPartialMessageIfExistsWithType(type: "ask" | "say", askOrSay: CodemarieAsk | CodemarieSay) {
		return this.uiManager.removeLastPartialMessageIfExistsWithType(type, askOrSay)
	}

	private async saveCheckpointCallback(isAttemptCompletionMessage?: boolean, completionMessageTs?: number): Promise<void> {
		const streamId = this.orchestrationController?.getStreamId()
		if (streamId) {
			const checkpointHash = `checkpoint_${Date.now()}`
			await orchestrator
				.storeMemory(
					streamId,
					checkpointHash,
					JSON.stringify({ isAttempt: !!isAttemptCompletionMessage, ts: completionMessageTs }),
				)
				.catch(() => {})
		}
		return this.checkpointManager?.saveCheckpoint(isAttemptCompletionMessage, completionMessageTs) ?? Promise.resolve()
	}

	/**
	 * Check if parallel tool calling is enabled.
	 * Parallel tool calling is enabled if:
	 * 1. User has enabled it in settings, OR
	 * 2. The current model/provider supports native tool calling and handles parallel tools well
	 */
	private isParallelToolCallingEnabled(): boolean {
		const enableParallelSetting = this.stateManager.getGlobalSettingsKey("enableParallelToolCalling")
		const providerInfo = this.getCurrentProviderInfo()
		return isParallelToolCallingEnabled(enableParallelSetting, providerInfo)
	}

	private async switchToActModeCallback(): Promise<boolean> {
		return await this.controller.toggleActModeForYoloMode()
	}

	// Task lifecycle

	public async startTask(task?: string, images?: string[], files?: string[]): Promise<void> {
		return this.lifecycleManager.startTask(task, images, files)
	}

	public async resumeTaskFromHistory() {
		return this.lifecycleManager.resumeTaskFromHistory()
	}

	public async runUserPromptSubmitHook(
		userContent: CodemarieContent[],
		context: "initial_task" | "resume" | "feedback",
	): Promise<{ cancel?: boolean; wasCancelled?: boolean; contextModification?: string; errorMessage?: string }> {
		return this.lifecycleManager.runUserPromptSubmitHook(userContent, context)
	}

	/**
	 * Determines if the TaskCancel hook should run.
	 * Only runs if there's actual active work happening or if work was started in this session.
	 * Does NOT run when just showing the resume button or completion button with no active work.
	 * @returns true if the hook should run, false otherwise
	 */
	private async shouldRunTaskCancelHook(): Promise<boolean> {
		// Atomically check for active hook execution (work happening now)
		const activeHook = await this.getActiveHookExecution()
		if (activeHook) {
			return true
		}

		// Run if the API is currently streaming (work happening now)
		if (this.taskState.isStreaming) {
			return true
		}

		// Run if we're waiting for the first chunk (work happening now)
		if (this.taskState.isWaitingForFirstChunk) {
			return true
		}

		// Run if there's active background command (work happening now)
		if (this.commandExecutor.hasActiveBackgroundCommand()) {
			return true
		}

		// Check if we're at a button-only state (no active work, just waiting for user action)
		const codemarieMessages = this.messageStateHandler.getCodemarieMessages()
		const lastMessage = codemarieMessages.at(-1)
		const isAtButtonOnlyState =
			lastMessage?.type === "ask" &&
			(lastMessage.ask === "resume_task" ||
				lastMessage.ask === "resume_completed_task" ||
				lastMessage.ask === "completion_result")

		if (isAtButtonOnlyState) {
			// At button-only state - DON'T run hook because we're just waiting for user input
			// These button states appear when:
			// 1. Opening from history (resume_task/resume_completed_task)
			// 2. After task completion (completion_result with "Start New Task" button)
			// 3. After cancelling during active work (but work already stopped)
			// In all cases, we shouldn't run TaskCancel hook
			return false
		}

		// Not at a button-only state - we're in the middle of work or just finished something
		// Run the hook since cancelling would interrupt actual work
		return true
	}

	async abortTask() {
		try {
			// PHASE 1: Check if TaskCancel hook should run BEFORE any cleanup
			// We must capture this state now because subsequent cleanup will
			// clear the active work indicators that shouldRunTaskCancelHook checks
			const shouldRunTaskCancelHook = await this.shouldRunTaskCancelHook()

			// PHASE 2: Set abort flag to prevent race conditions
			// This must happen before canceling hooks so that hook catch blocks
			// can properly detect the abort state
			this.taskState.abort = true

			// Signal orchestrator that this stream has been aborted via controller
			if (this.orchestrationController) {
				this.orchestrationController.failStream("Task aborted by user or system").catch((err) => {
					Logger.error(`[Task ${this.taskId}] Failed to signal stream abort:`, err)
				})
			}

			if (this.multiAgentSystem) {
				// Ensure MAS is notified of the abort and records the reason
				this.multiAgentSystem.reportAbort("Task aborted by user or system").catch((err) => {
					Logger.error(`[Task ${this.taskId}] Failed to signal MAS abort:`, err)
				})
			}

			// PHASE 3: Cancel any running hook execution
			const activeHook = await this.getActiveHookExecution()
			if (activeHook) {
				try {
					await this.cancelHookExecution()
					// Clear activeHookExecution after hook is signaled
					await this.clearActiveHookExecution()
				} catch (error) {
					Logger.error("Failed to cancel hook during task abort", error)
					// Still clear state even on error to prevent stuck state
					await this.clearActiveHookExecution()
				}
			}

			if (this.commandExecutor.hasActiveBackgroundCommand()) {
				try {
					await this.commandExecutor.cancelBackgroundCommand()
				} catch (error) {
					Logger.error("Failed to cancel background command during task abort", error)
				}
			}

			// PHASE 4: Run TaskCancel hook
			// This allows the hook UI to appear in the webview
			// Use the shouldRunTaskCancelHook value we captured in Phase 1
			const hooksEnabled = getHooksEnabledSafe()
			if (hooksEnabled && shouldRunTaskCancelHook) {
				try {
					await executeHook({
						hookName: "TaskCancel",
						hookInput: {
							taskCancel: {
								taskMetadata: {
									taskId: this.taskId,
									ulid: this.ulid,
									completionStatus: this.taskState.abandoned ? "abandoned" : "cancelled",
								},
							},
						},
						isCancellable: false, // TaskCancel is NOT cancellable
						say: this.say.bind(this),
						// No setActiveHookExecution or clearActiveHookExecution for non-cancellable hooks
						messageStateHandler: this.messageStateHandler,
						taskId: this.taskId,
						hooksEnabled,
					})

					// TaskCancel completed successfully
					// Present resume button after successful TaskCancel hook
					const lastCodemarieMessage = this.messageStateHandler
						.getCodemarieMessages()
						.slice()
						.reverse()
						.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))

					let askType: CodemarieAsk
					if (lastCodemarieMessage?.ask === "completion_result") {
						askType = "resume_completed_task"
					} else {
						askType = "resume_task"
					}

					// Present the resume ask - this will show the resume button in the UI
					// We don't await this because we want to set the abort flag immediately
					// The ask will be waiting when the user decides to resume
					this.ask(askType).catch((error) => {
						// If ask fails (e.g., task was cleared), that's okay - just log it
						Logger.log("[TaskCancel] Resume ask failed (task may have been cleared):", error)
					})
				} catch (error) {
					// TaskCancel hook failed - non-fatal, just log
					Logger.error("[TaskCancel Hook] Failed (non-fatal):", error)
				}
			}

			// PHASE 5: Immediately update UI to reflect abort state
			try {
				await this.messageStateHandler.saveCodemarieMessagesAndUpdateHistory()
				await this.postStateToWebview()
			} catch (error) {
				Logger.error("Failed to post state after setting abort flag", error)
			}

			// PHASE 6: Check for incomplete progress
			if (this.FocusChainManager) {
				// Extract current model and provider for telemetry
				const apiConfig = this.stateManager.getApiConfiguration()
				const currentMode = this.stateManager.getGlobalSettingsKey("mode")
				const currentProvider = (
					currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
				) as string
				const currentModelId = this.api.getModel().id

				this.FocusChainManager.checkIncompleteProgressOnCompletion(currentModelId, currentProvider)
			}

			// PHASE 7: Clean up resources
			await this.terminalManager.disposeAll()
			this.urlContentFetcher.closeBrowser()
			await this.browserSession.dispose()
			this.codemarieIgnoreController.dispose()
			this.fileContextTracker.dispose()
			// need to await for when we want to make sure directories/files are reverted before
			// re-starting the task from a checkpoint
			await this.diffViewProvider.revertChanges()
			// Clear the notification callback when task is aborted
			this.mcpHub.clearNotificationCallback()
			if (this.FocusChainManager) {
				this.FocusChainManager.dispose()
			}
		} finally {
			// Release task folder lock
			if (this.taskLockAcquired) {
				try {
					await releaseTaskLock(this.taskId)
					this.taskLockAcquired = false
					Logger.info(`[Task ${this.taskId}] Task lock released`)
				} catch (error) {
					Logger.error(`[Task ${this.taskId}] Failed to release task lock:`, error)
				}
			}

			// Final state update to notify UI that abort is complete
			try {
				await this.postStateToWebview()
			} catch (error) {
				Logger.error("Failed to post final state after abort", error)
			}
		}
	}

	// Tools
	async executeCommandTool(
		command: string,
		timeoutSeconds: number | undefined,
		options?: CommandExecutionOptions,
	): Promise<[boolean, CodemarieToolResponseContent]> {
		return this.commandExecutor.execute(command, timeoutSeconds, options)
	}

	/**
	 * Cancel a background command that is running in the background
	 * @returns true if a command was cancelled, false if no command was running
	 */
	public async cancelBackgroundCommand(): Promise<boolean> {
		return this.commandExecutor.cancelBackgroundCommand()
	}

	/**
	 * Cancel a currently running hook execution
	 * @returns true if a hook was cancelled, false if no hook was running
	 */
	public async cancelHookExecution(): Promise<boolean> {
		const activeHook = await this.getActiveHookExecution()
		if (!activeHook) {
			return false
		}

		const { hookName, toolName, messageTs, abortController } = activeHook

		try {
			// Abort the hook process
			abortController.abort()

			// Update hook message status to "cancelled"
			const codemarieMessages = this.messageStateHandler.getCodemarieMessages()
			const hookMessageIndex = codemarieMessages.findIndex((m) => m.ts === messageTs)
			if (hookMessageIndex !== -1) {
				const cancelledMetadata = {
					hookName,
					toolName,
					status: "cancelled",
					exitCode: 130, // Standard SIGTERM exit code
				}
				await this.messageStateHandler.updateCodemarieMessage(hookMessageIndex, {
					text: JSON.stringify(cancelledMetadata),
				})
			}

			// Notify UI that hook was cancelled
			await this.say("hook_output_stream", "\nHook execution cancelled by user")

			// Return success - let caller (abortTask) handle next steps
			// DON'T call abortTask() here to avoid infinite recursion
			return true
		} catch (error) {
			Logger.error("Failed to cancel hook execution", error)
			return false
		}
	}

	private getCurrentProviderInfo(): ApiProviderInfo {
		return this.aiStreamHandler.getCurrentProviderInfo()
	}

	private async writePromptMetadataArtifacts(params: { systemPrompt: string; providerInfo: ApiProviderInfo }): Promise<void> {
		await this.aiStreamHandler.writePromptMetadataArtifacts(params)
	}

	private getApiRequestIdSafe(): string | undefined {
		return this.aiStreamHandler.getApiRequestIdSafe()
	}

	private async handleContextWindowExceededError(): Promise<void> {
		await this.aiStreamHandler.handleContextWindowExceededError()
	}

	private async getKnowledgeGraphService(): Promise<KnowledgeGraphService | undefined> {
		return this.aiStreamHandler.getKnowledgeGraphService()
	}

	private async updateSwarmState(metadata: OrchestrationEventMetadata): Promise<void> {
		await this.uiManager.updateSwarmState(metadata)
	}

	async recursivelyMakeCodemarieRequests(userContent: CodemarieContent[]): Promise<boolean> {
		await this.aiStreamHandler.recursivelyMakeCodemarieRequests(userContent)
		return true // didEndLoop
	}

	async loadContext(userContent: CodemarieContent[], includeFileDetails = false, useCompactPrompt = false) {
		return this.contextHandler.loadContext(userContent, includeFileDetails, useCompactPrompt)
	}

	async processNativeToolCalls(assistantTextOnly: string, toolBlocks: ToolUse[]) {
		return this.aiStreamHandler.processNativeToolCalls(assistantTextOnly, toolBlocks)
	}

	async getEnvironmentDetails(includeFileDetails = false) {
		return this.contextHandler.getEnvironmentDetails(includeFileDetails)
	}

	isProjectBlank(files: string[]): boolean {
		return this.contextHandler.isProjectBlank(files)
	}
}
