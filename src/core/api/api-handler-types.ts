import { ApiConfiguration, ModelInfo } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import { CodemarieTool } from "@/shared/tools"
import { ApiStream, ApiStreamUsageChunk } from "./transform/stream"

export type CommonApiHandlerOptions = {
	onRetryAttempt?: ApiConfiguration["onRetryAttempt"]
}

export interface ApiHandler {
	createMessage(
		systemPrompt: string,
		messages: CodemarieStorageMessage[],
		tools?: CodemarieTool[],
		useResponseApi?: boolean,
	): ApiStream
	getModel(): ApiHandlerModel
	getApiStreamUsage?(): Promise<ApiStreamUsageChunk | undefined>
	abort?(): void
	embedText?(text: string): Promise<number[] | null>
	embedBatch?(texts: string[]): Promise<(number[] | null)[]>
}

export interface ApiHandlerModel {
	id: string
	info: ModelInfo
}

export interface ApiProviderInfo {
	providerId: string
	model: ApiHandlerModel
	mode: Mode
	customPrompt?: string // "compact"
}

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}
