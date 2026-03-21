import { ApiHandler, ApiProviderInfo } from "@core/api"
import { sendPartialMessageEvent } from "@core/controller/system/subscribeToPartialMessage"
import { formatResponse } from "@core/prompts/responses"
import { CodemarieAsk, CodemarieSay, OrchestrationEventMetadata } from "@shared/ExtensionMessage"
import { convertCodemarieMessageToProto } from "@shared/proto-conversions/codemarie-message"
import { CodemarieDefaultTool } from "@shared/tools"
import { CodemarieAskResponse } from "@shared/WebviewMessage"
import pWaitFor from "p-wait-for"
import { CodemarieMessageModelInfo, CodemarieToolResponseContent } from "@/shared/messages"
import { MessageStateHandler } from "./message-state"
import { TaskState } from "./TaskState"

export interface TaskUIDependencies {
	taskState: TaskState
	messageStateHandler: MessageStateHandler
	postStateToWebview: () => Promise<void>
	api: ApiHandler
	ulid: string
	getCurrentProviderInfo: () => ApiProviderInfo
}

export class TaskUIManager {
	constructor(private deps: TaskUIDependencies) {}

	async say(
		type: CodemarieSay,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
	): Promise<number | undefined> {
		if (this.deps.taskState.abort && type !== "hook_status" && type !== "hook_output_stream") {
			throw new Error("Codemarie instance aborted")
		}

		const providerInfo = this.deps.getCurrentProviderInfo()
		const modelInfo: CodemarieMessageModelInfo = {
			providerId: providerInfo.providerId,
			modelId: providerInfo.model.id,
			mode: providerInfo.mode,
		}

		if (partial !== undefined) {
			const messages = this.deps.messageStateHandler.getCodemarieMessages()
			const lastMessage = messages.at(-1)
			const isUpdatingPreviousPartial = lastMessage?.partial && lastMessage.type === "say" && lastMessage.say === type

			if (partial) {
				if (isUpdatingPreviousPartial) {
					const lastIndex = messages.length - 1
					await this.deps.messageStateHandler.updateCodemarieMessage(lastIndex, {
						text,
						images,
						files,
						partial,
					})
					const protoMessage = convertCodemarieMessageToProto(lastMessage!)
					await sendPartialMessageEvent(protoMessage)
					return undefined
				}
				const sayTs = Date.now()
				this.deps.taskState.lastMessageTs = sayTs
				await this.deps.messageStateHandler.addToCodemarieMessages({
					ts: sayTs,
					type: "say",
					say: type,
					text,
					images,
					files,
					partial,
					modelInfo,
				})
				await this.deps.postStateToWebview()
				return sayTs
			}

			if (isUpdatingPreviousPartial) {
				this.deps.taskState.lastMessageTs = lastMessage!.ts
				const lastIndex = messages.length - 1
				await this.deps.messageStateHandler.updateCodemarieMessage(lastIndex, {
					text,
					images,
					files,
					partial: false,
				})
				const protoMessage = convertCodemarieMessageToProto(lastMessage!)
				await sendPartialMessageEvent(protoMessage)
				return undefined
			}
		}

		const sayTs = Date.now()
		this.deps.taskState.lastMessageTs = sayTs
		await this.deps.messageStateHandler.addToCodemarieMessages({
			ts: sayTs,
			type: "say",
			say: type,
			text,
			images,
			files,
			modelInfo,
		})
		await this.deps.postStateToWebview()
		return sayTs
	}

	async ask(
		type: CodemarieAsk,
		text?: string,
		partial?: boolean,
	): Promise<{
		response: CodemarieAskResponse
		text?: string
		images?: string[]
		files?: string[]
		askTs?: number
	}> {
		if (this.deps.taskState.abort && type !== "resume_task" && type !== "resume_completed_task") {
			throw new Error("Codemarie instance aborted")
		}

		let askTs: number
		if (partial !== undefined) {
			const messages = this.deps.messageStateHandler.getCodemarieMessages()
			const lastMessage = messages.at(-1)
			const isUpdatingPreviousPartial = lastMessage?.partial && lastMessage.type === "ask" && lastMessage.ask === type

			if (partial) {
				if (isUpdatingPreviousPartial) {
					await this.deps.messageStateHandler.updateCodemarieMessage(messages.length - 1, {
						text,
						partial,
					})
					const protoMessage = convertCodemarieMessageToProto(lastMessage!)
					await sendPartialMessageEvent(protoMessage)
					throw new Error("Current ask promise was ignored")
				}
				askTs = Date.now()
				this.deps.taskState.lastMessageTs = askTs
				await this.deps.messageStateHandler.addToCodemarieMessages({
					ts: askTs,
					type: "ask",
					ask: type,
					text,
					partial,
				})
				await this.deps.postStateToWebview()
				throw new Error("Current ask promise was ignored")
			}

			if (isUpdatingPreviousPartial) {
				askTs = lastMessage!.ts
				this.deps.taskState.lastMessageTs = askTs
				await this.deps.messageStateHandler.updateCodemarieMessage(messages.length - 1, {
					text,
					partial: false,
				})
				const protoMessage = convertCodemarieMessageToProto(lastMessage!)
				await sendPartialMessageEvent(protoMessage)
			} else {
				askTs = Date.now()
				this.deps.taskState.lastMessageTs = askTs
				await this.deps.messageStateHandler.addToCodemarieMessages({
					ts: askTs,
					type: "ask",
					ask: type,
					text,
				})
				await this.deps.postStateToWebview()
			}
		} else {
			this.deps.taskState.askResponse = undefined
			askTs = Date.now()
			this.deps.taskState.lastMessageTs = askTs
			await this.deps.messageStateHandler.addToCodemarieMessages({
				ts: askTs,
				type: "ask",
				ask: type,
				text,
			})
			await this.deps.postStateToWebview()
		}

		await pWaitFor(() => this.deps.taskState.askResponse !== undefined || this.deps.taskState.lastMessageTs !== askTs, {
			interval: 100,
		})

		if (this.deps.taskState.lastMessageTs !== askTs) {
			throw new Error("Current ask promise was ignored")
		}

		const result = {
			response: this.deps.taskState.askResponse!,
			text: this.deps.taskState.askResponseText,
			images: this.deps.taskState.askResponseImages,
			files: this.deps.taskState.askResponseFiles,
		}

		this.deps.taskState.askResponse = undefined
		this.deps.taskState.askResponseText = undefined
		this.deps.taskState.askResponseImages = undefined
		this.deps.taskState.askResponseFiles = undefined

		return result
	}

	async sayAndCreateMissingParamError(
		toolName: CodemarieDefaultTool,
		paramName: string,
		relPath?: string,
	): Promise<CodemarieToolResponseContent> {
		await this.say(
			"error",
			`Codemarie tried to use ${toolName}${
				relPath ? ` for '${relPath}'` : ""
			} without value for required parameter '${paramName}'. Retrying...`,
		)
		return formatResponse.toolError(formatResponse.missingToolParameterError(paramName))
	}

	async removeLastPartialMessageIfExistsWithType(type: "ask" | "say", askOrSay: CodemarieAsk | CodemarieSay) {
		const messages = this.deps.messageStateHandler.getCodemarieMessages()
		const lastMessage = messages.at(-1)
		if (lastMessage?.partial && lastMessage.type === type && (lastMessage.ask === askOrSay || lastMessage.say === askOrSay)) {
			this.deps.messageStateHandler.setCodemarieMessages(messages.slice(0, -1))
			await this.deps.messageStateHandler.saveCodemarieMessagesAndUpdateHistory()
		}
	}

	async handleWebviewAskResponse(askResponse: CodemarieAskResponse, text?: string, images?: string[], files?: string[]) {
		this.deps.taskState.askResponse = askResponse
		this.deps.taskState.askResponseText = text
		this.deps.taskState.askResponseImages = images
		this.deps.taskState.askResponseFiles = files
	}

	async updateSwarmState(metadata: OrchestrationEventMetadata) {
		if (!this.deps.taskState.swarmState) {
			this.deps.taskState.swarmState = {
				activeWorkers: [],
				overallProgress: 0,
				totalTasks: 0,
				completedTasks: 0,
				isExecuting: false,
			}
		}

		const state = this.deps.taskState.swarmState

		switch (metadata.type) {
			case "wave_start":
				state.isExecuting = true
				state.currentWaveId = metadata.event.split(" ")[1]
				if (metadata.totalTasks) {
					state.totalTasks = metadata.totalTasks
					state.completedTasks = 0
					state.overallProgress = 0
				}
				break
			case "wave_complete":
				state.isExecuting = false
				state.currentWaveId = undefined
				break
			case "worker_start": {
				const workerId = metadata.taskId || metadata.event.split(" ")[1]
				if (!state.activeWorkers.find((w) => w.id === workerId)) {
					state.activeWorkers.push({
						id: workerId,
						name: metadata.workerName || "Worker",
						description: metadata.details || "",
						status: "acting",
					})
				}
				break
			}
			case "worker_complete": {
				const workerId = metadata.taskId || metadata.event.split(" ")[1]
				state.activeWorkers = state.activeWorkers.filter((w) => w.id !== workerId)
				state.completedTasks++
				if (state.totalTasks > 0) {
					state.overallProgress = (state.completedTasks / state.totalTasks) * 100
				}
				break
			}
		}
	}
}
