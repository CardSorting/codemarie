import { ApiProvider as ProtoApiProvider } from "@shared/proto/codemarie/common"
import {
	ModelsApiOptions,
	ModelsApiSecrets,
	OpenAiCompatibleModelInfo,
	OpenRouterModelInfo,
	ApiConfiguration as ProtoApiConfiguration,
	ThinkingConfig,
} from "@shared/proto/codemarie/system"
import { ApiConfiguration, ApiProvider, OpenAiCompatibleModelInfo as AppOpenAiCompatibleModelInfo, ModelInfo } from "../../api"
import { OpenaiReasoningEffort } from "../../storage/types"

// Convert application ThinkingConfig to proto ThinkingConfig
function convertThinkingConfigToProto(config: ModelInfo["thinkingConfig"]): ThinkingConfig | undefined {
	if (!config) {
		return undefined
	}

	return {
		maxBudget: config.maxBudget,
		outputPrice: config.outputPrice,
		outputPriceTiers: config.outputPriceTiers || [], // Provide empty array if undefined
	}
}

// Convert proto ThinkingConfig to application ThinkingConfig
function convertProtoToThinkingConfig(config: ThinkingConfig | undefined): ModelInfo["thinkingConfig"] | undefined {
	if (!config) {
		return undefined
	}

	return {
		maxBudget: config.maxBudget,
		outputPrice: config.outputPrice,
		outputPriceTiers: config.outputPriceTiers.length > 0 ? config.outputPriceTiers : undefined,
	}
}

// Convert application ModelInfo to proto OpenRouterModelInfo
function convertModelInfoToProtoOpenRouter(info: ModelInfo | undefined): OpenRouterModelInfo | undefined {
	if (!info) {
		return undefined
	}

	return {
		maxTokens: info.maxTokens,
		contextWindow: info.contextWindow,
		supportsImages: info.supportsImages,
		supportsPromptCache: info.supportsPromptCache ?? false,
		inputPrice: info.inputPrice,
		outputPrice: info.outputPrice,
		cacheWritesPrice: info.cacheWritesPrice,
		cacheReadsPrice: info.cacheReadsPrice,
		description: info.description,
		thinkingConfig: convertThinkingConfigToProto(info.thinkingConfig),
		supportsGlobalEndpoint: info.supportsGlobalEndpoint,
		tiers: info.tiers || [],
	}
}

// Convert proto OpenRouterModelInfo to application ModelInfo
function convertProtoToModelInfo(info: OpenRouterModelInfo | undefined): ModelInfo | undefined {
	if (!info) {
		return undefined
	}

	return {
		maxTokens: info.maxTokens,
		contextWindow: info.contextWindow,
		supportsImages: info.supportsImages,
		supportsPromptCache: info.supportsPromptCache,
		inputPrice: info.inputPrice,
		outputPrice: info.outputPrice,
		cacheWritesPrice: info.cacheWritesPrice,
		cacheReadsPrice: info.cacheReadsPrice,
		description: info.description,
		thinkingConfig: convertProtoToThinkingConfig(info.thinkingConfig),
		supportsGlobalEndpoint: info.supportsGlobalEndpoint,
		tiers: info.tiers.length > 0 ? info.tiers : undefined,
	}
}

// Convert application OpenAiCompatibleModelInfo to proto OpenAiCompatibleModelInfo
function convertOpenAiCompatibleModelInfoToProto(
	info: AppOpenAiCompatibleModelInfo | undefined,
): OpenAiCompatibleModelInfo | undefined {
	if (!info) {
		return undefined
	}

	return {
		maxTokens: info.maxTokens,
		contextWindow: info.contextWindow,
		supportsImages: info.supportsImages,
		supportsPromptCache: info.supportsPromptCache ?? false,
		inputPrice: info.inputPrice,
		outputPrice: info.outputPrice,
		thinkingConfig: convertThinkingConfigToProto(info.thinkingConfig),
		supportsGlobalEndpoint: info.supportsGlobalEndpoint,
		cacheWritesPrice: info.cacheWritesPrice,
		cacheReadsPrice: info.cacheReadsPrice,
		description: info.description,
		tiers: info.tiers || [],
		temperature: info.temperature,
		isR1FormatRequired: info.isR1FormatRequired,
	}
}

// Convert proto OpenAiCompatibleModelInfo to application OpenAiCompatibleModelInfo
function convertProtoToOpenAiCompatibleModelInfo(
	info: OpenAiCompatibleModelInfo | undefined,
): AppOpenAiCompatibleModelInfo | undefined {
	if (!info) {
		return undefined
	}

	return {
		maxTokens: info.maxTokens,
		contextWindow: info.contextWindow,
		supportsImages: info.supportsImages,
		supportsPromptCache: info.supportsPromptCache,
		inputPrice: info.inputPrice,
		outputPrice: info.outputPrice,
		thinkingConfig: convertProtoToThinkingConfig(info.thinkingConfig),
		supportsGlobalEndpoint: info.supportsGlobalEndpoint,
		cacheWritesPrice: info.cacheWritesPrice,
		cacheReadsPrice: info.cacheReadsPrice,
		description: info.description,
		tiers: info.tiers.length > 0 ? info.tiers : undefined,
		temperature: info.temperature,
		isR1FormatRequired: info.isR1FormatRequired,
	}
}

// Convert application ApiProvider to proto ApiProvider
function convertApiProviderToProto(provider: string | undefined): ProtoApiProvider {
	switch (provider) {
		case "anthropic":
			return ProtoApiProvider.ANTHROPIC
		case "openrouter":
			return ProtoApiProvider.OPENROUTER
		case "openai":
			return ProtoApiProvider.OPENAI
		case "gemini":
			return ProtoApiProvider.GEMINI
		case "openai-native":
			return ProtoApiProvider.OPENAI_NATIVE
		case "claude-code":
			return ProtoApiProvider.CLAUDE_CODE
		case "nousResearch":
			return ProtoApiProvider.NOUSRESEARCH
		case "openai-codex":
			return ProtoApiProvider.OPENAI_CODEX
		default:
			return ProtoApiProvider.ANTHROPIC
	}
}

// Convert proto ApiProvider to application ApiProvider
export function convertProtoToApiProvider(provider: ProtoApiProvider): ApiProvider {
	switch (provider) {
		case ProtoApiProvider.ANTHROPIC:
			return "anthropic"
		case ProtoApiProvider.OPENROUTER:
			return "openrouter"
		case ProtoApiProvider.OPENAI:
			return "openai"
		case ProtoApiProvider.GEMINI:
			return "gemini"
		case ProtoApiProvider.OPENAI_NATIVE:
			return "openai-native"
		case ProtoApiProvider.CLAUDE_CODE:
			return "claude-code"
		case ProtoApiProvider.NOUSRESEARCH:
			return "nousResearch"
		case ProtoApiProvider.OPENAI_CODEX:
			return "openai-codex"
		default:
			return "anthropic"
	}
}

// Converts application ApiConfiguration to proto ApiConfiguration
export function convertApiConfigurationToProto(config: ApiConfiguration): ProtoApiConfiguration {
	return {
		options: {
			ulid: config.ulid,
			openAiHeaders: config.openAiHeaders || {},
			anthropicBaseUrl: config.anthropicBaseUrl,
			openRouterProviderSorting: config.openRouterProviderSorting,
			claudeCodePath: config.claudeCodePath,
			openAiBaseUrl: config.openAiBaseUrl,
			geminiBaseUrl: config.geminiBaseUrl,
			requestTimeoutMs: config.requestTimeoutMs,

			// Plan mode configurations
			planModeApiProvider: config.planModeApiProvider ? convertApiProviderToProto(config.planModeApiProvider) : undefined,
			planModeApiModelId: config.planModeApiModelId,
			planModeThinkingBudgetTokens: config.planModeThinkingBudgetTokens,
			geminiPlanModeThinkingLevel: config.geminiPlanModeThinkingLevel,
			planModeReasoningEffort: config.planModeReasoningEffort,
			planModeOpenRouterModelId: config.planModeOpenRouterModelId,
			planModeOpenRouterModelInfo: convertModelInfoToProtoOpenRouter(config.planModeOpenRouterModelInfo),
			planModeOpenAiModelId: config.planModeOpenAiModelId,
			planModeOpenAiModelInfo: convertOpenAiCompatibleModelInfoToProto(config.planModeOpenAiModelInfo),
			planModeNousResearchModelId: config.planModeNousResearchModelId,

			// Act mode configurations
			actModeApiProvider: config.actModeApiProvider ? convertApiProviderToProto(config.actModeApiProvider) : undefined,
			actModeApiModelId: config.actModeApiModelId,
			actModeThinkingBudgetTokens: config.actModeThinkingBudgetTokens,
			geminiActModeThinkingLevel: config.geminiActModeThinkingLevel,
			actModeReasoningEffort: config.actModeReasoningEffort,
			actModeOpenRouterModelId: config.actModeOpenRouterModelId,
			actModeOpenRouterModelInfo: convertModelInfoToProtoOpenRouter(config.actModeOpenRouterModelInfo),
			actModeOpenAiModelId: config.actModeOpenAiModelId,
			actModeOpenAiModelInfo: convertOpenAiCompatibleModelInfoToProto(config.actModeOpenAiModelInfo),
			actModeNousResearchModelId: config.actModeNousResearchModelId,
		},
		secrets: {
			apiKey: config.apiKey,
			openRouterApiKey: config.openRouterApiKey,
			openAiApiKey: config.openAiApiKey,
			geminiApiKey: config.geminiApiKey,
			openAiNativeApiKey: config.openAiNativeApiKey,
			nousResearchApiKey: config.nousResearchApiKey,
		},
	}
}

// Converts proto ApiConfiguration to application ApiConfiguration
export function convertProtoToApiConfiguration(protoConfig: ProtoApiConfiguration): ApiConfiguration {
	const options = protoConfig.options || ({} as ModelsApiOptions)
	const secrets = protoConfig.secrets || ({} as ModelsApiSecrets)
	return {
		// Global configuration fields
		apiKey: secrets.apiKey,
		ulid: options.ulid,
		openAiHeaders: Object.keys(options.openAiHeaders || {}).length > 0 ? options.openAiHeaders : undefined,
		anthropicBaseUrl: options.anthropicBaseUrl,
		openRouterApiKey: secrets.openRouterApiKey,
		openRouterProviderSorting: options.openRouterProviderSorting,
		claudeCodePath: options.claudeCodePath,
		openAiBaseUrl: options.openAiBaseUrl,
		openAiApiKey: secrets.openAiApiKey,
		geminiApiKey: secrets.geminiApiKey,
		geminiBaseUrl: options.geminiBaseUrl,
		openAiNativeApiKey: secrets.openAiNativeApiKey,
		requestTimeoutMs: options.requestTimeoutMs !== undefined ? Number(options.requestTimeoutMs) : undefined,
		nousResearchApiKey: secrets.nousResearchApiKey,

		// Plan mode configurations
		planModeApiProvider:
			options.planModeApiProvider !== undefined ? convertProtoToApiProvider(options.planModeApiProvider) : undefined,
		planModeApiModelId: options.planModeApiModelId,
		planModeThinkingBudgetTokens:
			options.planModeThinkingBudgetTokens !== undefined ? Number(options.planModeThinkingBudgetTokens) : undefined,
		geminiPlanModeThinkingLevel: options.geminiPlanModeThinkingLevel,
		planModeReasoningEffort: options.planModeReasoningEffort as OpenaiReasoningEffort | undefined,
		planModeOpenRouterModelId: options.planModeOpenRouterModelId,
		planModeOpenRouterModelInfo: convertProtoToModelInfo(options.planModeOpenRouterModelInfo),
		planModeOpenAiModelId: options.planModeOpenAiModelId,
		planModeOpenAiModelInfo: convertProtoToOpenAiCompatibleModelInfo(options.planModeOpenAiModelInfo),
		planModeNousResearchModelId: options.planModeNousResearchModelId,

		// Act mode configurations
		actModeApiProvider:
			options.actModeApiProvider !== undefined ? convertProtoToApiProvider(options.actModeApiProvider) : undefined,
		actModeApiModelId: options.actModeApiModelId,
		actModeThinkingBudgetTokens:
			options.actModeThinkingBudgetTokens !== undefined ? Number(options.actModeThinkingBudgetTokens) : undefined,
		geminiActModeThinkingLevel: options.geminiActModeThinkingLevel,
		actModeReasoningEffort: options.actModeReasoningEffort as OpenaiReasoningEffort | undefined,
		actModeOpenRouterModelId: options.actModeOpenRouterModelId,
		actModeOpenRouterModelInfo: convertProtoToModelInfo(options.actModeOpenRouterModelInfo),
		actModeOpenAiModelId: options.actModeOpenAiModelId,
		actModeOpenAiModelInfo: convertProtoToOpenAiCompatibleModelInfo(options.actModeOpenAiModelInfo),
		actModeNousResearchModelId: options.actModeNousResearchModelId,
	}
}
