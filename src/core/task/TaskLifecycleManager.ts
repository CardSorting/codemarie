import { ContextManager } from "@core/context/context-management/ContextManager"
import { EnvironmentContextTracker } from "@core/context/context-tracking/EnvironmentContextTracker"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { HookExecution } from "@core/hooks/precompact-executor"
import { CodemarieIgnoreController } from "@core/ignore/CodemarieIgnoreController"
import { formatResponse } from "@core/prompts/responses"
import { ensureTaskDirectoryExists, getSavedApiConversationHistory, getSavedCodemarieMessages } from "@core/storage/disk"
import { ICheckpointManager } from "@integrations/checkpoints/types"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { findLastIndex } from "@shared/array"
import { CodemarieApiReqInfo, CodemarieAsk } from "@shared/ExtensionMessage"
import { CodemarieContent, CodemarieImageContentBlock, CodemarieStorageMessage, CodemarieUserContent } from "@/shared/messages"
import { Logger } from "@/shared/services/Logger"
import { executeHook } from "../hooks/hook-executor"
import { MultiAgentStreamSystem } from "../orchestration/MultiAgentStreamSystem"
import { StateManager } from "../storage/StateManager"
import { MessageStateHandler } from "./message-state"
import { TaskState } from "./TaskState"
import { TaskUIManager } from "./TaskUIManager"
import { buildUserFeedbackContent } from "./utils/buildUserFeedbackContent"

export interface TaskLifecycleDependencies {
	taskId: string
	ulid: string
	cwd: string
	codemarieIgnoreController: CodemarieIgnoreController
	messageStateHandler: MessageStateHandler
	postStateToWebview: () => Promise<void>
	say: TaskUIManager["say"]
	ask: TaskUIManager["ask"]
	getMultiAgentSystem: () => MultiAgentStreamSystem | undefined
	streamReadyPromise?: Promise<void>
	taskState: TaskState
	environmentContextTracker: EnvironmentContextTracker
	getCheckpointManager: () => ICheckpointManager | undefined
	contextManager: ContextManager
	fileContextTracker: FileContextTracker
	stateManager: StateManager
	cancelTask: () => Promise<void>
	setActiveHookExecution: (execution: HookExecution) => Promise<void>
	clearActiveHookExecution: () => Promise<void>
	getActiveHookExecution: () => Promise<HookExecution | undefined>
	initiateTaskLoop: (userContent: CodemarieContent[]) => Promise<void>
}

export class TaskLifecycleManager {
	constructor(private deps: TaskLifecycleDependencies) {}

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

	public async startTask(task?: string, images?: string[], files?: string[]): Promise<void> {
		try {
			await this.deps.codemarieIgnoreController.initialize()
		} catch (error) {
			Logger.error("Failed to initialize CodemarieIgnoreController:", error)
		}

		this.messageStateHandler.setCodemarieMessages([])
		this.messageStateHandler.setApiConversationHistory([])

		await this.deps.postStateToWebview()
		await this.deps.say("task", task, images, files)

		// Phase 1: Ingest task into MAS for context enrichment
		this.deps.streamReadyPromise?.then(() => {
			const mas = this.deps.getMultiAgentSystem()
			if (mas && task) {
				mas.processUserFeedback(task).catch((err) => {
					Logger.error(`[Task ${this.taskId}] Failed to ingest task into MAS:`, err)
				})
			}
		})

		this.taskState.isInitialized = true

		const imageBlocks: CodemarieImageContentBlock[] = formatResponse.imageBlocks(images)

		const userContent: CodemarieUserContent[] = [
			{
				type: "text",
				text: `<task>\n${task}\n</task>`,
			},
			...imageBlocks,
		]

		if (files && files.length > 0) {
			const fileContentString = await processFilesIntoText(files)
			if (fileContentString) {
				userContent.push({
					type: "text",
					text: fileContentString,
				})
			}
		}

		// Add TaskStart hook context to the conversation if provided
		const hooksEnabled = getHooksEnabledSafe()
		if (hooksEnabled) {
			const taskStartResult = await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: this.taskId,
							ulid: this.ulid,
							initialTask: task || "",
						},
					},
				},
				isCancellable: true,
				say: this.deps.say.bind(this.deps),
				setActiveHookExecution: this.deps.setActiveHookExecution.bind(this.deps),
				clearActiveHookExecution: this.deps.clearActiveHookExecution.bind(this.deps),
				messageStateHandler: this.messageStateHandler,
				taskId: this.taskId,
				hooksEnabled,
			})

			// Handle cancellation from hook
			if (taskStartResult.cancel === true) {
				await this.handleHookCancellation("TaskStart", taskStartResult.wasCancelled ?? false)
				await this.deps.cancelTask()
				return
			}

			// Add context modification to the conversation if provided
			if (taskStartResult.contextModification) {
				const contextText = taskStartResult.contextModification.trim()
				if (contextText) {
					userContent.push({
						type: "text",
						text: `<hook_context source="TaskStart">\n${contextText}\n</hook_context>`,
					})
				}
			}
		}

		if (this.taskState.abort) return

		const userPromptHookResult = await this.runUserPromptSubmitHook(userContent, "initial_task")

		if (this.taskState.abort) return

		if (userPromptHookResult.cancel === true) {
			await this.handleHookCancellation("UserPromptSubmit", userPromptHookResult.wasCancelled ?? false)
			await this.deps.cancelTask()
			return
		}

		if (userPromptHookResult.contextModification) {
			userContent.push({
				type: "text",
				text: `<hook_context source="UserPromptSubmit">\n${userPromptHookResult.contextModification}\n</hook_context>`,
			})
		}

		try {
			await this.deps.environmentContextTracker.recordEnvironment()
		} catch (error) {
			Logger.error("Failed to record environment metadata:", error)
		}

		await this.deps.initiateTaskLoop(userContent)
	}

	public async resumeTaskFromHistory() {
		try {
			await this.deps.codemarieIgnoreController.initialize()
		} catch (error) {
			Logger.error("Failed to initialize CodemarieIgnoreController:", error)
		}

		const savedCodemarieMessages = await getSavedCodemarieMessages(this.taskId)

		const lastRelevantMessageIndex = findLastIndex(
			savedCodemarieMessages,
			(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
		)
		if (lastRelevantMessageIndex !== -1) {
			savedCodemarieMessages.splice(lastRelevantMessageIndex + 1)
		}

		const lastApiReqStartedIndex = findLastIndex(
			savedCodemarieMessages,
			(m) => m.type === "say" && m.say === "api_req_started",
		)
		if (lastApiReqStartedIndex !== -1) {
			const lastApiReqStarted = savedCodemarieMessages[lastApiReqStartedIndex]
			const { cost, cancelReason }: CodemarieApiReqInfo = JSON.parse(lastApiReqStarted.text || "{}")
			if (cost === undefined && cancelReason === undefined) {
				savedCodemarieMessages.splice(lastApiReqStartedIndex, 1)
			}
		}

		await this.messageStateHandler.overwriteCodemarieMessages(savedCodemarieMessages)
		this.messageStateHandler.setCodemarieMessages(await getSavedCodemarieMessages(this.taskId))

		// Phase 1: Ingest resumption feedback into MAS
		const mas = this.deps.getMultiAgentSystem()
		if (mas && savedCodemarieMessages.length > 0) {
			const lastMessage = savedCodemarieMessages.at(-1)
			if (lastMessage?.type === "say" && lastMessage.text) {
				mas.processUserFeedback(`Resuming Task. Last State: ${lastMessage.text}`).catch((err) => {
					Logger.error(`[Task ${this.taskId}] Failed to ingest resumption into MAS:`, err)
				})
			}
		}

		const savedApiConversationHistory = await getSavedApiConversationHistory(this.taskId)
		this.messageStateHandler.setApiConversationHistory(savedApiConversationHistory)

		try {
			for (const message of savedApiConversationHistory) {
				if (message.role === "user" && Array.isArray(message.content)) {
					const groundingBlock = message.content.find(
						(c) => c.type === "text" && c.text?.includes("<grounded_specification>"),
					)
					if (groundingBlock && groundingBlock.type === "text" && groundingBlock.text) {
						const match = groundingBlock.text.match(/<grounded_specification>\n([\s\S]*)\n<\/grounded_specification>/)
						if (match) {
							this.taskState.groundedSpec = JSON.parse(match[1])
							this.taskState.didAttemptGrounding = true
							Logger.info(`[Task ${this.taskId}] Restored grounded specification from history.`)
							break
						}
					}
				}
			}
		} catch (error) {
			Logger.warn(`[Task ${this.taskId}] Failed to restore grounded spec from history:`, error)
		}

		await ensureTaskDirectoryExists(this.taskId)
		await this.deps.contextManager.initializeContextHistory(await ensureTaskDirectoryExists(this.taskId))

		const lastCodemarieMessage = this.messageStateHandler
			.getCodemarieMessages()
			.slice()
			.reverse()
			.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))

		const askType: CodemarieAsk = lastCodemarieMessage?.ask === "completion_result" ? "resume_completed_task" : "resume_task"

		this.taskState.isInitialized = true
		this.taskState.abort = false

		const { response, text, images, files } = await this.deps.ask(askType)

		const newUserContent: CodemarieContent[] = []
		const hooksEnabled = getHooksEnabledSafe()
		if (hooksEnabled) {
			const codemarieMessages = this.messageStateHandler.getCodemarieMessages()
			const taskResumeResult = await executeHook({
				hookName: "TaskResume",
				hookInput: {
					taskResume: {
						taskMetadata: { taskId: this.taskId, ulid: this.ulid },
						previousState: {
							lastMessageTs: lastCodemarieMessage?.ts?.toString() || "",
							messageCount: codemarieMessages.length.toString(),
							conversationHistoryDeleted: (this.taskState.conversationHistoryDeletedRange !== undefined).toString(),
						},
					},
				},
				isCancellable: true,
				say: this.deps.say.bind(this.deps),
				setActiveHookExecution: this.deps.setActiveHookExecution.bind(this.deps),
				clearActiveHookExecution: this.deps.clearActiveHookExecution.bind(this.deps),
				messageStateHandler: this.messageStateHandler,
				taskId: this.taskId,
				hooksEnabled,
			})

			if (taskResumeResult.cancel === true) {
				await this.handleHookCancellation("TaskResume", taskResumeResult.wasCancelled ?? false)
				await this.deps.cancelTask()
				return
			}

			if (taskResumeResult.contextModification) {
				newUserContent.push({
					type: "text",
					text: `<hook_context source="TaskResume" type="general">\n${taskResumeResult.contextModification}\n</hook_context>`,
				})
			}
		}

		if (this.taskState.abort) return

		let responseText: string | undefined
		let responseImages: string[] | undefined
		let responseFiles: string[] | undefined
		if (response === "messageResponse" || text || (images && images.length > 0) || (files && files.length > 0)) {
			await this.deps.say("user_feedback", text, images, files)
			await this.deps.getCheckpointManager()?.saveCheckpoint()
			responseText = text
			responseImages = images
			responseFiles = files
		}

		const existingApiConversationHistory = this.messageStateHandler.getApiConversationHistory()
		let modifiedOldUserContent: CodemarieContent[]
		let modifiedApiConversationHistory: CodemarieStorageMessage[]
		if (existingApiConversationHistory.length > 0) {
			const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]
			if (lastMessage.role === "assistant") {
				modifiedApiConversationHistory = [...existingApiConversationHistory]
				modifiedOldUserContent = []
			} else if (lastMessage.role === "user") {
				const existingUserContent: CodemarieContent[] = Array.isArray(lastMessage.content)
					? (lastMessage.content as CodemarieContent[])
					: [{ type: "text", text: lastMessage.content as string }]
				modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
				modifiedOldUserContent = [...existingUserContent]
			} else {
				throw new Error("Unexpected: Last message is not a user or assistant message")
			}
		} else {
			modifiedApiConversationHistory = []
			modifiedOldUserContent = []
		}

		newUserContent.push(...modifiedOldUserContent)

		const AGO_TEXT = (() => {
			const timestamp = lastCodemarieMessage?.ts ?? Date.now()
			const diff = Date.now() - timestamp
			const minutes = Math.floor(diff / 60000)
			const hours = Math.floor(minutes / 60)
			const days = Math.floor(hours / 24)
			if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`
			if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`
			if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
			return "just now"
		})()

		const wasRecent = lastCodemarieMessage?.ts && Date.now() - lastCodemarieMessage.ts < 30_000
		const pendingContextWarning = await this.deps.fileContextTracker.retrieveAndClearPendingFileContextWarning()
		const hasPendingFileContextWarnings = pendingContextWarning && pendingContextWarning.length > 0

		const mode = this.deps.stateManager.getGlobalSettingsKey("mode")
		const [taskResumptionMessage, userResponseMessage] = formatResponse.taskResumption(
			mode === "plan" ? "plan" : "act",
			AGO_TEXT,
			this.cwd,
			wasRecent,
			responseText,
			hasPendingFileContextWarnings,
		)

		if (taskResumptionMessage) newUserContent.push({ type: "text", text: taskResumptionMessage })
		if (userResponseMessage) newUserContent.push({ type: "text", text: userResponseMessage })
		if (responseImages?.length) newUserContent.push(...formatResponse.imageBlocks(responseImages))

		if (responseFiles?.length) {
			const fileContentString = await processFilesIntoText(responseFiles)
			if (fileContentString) newUserContent.push({ type: "text", text: fileContentString })
		}

		if (pendingContextWarning?.length) {
			newUserContent.push({ type: "text", text: formatResponse.fileContextWarning(pendingContextWarning) })
		}

		const userFeedbackContent = await buildUserFeedbackContent(responseText, responseImages, responseFiles)
		const userPromptHookResult = await this.runUserPromptSubmitHook(userFeedbackContent, "resume")

		if (this.taskState.abort) return

		if (userPromptHookResult.cancel === true) {
			await this.deps.cancelTask()
			return
		}

		if (userPromptHookResult.contextModification) {
			newUserContent.push({
				type: "text",
				text: `<hook_context source="UserPromptSubmit">\n${userPromptHookResult.contextModification}\n</hook_context>`,
			})
		}

		try {
			await this.deps.environmentContextTracker.recordEnvironment()
		} catch (error) {
			Logger.error("Failed to record environment metadata on resume:", error)
		}

		await this.messageStateHandler.overwriteApiConversationHistory(modifiedApiConversationHistory)
		await this.deps.initiateTaskLoop(newUserContent)
	}

	private async handleHookCancellation(hookName: string, wasCancelled: boolean): Promise<void> {
		this.taskState.didFinishAbortingStream = true
		await this.messageStateHandler.saveCodemarieMessagesAndUpdateHistory()
		await this.messageStateHandler.overwriteApiConversationHistory(this.messageStateHandler.getApiConversationHistory())
		await this.deps.postStateToWebview()
		Logger.log(`[Task ${this.taskId}] ${hookName} hook cancelled (userInitiated: ${wasCancelled})`)
	}

	public async runUserPromptSubmitHook(
		userContent: CodemarieContent[],
		_context: "initial_task" | "resume" | "feedback",
	): Promise<{ cancel?: boolean; wasCancelled?: boolean; contextModification?: string; errorMessage?: string }> {
		const hooksEnabled = getHooksEnabledSafe()
		if (!hooksEnabled) return {}

		const { extractUserPromptFromContent } = await import("./utils/extractUserPromptFromContent")
		const promptText = extractUserPromptFromContent(userContent)

		const userPromptResult = await executeHook({
			hookName: "UserPromptSubmit",
			hookInput: {
				userPromptSubmit: {
					prompt: promptText,
					attachments: [],
				},
			},
			isCancellable: true,
			say: this.deps.say.bind(this.deps),
			setActiveHookExecution: this.deps.setActiveHookExecution.bind(this.deps),
			clearActiveHookExecution: this.deps.clearActiveHookExecution.bind(this.deps),
			messageStateHandler: this.messageStateHandler,
			taskId: this.taskId,
			hooksEnabled,
		})

		if (userPromptResult.cancel === true && userPromptResult.wasCancelled) {
			this.taskState.didFinishAbortingStream = true
			await this.messageStateHandler.saveCodemarieMessagesAndUpdateHistory()
			await this.messageStateHandler.overwriteApiConversationHistory(this.messageStateHandler.getApiConversationHistory())
			await this.deps.postStateToWebview()
		}

		return {
			cancel: userPromptResult.cancel,
			contextModification: userPromptResult.contextModification,
			errorMessage: userPromptResult.errorMessage,
		}
	}
}
