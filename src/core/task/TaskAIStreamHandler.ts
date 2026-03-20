import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { ApiHandler, ApiProviderInfo } from "@core/api"
import { GeminiHandler } from "@core/api/providers/gemini"
import { OpenAiHandler } from "@core/api/providers/openai"
import { ApiStream } from "@core/api/transform/stream"
import { AssistantMessageContent, ToolUse } from "@core/assistant-message"
import { ContextManager } from "@core/context/context-management/ContextManager"
import { checkContextWindowExceededError } from "@core/context/context-management/context-error-handling"
import { EnvironmentContextTracker } from "@core/context/context-tracking/EnvironmentContextTracker"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { ModelContextTracker } from "@core/context/context-tracking/ModelContextTracker"
import {
	getGlobalCodemarieRules,
	getLocalCodemarieRules,
	refreshCodemarieRulesToggles,
} from "@core/context/instructions/user-instructions/codemarie-rules"
import {
	getLocalAgentsRules,
	getLocalCursorRules,
	getLocalWindsurfRules,
	refreshExternalRulesToggles,
} from "@core/context/instructions/user-instructions/external-rules"
import { sendPartialMessageEvent } from "@core/controller/ui/subscribeToPartialMessage"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { executePreCompactHookWithCleanup, HookExecution } from "@core/hooks/precompact-executor"
import { CodemarieIgnoreController } from "@core/ignore/CodemarieIgnoreController"
import { formatResponse } from "@core/prompts/responses"
import { ensureRulesDirectoryExists, ensureTaskDirectoryExists } from "@core/storage/disk"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { ensureCheckpointInitialized } from "@integrations/checkpoints/initializer"
import { ICheckpointManager } from "@integrations/checkpoints/types"
import { featureFlagsService } from "@services/feature-flags"
import { McpHub } from "@services/mcp/McpHub"
import { findLastIndex } from "@shared/array"
import { CodemarieApiReqInfo, OrchestrationEventMetadata } from "@shared/ExtensionMessage"
import { DEFAULT_LANGUAGE_SETTINGS, getLanguageKey, LanguageDisplay } from "@shared/Languages"
import { convertCodemarieMessageToProto } from "@shared/proto-conversions/codemarie-message"
import { CodemarieDefaultTool } from "@shared/tools"
import { CodemarieAskResponse } from "@shared/WebviewMessage"
import { isLocalModel, isNextGenModelFamily } from "@utils/model-utils"
import fs from "fs/promises"
// biome-ignore lint/suspicious/noTsIgnore: lodash types missing
// @ts-ignore
import { cloneDeep } from "lodash"
import pWaitFor from "p-wait-for"
import * as path from "path"
import { getSystemPrompt, SystemPromptContext } from "@/core/prompts/system-prompt"
import { HostProvider } from "@/hosts/host-provider"
import { CodemarieError, CodemarieErrorType, ErrorService } from "@/services/error"
import { CodemarieClient } from "@/shared/codemarie"
import { CodemarieContent, CodemarieStorageMessage } from "@/shared/messages"
import { ApiFormat } from "@/shared/proto/codemarie/models"
import { Logger } from "@/shared/services/Logger"
import { RuleContextBuilder } from "../context/instructions/user-instructions/RuleContextBuilder"
import { discoverSkills, getAvailableSkills } from "../context/instructions/user-instructions/skills"
import { EmbeddingHandler, KnowledgeGraphService } from "../context/KnowledgeGraphService"
import { Controller } from "../controller"
import { MultiAgentStreamSystem } from "../orchestration/MultiAgentStreamSystem"
import { StateManager } from "../storage/StateManager"
import { MessageStateHandler } from "./message-state"
import { TaskContextHandler } from "./TaskContextHandler"
import { TaskState } from "./TaskState"
import { TaskUIManager } from "./TaskUIManager"
import { updateApiReqMsg } from "./utils"

export interface TaskAIDependencies {
	taskId: string
	ulid: string
	cwd: string
	api: ApiHandler
	stateManager: StateManager
	mcpHub: McpHub
	messageStateHandler: MessageStateHandler
	uiManager: TaskUIManager
	contextManager: ContextManager
	contextHandler: TaskContextHandler
	fileContextTracker: FileContextTracker
	modelContextTracker: ModelContextTracker
	environmentContextTracker: EnvironmentContextTracker
	codemarieIgnoreController: CodemarieIgnoreController
	workspaceManager: WorkspaceRootManager
	controller: Controller
	taskState: TaskState
	terminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	isParallelToolCallingEnabled: () => boolean
	setActiveHookExecution: (hookExecution: HookExecution | undefined) => Promise<void>
	clearActiveHookExecution: () => Promise<void>
	getActiveHookExecution: () => Promise<HookExecution | undefined>
	updateSwarmState: (metadata: OrchestrationEventMetadata) => Promise<void>
	getCheckpointManager: () => ICheckpointManager | undefined
	getMultiAgentSystem: () => MultiAgentStreamSystem | undefined
	postStateToWebview: () => Promise<void>
	cancelTask: () => Promise<void>
	getKnowledgeGraphService: () => Promise<KnowledgeGraphService | undefined>
	executeTool: (block: ToolUse) => Promise<void>
}

export class TaskAIStreamHandler {
	constructor(private deps: TaskAIDependencies) {}

	private get taskId() {
		return this.deps.taskId
	}
	private get ulid() {
		return this.deps.ulid
	}
	private get cwd() {
		return this.deps.cwd
	}
	private get taskState() {
		return this.deps.taskState
	}
	private get messageStateHandler() {
		return this.deps.messageStateHandler
	}
	private get api() {
		return this.deps.api
	}
	private get uiManager() {
		return this.deps.uiManager
	}

	public getCurrentProviderInfo(): ApiProviderInfo {
		const model = this.api.getModel()
		const apiConfig = this.deps.stateManager.getApiConfiguration()
		const mode = this.deps.stateManager.getGlobalSettingsKey("mode")
		const providerId = (mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const customPrompt = this.deps.stateManager.getGlobalSettingsKey("customPrompt")
		return { model, providerId, customPrompt, mode }
	}

	public async *attemptApiRequest(previousApiReqIndex: number): ApiStream {
		// Wait for MCP servers to be connected before generating system prompt
		await pWaitFor(() => this.deps.mcpHub.isConnecting !== true, {
			timeout: 10_000,
		}).catch(() => {
			Logger.error("MCP servers failed to connect in time")
		})

		const providerInfo = this.getCurrentProviderInfo()
		const host = await HostProvider.env.getHostVersion({})
		const ide = host?.platform || "Unknown"
		const isCliEnvironment = host.codemarieType === CodemarieClient.Cli
		const browserSettings = this.deps.stateManager.getGlobalSettingsKey("browserSettings")
		const disableBrowserTool = browserSettings.disableToolUse ?? false
		const modelSupportsBrowserUse = providerInfo.model.info.supportsImages ?? false
		const supportsBrowserUse = modelSupportsBrowserUse && !disableBrowserTool
		const preferredLanguageRaw = this.deps.stateManager.getGlobalSettingsKey("preferredLanguage")
		const preferredLanguage = getLanguageKey(preferredLanguageRaw as LanguageDisplay)
		const preferredLanguageInstructions =
			preferredLanguage && preferredLanguage !== DEFAULT_LANGUAGE_SETTINGS
				? `# Preferred Language\n\nSpeak in ${preferredLanguage}.`
				: ""

		const { globalToggles, localToggles } = await refreshCodemarieRulesToggles(this.deps.controller, this.cwd)
		const { windsurfLocalToggles, cursorLocalToggles, agentsLocalToggles } = await refreshExternalRulesToggles(
			this.deps.controller,
			this.cwd,
		)

		const evaluationContext = await RuleContextBuilder.buildEvaluationContext({
			cwd: this.cwd,
			messageStateHandler: this.messageStateHandler,
			workspaceManager: this.deps.workspaceManager,
		})

		const globalCodemarieRulesFilePath = await ensureRulesDirectoryExists()
		const globalRules = await getGlobalCodemarieRules(globalCodemarieRulesFilePath, globalToggles, { evaluationContext })
		const globalCodemarieRulesFileInstructions = globalRules.instructions

		const localRules = await getLocalCodemarieRules(this.cwd, localToggles, { evaluationContext })
		const localCodemarieRulesFileInstructions = localRules.instructions
		const [localCursorRulesFileInstructions, localCursorRulesDirInstructions] = await getLocalCursorRules(
			this.cwd,
			cursorLocalToggles,
		)
		const localWindsurfRulesFileInstructions = await getLocalWindsurfRules(this.cwd, windsurfLocalToggles)
		const localAgentsRulesFileInstructions = await getLocalAgentsRules(this.cwd, agentsLocalToggles)

		const codemarieIgnoreContent = this.deps.codemarieIgnoreController.codemarieIgnoreContent
		let codemarieIgnoreInstructions: string | undefined
		if (codemarieIgnoreContent) {
			codemarieIgnoreInstructions = formatResponse.codemarieIgnoreInstructions(codemarieIgnoreContent)
		}

		let workspaceRoots: Array<{ path: string; name: string; vcs?: string }> | undefined
		const multiRootEnabled = isMultiRootEnabled(this.deps.stateManager)
		if (multiRootEnabled && this.deps.workspaceManager) {
			workspaceRoots = this.deps.workspaceManager.getRoots().map((root) => ({
				path: root.path,
				name: root.name || path.basename(root.path),
				vcs: root.vcs as string | undefined,
			}))
		}

		const allSkills = await discoverSkills(this.cwd)
		const resolvedSkills = getAvailableSkills(allSkills)
		const globalSkillsToggles = this.deps.stateManager.getGlobalSettingsKey("globalSkillsToggles") ?? {}
		const localSkillsToggles = this.deps.stateManager.getWorkspaceStateKey("localSkillsToggles") ?? {}
		const availableSkills = resolvedSkills.filter((skill) => {
			const toggles = skill.source === "global" ? globalSkillsToggles : localSkillsToggles
			return toggles[skill.path] !== false
		})

		const openTabPaths = (await HostProvider.window.getOpenTabs({})).paths || []
		const visibleTabPaths = (await HostProvider.window.getVisibleTabs({})).paths || []
		const cap = 50
		const editorTabs = {
			open: openTabPaths.slice(0, cap),
			visible: visibleTabPaths.slice(0, cap),
		}

		const promptContext: SystemPromptContext = {
			cwd: this.cwd,
			ide,
			providerInfo,
			editorTabs,
			supportsBrowserUse,
			mcpHub: this.deps.mcpHub,
			skills: availableSkills,
			focusChainSettings: this.deps.stateManager.getGlobalSettingsKey("focusChainSettings"),
			globalCodemarieRulesFileInstructions,
			localCodemarieRulesFileInstructions,
			localCursorRulesFileInstructions,
			localCursorRulesDirInstructions,
			localWindsurfRulesFileInstructions,
			localAgentsRulesFileInstructions,
			codemarieIgnoreInstructions,
			preferredLanguageInstructions,
			browserSettings: this.deps.stateManager.getGlobalSettingsKey("browserSettings"),
			yoloModeToggled: this.deps.stateManager.getGlobalSettingsKey("yoloModeToggled"),
			subagentsEnabled: this.deps.stateManager.getGlobalSettingsKey("subagentsEnabled"),
			codemarieWebToolsEnabled:
				this.deps.stateManager.getGlobalSettingsKey("codemarieWebToolsEnabled") &&
				featureFlagsService.getWebtoolsEnabled(),
			isMultiRootEnabled: multiRootEnabled,
			workspaceRoots,
			isSubagentRun: false,
			isCliEnvironment,
			enableNativeToolCalls:
				providerInfo.model.info.apiFormat === ApiFormat.OPENAI_RESPONSES ||
				this.deps.stateManager.getGlobalStateKey("nativeToolCallEnabled"),
			enableParallelToolCalling: this.deps.isParallelToolCallingEnabled(),
			terminalExecutionMode: this.deps.terminalExecutionMode,
			mode: (providerInfo.mode as "plan" | "act") || "act",
			multiAgentStreamSystem: this.taskState.multiAgentStreamSystem,
		}

		const activatedConditionalRules = [...globalRules.activatedConditionalRules, ...localRules.activatedConditionalRules]
		if (activatedConditionalRules.length > 0) {
			await this.uiManager.say("conditional_rules_applied", JSON.stringify({ rules: activatedConditionalRules }))
		}

		const { systemPrompt, tools } = await getSystemPrompt(promptContext)
		this.taskState.useNativeToolCalls = !!tools?.length
		await this.writePromptMetadataArtifacts({ systemPrompt, providerInfo })

		const contextManagementMetadata = await this.deps.contextManager.getNewContextMessagesAndMetadata(
			this.messageStateHandler.getApiConversationHistory(),
			this.messageStateHandler.getCodemarieMessages(),
			this.api,
			this.taskState.conversationHistoryDeletedRange,
			previousApiReqIndex,
			await ensureTaskDirectoryExists(this.taskId),
			this.deps.stateManager.getGlobalSettingsKey("useAutoCondense") && isNextGenModelFamily(this.api.getModel().id),
		)

		if (contextManagementMetadata.updatedConversationHistoryDeletedRange) {
			this.taskState.conversationHistoryDeletedRange = contextManagementMetadata.conversationHistoryDeletedRange
			await this.messageStateHandler.saveCodemarieMessagesAndUpdateHistory()
			try {
				const kgService = await this.deps.getKnowledgeGraphService()
				if (kgService && contextManagementMetadata.conversationHistoryDeletedRange) {
					const [start, end] = contextManagementMetadata.conversationHistoryDeletedRange
					const apiHistory = this.messageStateHandler.getApiConversationHistory()
					const truncatedRange = apiHistory.slice(start, end + 1)
					if (truncatedRange.length > 0) {
						const snapshotContent = truncatedRange
							.map((m) => {
								const content = Array.isArray(m.content)
									? m.content
											.map((b) =>
												"text" in b ? b.text : b.type === "tool_use" ? `[Tool Use: ${b.name}]` : "",
											)
											.join("\n")
									: m.content
								return `${m.role.toUpperCase()}:\n${content}`
							})
							.join("\n\n")
						const snapshotId = await kgService.cognitiveSnapshot(this.taskId, snapshotContent, truncatedRange.length)
						Logger.info(`[Task ${this.taskId}] Created cognitive snapshot ${snapshotId} for truncated messages`)
					}
				}
			} catch (error) {
				Logger.warn(`[Task ${this.taskId}] Failed to create auto cognitive graph node:`, error)
			}
		}

		const stream = this.api.createMessage(systemPrompt, contextManagementMetadata.truncatedConversationHistory, tools)
		const iterator = stream[Symbol.asyncIterator]()

		try {
			this.taskState.isWaitingForFirstChunk = true
			const firstChunk = await iterator.next()
			yield firstChunk.value
			this.taskState.isWaitingForFirstChunk = false
		} catch (error) {
			const isContextWindowExceededError = checkContextWindowExceededError(error)
			const { model, providerId } = this.getCurrentProviderInfo()
			const codemarieError = ErrorService.get().toCodemarieError(error, model.id, providerId)
			ErrorService.get().logMessage(codemarieError.message)

			if (isContextWindowExceededError && !this.taskState.didAutomaticallyRetryFailedApiRequest) {
				await this.handleContextWindowExceededError()
			} else {
				if (isContextWindowExceededError) {
					const truncatedConversationHistory = this.deps.contextManager.getTruncatedMessages(
						this.messageStateHandler.getApiConversationHistory(),
						this.taskState.conversationHistoryDeletedRange,
					)
					if (truncatedConversationHistory.length > 3) {
						codemarieError.message =
							"Context window exceeded. Click retry to truncate the conversation and try again."
						this.taskState.didAutomaticallyRetryFailedApiRequest = false
					}
				}

				const streamingFailedMessage = codemarieError.serialize()
				const lastApiReqStartedIndex = findLastIndex(
					this.messageStateHandler.getCodemarieMessages(),
					(m) => m.say === "api_req_started",
				)
				if (lastApiReqStartedIndex !== -1) {
					const codemarieMessages = this.messageStateHandler.getCodemarieMessages()
					const currentApiReqInfo: CodemarieApiReqInfo = JSON.parse(
						codemarieMessages[lastApiReqStartedIndex].text || "{}",
					)
					delete currentApiReqInfo.retryStatus
					await this.messageStateHandler.updateCodemarieMessage(lastApiReqStartedIndex, {
						text: JSON.stringify({ ...currentApiReqInfo, streamingFailedMessage } satisfies CodemarieApiReqInfo),
					})
				}

				const isAuthError = codemarieError.isErrorType(CodemarieErrorType.Auth)
				const isCodemarieProviderInsufficientCredits =
					providerId === "codemarie" &&
					CodemarieError.transform(error, model.id, providerId).isErrorType(CodemarieErrorType.Balance)

				let response: CodemarieAskResponse
				if (!isCodemarieProviderInsufficientCredits && !isAuthError && this.taskState.autoRetryAttempts < 3) {
					this.taskState.autoRetryAttempts++
					const delay = 2000 * 2 ** (this.taskState.autoRetryAttempts - 1)
					await updateApiReqMsg({
						messageStateHandler: this.messageStateHandler,
						lastApiReqIndex: lastApiReqStartedIndex,
						inputTokens: 0,
						outputTokens: 0,
						cacheWriteTokens: 0,
						cacheReadTokens: 0,
						totalCost: undefined,
						api: this.api,
						cancelReason: "streaming_failed",
						streamingFailedMessage,
					})
					await this.messageStateHandler.saveCodemarieMessagesAndUpdateHistory()
					await this.deps.postStateToWebview()
					response = "yesButtonClicked"
					await this.uiManager.say(
						"error_retry",
						JSON.stringify({
							attempt: this.taskState.autoRetryAttempts,
							maxAttempts: 3,
							delaySeconds: delay / 1000,
							errorMessage: streamingFailedMessage,
						}),
					)
					const autoRetryApiReqIndex = findLastIndex(
						this.messageStateHandler.getCodemarieMessages(),
						(m) => m.say === "api_req_started",
					)
					if (autoRetryApiReqIndex !== -1) {
						const codemarieMessages = this.messageStateHandler.getCodemarieMessages()
						const currentApiReqInfo: CodemarieApiReqInfo = JSON.parse(
							codemarieMessages[autoRetryApiReqIndex].text || "{}",
						)
						delete currentApiReqInfo.streamingFailedMessage
						await this.messageStateHandler.updateCodemarieMessage(autoRetryApiReqIndex, {
							text: JSON.stringify(currentApiReqInfo),
						})
					}
					await setTimeoutPromise(delay)
				} else {
					if (!isCodemarieProviderInsufficientCredits && !isAuthError) {
						await this.uiManager.say(
							"error_retry",
							JSON.stringify({
								attempt: 3,
								maxAttempts: 3,
								delaySeconds: 0,
								failed: true,
								errorMessage: streamingFailedMessage,
							}),
						)
					}
					const askResult = await this.uiManager.ask("api_req_failed", streamingFailedMessage)
					response = askResult.response
					if (response === "yesButtonClicked") this.taskState.autoRetryAttempts = 0
				}

				if (response !== "yesButtonClicked") throw new Error("API request failed")

				const manualRetryApiReqIndex = findLastIndex(
					this.messageStateHandler.getCodemarieMessages(),
					(m) => m.say === "api_req_started",
				)
				if (manualRetryApiReqIndex !== -1) {
					const codemarieMessages = this.messageStateHandler.getCodemarieMessages()
					const currentApiReqInfo: CodemarieApiReqInfo = JSON.parse(
						codemarieMessages[manualRetryApiReqIndex].text || "{}",
					)
					delete currentApiReqInfo.streamingFailedMessage
					await this.messageStateHandler.updateCodemarieMessage(manualRetryApiReqIndex, {
						text: JSON.stringify(currentApiReqInfo),
					})
				}
				await this.uiManager.say("api_req_retried")
				this.taskState.didAutomaticallyRetryFailedApiRequest = false
			}
			yield* this.attemptApiRequest(previousApiReqIndex)
			return
		}
		yield* iterator
	}

	public async presentAssistantMessage() {
		if (this.taskState.abort) throw new Error("Codemarie instance aborted")

		if (this.taskState.presentAssistantMessageLocked) {
			this.taskState.presentAssistantMessageHasPendingUpdates = true
			return
		}

		this.taskState.presentAssistantMessageLocked = true
		this.taskState.presentAssistantMessageHasPendingUpdates = false

		if (this.taskState.currentStreamingContentIndex >= this.taskState.assistantMessageContent.length) {
			if (this.taskState.didCompleteReadingStream) this.taskState.userMessageContentReady = true
			this.taskState.presentAssistantMessageLocked = false
			return
		}

		const block = cloneDeep(this.taskState.assistantMessageContent[this.taskState.currentStreamingContentIndex])
		switch (block.type) {
			case "text": {
				if (
					this.taskState.didRejectTool ||
					(!this.deps.isParallelToolCallingEnabled() && this.taskState.didAlreadyUseTool)
				)
					break
				let content = block.content
				if (content) {
					if (block.partial) {
						// Dynamic Tool Stripping: Prevent tool call leakage into text streams
						const availableTools = Object.values(CodemarieDefaultTool)
						for (const toolUseName of availableTools) {
							const toolUseMark = `<${toolUseName}`
							if (content.includes(toolUseMark)) {
								content = content.split(toolUseMark)[0]
								break
							}
						}
					}
					await this.uiManager.say("text", content, undefined, undefined, block.partial)
				}
				if (!block.partial) {
					this.taskState.currentStreamingContentIndex++
				} else {
					this.taskState.presentAssistantMessageLocked = false
					return // wait for more content
				}
				break
			}
			case "tool_use": {
				if (this.taskState.didRejectTool) break
				// const _toolName = block.name as string
				// const _toolInput = block.params as any
				// const _callId = block.call_id as string
				if (block.partial) {
					this.taskState.presentAssistantMessageLocked = false
					return
				}
				this.taskState.didAlreadyUseTool = true
				const lastMessage = this.messageStateHandler.getCodemarieMessages().at(-1)
				if (lastMessage?.partial && lastMessage.type === "say" && lastMessage.say === "text") {
					lastMessage.partial = false
					await this.messageStateHandler.saveCodemarieMessagesAndUpdateHistory()
				}
				this.taskState.presentAssistantMessageLocked = false
				await this.deps.executeTool(block)
				break
			}
		}

		this.taskState.presentAssistantMessageLocked = false
		if (this.taskState.presentAssistantMessageHasPendingUpdates) {
			await this.presentAssistantMessage()
		}
	}

	public async writePromptMetadataArtifacts(params: { systemPrompt: string; providerInfo: ApiProviderInfo }): Promise<void> {
		const enabledFlag = process.env.CLINE_WRITE_PROMPT_ARTIFACTS?.toLowerCase()
		const enabled = enabledFlag === "1" || enabledFlag === "true" || enabledFlag === "yes"
		if (!enabled) return

		try {
			const configuredDir = process.env.CLINE_PROMPT_ARTIFACT_DIR?.trim()
			const artifactDir = configuredDir
				? path.isAbsolute(configuredDir)
					? configuredDir
					: path.resolve(this.cwd, configuredDir)
				: path.resolve(this.cwd, ".codemarie-prompt-artifacts")

			await fs.mkdir(artifactDir, { recursive: true })

			const ts = new Date().toISOString()
			const safeTs = ts.replace(/[:.]/g, "-")
			const baseName = `task-${this.taskId}-req-${this.taskState.apiRequestCount}-${safeTs}`
			const manifestPath = path.join(artifactDir, `${baseName}.manifest.json`)
			const promptPath = path.join(artifactDir, `${baseName}.system_prompt.md`)

			const manifest = {
				taskId: this.taskId,
				ulid: this.ulid,
				apiRequestCount: this.taskState.apiRequestCount,
				ts,
				cwd: this.cwd,
				mode: params.providerInfo.mode,
				provider: params.providerInfo.providerId,
				model: params.providerInfo.model.id,
				apiRequestId: this.getApiRequestIdSafe(),
				systemPromptPath: promptPath,
			}

			await Promise.all([
				fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8"),
				fs.writeFile(promptPath, params.systemPrompt, "utf8"),
			])
		} catch (error) {
			Logger.error("Failed to write prompt metadata artifacts:", error)
		}
	}

	public getApiRequestIdSafe(): string | undefined {
		const apiLike = this.api as Partial<{
			getLastRequestId: () => string | undefined
			lastGenerationId?: string
		}>
		return apiLike.getLastRequestId?.() ?? apiLike.lastGenerationId
	}

	private calculatePreCompactDeletedRange(apiConversationHistory: CodemarieStorageMessage[]): [number, number] {
		const newDeletedRange = this.deps.contextManager.getNextTruncationRange(
			apiConversationHistory,
			this.taskState.conversationHistoryDeletedRange,
			"quarter", // Force aggressive truncation on error
		)

		return newDeletedRange || [0, 0]
	}

	public async handleContextWindowExceededError(): Promise<void> {
		const apiConversationHistory = this.messageStateHandler.getApiConversationHistory()
		const hooksEnabled = getHooksEnabledSafe()
		if (hooksEnabled) {
			try {
				const deletedRange = this.calculatePreCompactDeletedRange(apiConversationHistory)
				await executePreCompactHookWithCleanup({
					taskId: this.taskId,
					ulid: this.ulid,
					apiConversationHistory,
					conversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
					contextManager: this.deps.contextManager,
					codemarieMessages: this.messageStateHandler.getCodemarieMessages(),
					messageStateHandler: this.messageStateHandler,
					compactionStrategy: "standard-truncation-lastquarter",
					deletedRange,
					say: this.uiManager.say.bind(this.uiManager),
					setActiveHookExecution: async (_hookExecution: HookExecution | undefined) => {
						// This needs to be delegated back to Task
					},
					clearActiveHookExecution: async () => {
						// This needs to be delegated back to Task
					},
					postStateToWebview: this.deps.postStateToWebview.bind(this.deps),
					taskState: this.taskState,
					cancelTask: this.deps.cancelTask.bind(this.deps),
					hooksEnabled: true,
				})
			} catch (_error) {
				// IGNORE
			}
		}

		const newDeletedRange = this.deps.contextManager.getNextTruncationRange(
			apiConversationHistory,
			this.taskState.conversationHistoryDeletedRange,
			"quarter",
		)

		this.taskState.conversationHistoryDeletedRange = newDeletedRange
		await this.messageStateHandler.saveCodemarieMessagesAndUpdateHistory()
		await this.deps.contextManager.triggerApplyStandardContextTruncationNoticeChange(
			Date.now(),
			await ensureTaskDirectoryExists(this.taskId),
			apiConversationHistory,
		)

		this.taskState.didAutomaticallyRetryFailedApiRequest = true
	}

	public async loadContext(
		userContent: CodemarieContent[],
		useCompactPrompt: boolean,
		isFirstRequest: boolean,
	): Promise<string> {
		const [_parsedUserContent, environmentDetails, _codemarierulesError] = await this.deps.contextHandler.loadContext(
			userContent,
			isFirstRequest, // includeFileDetails = isFirstRequest
			useCompactPrompt,
		)

		const providerInfo = this.getCurrentProviderInfo()
		const systemPromptContext: SystemPromptContext = {
			cwd: this.cwd,
			providerInfo,
			ide: "vscode", // Required field
			mcpHub: this.deps.mcpHub,
			enableNativeToolCalls: this.taskState.useNativeToolCalls,
			runtimePlaceholders: {
				environment_details: environmentDetails,
			},
		}

		const { systemPrompt } = await getSystemPrompt(systemPromptContext)
		return systemPrompt
	}

	public async recursivelyMakeCodemarieRequests(userContent: CodemarieContent[], customPrompt?: string): Promise<void> {
		if (this.taskState.abort) return

		if (customPrompt === "summarize" || customPrompt === "pre-compact") {
			this.taskState.currentlySummarizing = true
		}

		this.taskState.apiRequestCount++
		this.taskState.didAutomaticallyRetryFailedApiRequest = false
		this.taskState.didAlreadyUseTool = false
		this.taskState.didRejectTool = false
		this.taskState.userMessageContentReady = false
		this.taskState.didCompleteReadingStream = false

		const previousApiReqIndex = findLastIndex(
			this.messageStateHandler.getCodemarieMessages(),
			(m) => m.say === "api_req_started",
		)

		const providerInfo = this.getCurrentProviderInfo()
		const isFirstRequest = previousApiReqIndex === -1

		// Initialize checkpoint manager if needed
		if (
			isFirstRequest &&
			this.deps.stateManager.getGlobalSettingsKey("enableCheckpointsSetting") &&
			!this.taskState.checkpointManagerErrorMessage
		) {
			const checkpointManager = this.deps.getCheckpointManager()
			if (checkpointManager) {
				try {
					await ensureCheckpointInitialized({ checkpointManager })
					await this.uiManager.say("checkpoint_created")

					const lastCheckpointMessageIndex = findLastIndex(
						this.messageStateHandler.getCodemarieMessages(),
						(m) => m.say === "checkpoint_created",
					)

					if (lastCheckpointMessageIndex !== -1) {
						const commitPromise = checkpointManager.commit()
						commitPromise
							?.then(async (commitHash: string | undefined) => {
								if (commitHash) {
									await this.messageStateHandler.updateCodemarieMessage(lastCheckpointMessageIndex, {
										lastCheckpointHash: commitHash,
									})
								}
							})
							.catch((error: Error) => {
								Logger.error(`[TaskCheckpointManager] Failed to create checkpoint commit:`, error)
							})
					}
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error"
					Logger.error("Failed to initialize checkpoint manager:", errorMessage)
					this.taskState.checkpointManagerErrorMessage = errorMessage
				}
			}
		}

		const useCompactPrompt = customPrompt === "compact" && isLocalModel(providerInfo)
		const useAutoCondense = this.deps.stateManager.getGlobalSettingsKey("useAutoCondense")

		if (useAutoCondense && isNextGenModelFamily(this.api.getModel().id)) {
			if (this.taskState.currentlySummarizing) {
				this.taskState.currentlySummarizing = false
			}
		}

		await this.loadContext(userContent, useCompactPrompt, isFirstRequest)

		let streamError: Error | undefined
		try {
			const stream = this.attemptApiRequest(previousApiReqIndex)
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					this.taskState.assistantMessageContent.push({ type: "text", content: chunk.text, partial: true })
					await this.presentAssistantMessage()
				} else if (chunk.type === "tool_calls") {
					if (chunk.tool_call.function.name) {
						this.taskState.assistantMessageContent.push({
							type: "tool_use",
							name: chunk.tool_call.function.name as CodemarieDefaultTool,
							params: chunk.tool_call.function.arguments || {},
							call_id: chunk.tool_call.call_id || chunk.tool_call.function.id,
							partial: true,
						})
						await this.presentAssistantMessage()
					}
				} else if (chunk.type === "usage") {
					const providerInfo = this.getCurrentProviderInfo()
					this.deps.modelContextTracker.recordModelUsage(
						providerInfo.providerId,
						providerInfo.model.id,
						providerInfo.mode,
					)
				}
			}
			this.taskState.didCompleteReadingStream = true
			await this.presentAssistantMessage()
		} catch (error) {
			streamError = error as Error
		}

		if (streamError) {
			if (streamError.message.includes("context_length_exceeded") || streamError.message.includes("output_tokens_limit")) {
				await this.handleContextWindowExceededError()
				return this.recursivelyMakeCodemarieRequests(userContent, customPrompt)
			}
			throw streamError
		}

		if (this.taskState.apiRequestCount > 50) {
			throw new Error("Recursive API request limit exceeded")
		}

		if (this.taskState.userMessageContentReady) {
			const nextUserContent = this.messageStateHandler.getApiConversationHistory().at(-1)?.content as CodemarieContent[]
			return this.recursivelyMakeCodemarieRequests(nextUserContent)
		}
	}

	public async processNativeToolCalls(assistantTextOnly: string, toolBlocks: ToolUse[]) {
		if (!toolBlocks?.length) {
			return
		}
		// For native tool calls, mark all pending tool uses as complete
		const prevLength = this.taskState.assistantMessageContent.length

		// Get finalized tool uses and mark them as complete
		const textContent = assistantTextOnly.trim()
		const textBlocks: AssistantMessageContent[] = textContent ? [{ type: "text", content: textContent, partial: false }] : []

		// IMPORTANT: Finalize any partial text CodemarieMessage before we skip over it.
		const codemarieMessages = this.messageStateHandler.getCodemarieMessages()
		const lastMessage = codemarieMessages.at(-1)
		const shouldFinalizePartialText = textBlocks.length > 0
		if (shouldFinalizePartialText && lastMessage?.partial && lastMessage.type === "say" && lastMessage.say === "text") {
			lastMessage.text = textContent
			lastMessage.partial = false
			await this.messageStateHandler.saveCodemarieMessagesAndUpdateHistory()
			const protoMessage = convertCodemarieMessageToProto(lastMessage)
			await sendPartialMessageEvent(protoMessage)
		}

		this.taskState.assistantMessageContent = [...textBlocks, ...toolBlocks]

		if (toolBlocks.length > 0) {
			this.taskState.currentStreamingContentIndex = textBlocks.length
			this.taskState.userMessageContentReady = false
		} else if (this.taskState.assistantMessageContent.length > prevLength) {
			this.taskState.userMessageContentReady = false
		}
	}

	private knowledgeGraphService?: KnowledgeGraphService

	public async getKnowledgeGraphService(): Promise<KnowledgeGraphService | undefined> {
		if (this.knowledgeGraphService) {
			return this.knowledgeGraphService
		}

		const apiConfiguration = this.deps.stateManager.getApiConfiguration()
		let embeddingHandler: EmbeddingHandler | undefined

		// Use specifically configured embedding provider if available, otherwise fallback to primary provider if it supports embeddings
		const provider = apiConfiguration.embeddingProvider as string
		const geminiKey = apiConfiguration.embeddingApiKey || apiConfiguration.geminiApiKey
		const openAiKey = apiConfiguration.embeddingApiKey || apiConfiguration.openAiApiKey

		if (provider === "gemini" && geminiKey) {
			embeddingHandler = new GeminiHandler({
				onRetryAttempt: apiConfiguration.onRetryAttempt,
				geminiApiKey: geminiKey,
				geminiBaseUrl: apiConfiguration.geminiBaseUrl,
				apiModelId: apiConfiguration.embeddingModelId || "gemini-embedding-2-preview",
			})
		} else if (provider === "openai" && openAiKey) {
			embeddingHandler = new OpenAiHandler({
				onRetryAttempt: apiConfiguration.onRetryAttempt,
				openAiApiKey: openAiKey,
				openAiBaseUrl: apiConfiguration.embeddingOpenAiBaseUrl || apiConfiguration.openAiBaseUrl,
				openAiModelId: apiConfiguration.embeddingModelId || "text-embedding-3-small",
			})
		} else if (this.deps.api && typeof (this.deps.api as any).embedText === "function") {
			embeddingHandler = this.deps.api as unknown as EmbeddingHandler
		} else if (geminiKey) {
			// Fallback to gemini if we have a key even if it wasn't the explicitly selected provider
			embeddingHandler = new GeminiHandler({
				onRetryAttempt: apiConfiguration.onRetryAttempt,
				geminiApiKey: geminiKey,
				geminiBaseUrl: apiConfiguration.geminiBaseUrl,
				apiModelId: apiConfiguration.embeddingModelId || "gemini-embedding-2-preview",
			})
		} else if (openAiKey) {
			// Fallback to openai if we have a key
			embeddingHandler = new OpenAiHandler({
				onRetryAttempt: apiConfiguration.onRetryAttempt,
				openAiApiKey: openAiKey,
				openAiBaseUrl: apiConfiguration.embeddingOpenAiBaseUrl || apiConfiguration.openAiBaseUrl,
				openAiModelId: apiConfiguration.embeddingModelId || "text-embedding-3-small",
			})
		}

		// Always initialize KnowledgeGraphService, using a dummy handler if no keys are found
		// This enables fallback keyword strategies in the graph service even when embeddings are unavailable.
		if (!embeddingHandler) {
			Logger.warn(`[Task ${this.taskId}] No embedding provider keys found. Falling back to keyword-only graph indexing.`)
			embeddingHandler = {
				embedText: async () => null,
			}
		}

		this.knowledgeGraphService = await KnowledgeGraphService.getInstance(embeddingHandler)
		return this.knowledgeGraphService
	}
}
