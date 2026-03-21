import { ApiProvider as ProtoApiProvider } from "@shared/proto/codemarie/common"
import {
	LiteLLMModelInfo,
	ModelsApiOptions,
	ModelsApiSecrets,
	OpenAiCompatibleModelInfo,
	OpenRouterModelInfo,
	ApiConfiguration as ProtoApiConfiguration,
	OcaModelInfo as ProtoOcaModelInfo,
	ThinkingConfig,
} from "@shared/proto/codemarie/system"
import {
	ApiConfiguration,
	ApiProvider,
	LiteLLMModelInfo as AppLiteLLMModelInfo,
	OpenAiCompatibleModelInfo as AppOpenAiCompatibleModelInfo,
	BedrockModelId,
	ModelInfo,
	OcaModelInfo,
} from "../../api"
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

// Convert application ModelInfo to proto OcaModelInfo
function convertOcaModelInfoToProtoOcaModelInfo(info: OcaModelInfo | undefined): ProtoOcaModelInfo | undefined {
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
		surveyContent: info.surveyContent,
		surveyId: info.surveyId,
		banner: info.banner,
		modelName: info.modelName,
		apiFormat: info.apiFormat,
		supportsReasoning: info.supportsReasoning,
		reasoningEffortOptions: info.reasoningEffortOptions,
	}
}

// Convert proto OpenRouterModelInfo to application ModelInfo
function convertProtoOcaModelInfoToOcaModelInfo(info: ProtoOcaModelInfo | undefined): OcaModelInfo | undefined {
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
		surveyContent: info.surveyContent,
		surveyId: info.surveyId,
		banner: info.banner,
		modelName: info.modelName,
		apiFormat: info.apiFormat,
		supportsReasoning: info.supportsReasoning,
		reasoningEffortOptions: info.reasoningEffortOptions,
	}
}

// Convert application LiteLLMModelInfo to proto LiteLLMModelInfo
function convertLiteLLMModelInfoToProto(info: AppLiteLLMModelInfo | undefined): LiteLLMModelInfo | undefined {
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
		supportsReasoning: info.supportsReasoning,
	}
}

// Convert proto LiteLLMModelInfo to application LiteLLMModelInfo
function convertProtoToLiteLLMModelInfo(info: LiteLLMModelInfo | undefined): AppLiteLLMModelInfo | undefined {
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
		supportsReasoning: info.supportsReasoning,
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
		case "bedrock":
			return ProtoApiProvider.BEDROCK
		case "vertex":
			return ProtoApiProvider.VERTEX
		case "openai":
			return ProtoApiProvider.OPENAI
		case "ollama":
			return ProtoApiProvider.OLLAMA
		case "lmstudio":
			return ProtoApiProvider.LMSTUDIO
		case "gemini":
			return ProtoApiProvider.GEMINI
		case "openai-native":
			return ProtoApiProvider.OPENAI_NATIVE
		case "together":
			return ProtoApiProvider.TOGETHER
		case "deepseek":
			return ProtoApiProvider.DEEPSEEK
		case "qwen":
			return ProtoApiProvider.QWEN
		case "qwen-code":
			return ProtoApiProvider.QWEN_CODE
		case "doubao":
			return ProtoApiProvider.DOUBAO
		case "mistral":
			return ProtoApiProvider.MISTRAL
		case "vscode-lm":
			return ProtoApiProvider.VSCODE_LM
		case "litellm":
			return ProtoApiProvider.LITELLM
		case "moonshot":
			return ProtoApiProvider.MOONSHOT
		case "nebius":
			return ProtoApiProvider.NEBIUS
		case "fireworks":
			return ProtoApiProvider.FIREWORKS
		case "asksage":
			return ProtoApiProvider.ASKSAGE
		case "xai":
			return ProtoApiProvider.XAI
		case "sambanova":
			return ProtoApiProvider.SAMBANOVA
		case "cerebras":
			return ProtoApiProvider.CEREBRAS
		case "groq":
			return ProtoApiProvider.GROQ
		case "baseten":
			return ProtoApiProvider.BASETEN
		case "sapaicore":
			return ProtoApiProvider.SAPAICORE
		case "claude-code":
			return ProtoApiProvider.CLAUDE_CODE
		case "huawei-cloud-maas":
			return ProtoApiProvider.HUAWEI_CLOUD_MAAS
		case "vercel-ai-gateway":
			return ProtoApiProvider.VERCEL_AI_GATEWAY
		case "zai":
			return ProtoApiProvider.ZAI
		case "dify":
			return ProtoApiProvider.DIFY
		case "oca":
			return ProtoApiProvider.OCA
		case "minimax":
			return ProtoApiProvider.MINIMAX
		case "hicap":
			return ProtoApiProvider.HICAP
		case "nousResearch":
			return ProtoApiProvider.NOUSRESEARCH
		case "openai-codex":
			return ProtoApiProvider.OPENAI_CODEX
		case "cloudflare":
			return ProtoApiProvider.CLOUDFLARE
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
		case ProtoApiProvider.BEDROCK:
			return "bedrock"
		case ProtoApiProvider.VERTEX:
			return "vertex"
		case ProtoApiProvider.OPENAI:
			return "openai"
		case ProtoApiProvider.OLLAMA:
			return "ollama"
		case ProtoApiProvider.LMSTUDIO:
			return "lmstudio"
		case ProtoApiProvider.GEMINI:
			return "gemini"
		case ProtoApiProvider.OPENAI_NATIVE:
			return "openai-native"
		case ProtoApiProvider.TOGETHER:
			return "together"
		case ProtoApiProvider.DEEPSEEK:
			return "deepseek"
		case ProtoApiProvider.QWEN:
			return "qwen"
		case ProtoApiProvider.QWEN_CODE:
			return "qwen-code"
		case ProtoApiProvider.DOUBAO:
			return "doubao"
		case ProtoApiProvider.MISTRAL:
			return "mistral"
		case ProtoApiProvider.VSCODE_LM:
			return "vscode-lm"
		case ProtoApiProvider.LITELLM:
			return "litellm"
		case ProtoApiProvider.MOONSHOT:
			return "moonshot"
		case ProtoApiProvider.NEBIUS:
			return "nebius"
		case ProtoApiProvider.FIREWORKS:
			return "fireworks"
		case ProtoApiProvider.ASKSAGE:
			return "asksage"
		case ProtoApiProvider.XAI:
			return "xai"
		case ProtoApiProvider.SAMBANOVA:
			return "sambanova"
		case ProtoApiProvider.CEREBRAS:
			return "cerebras"
		case ProtoApiProvider.GROQ:
			return "groq"
		case ProtoApiProvider.BASETEN:
			return "baseten"
		case ProtoApiProvider.SAPAICORE:
			return "sapaicore"
		case ProtoApiProvider.CLAUDE_CODE:
			return "claude-code"
		case ProtoApiProvider.HUAWEI_CLOUD_MAAS:
			return "huawei-cloud-maas"
		case ProtoApiProvider.VERCEL_AI_GATEWAY:
			return "vercel-ai-gateway"
		case ProtoApiProvider.ZAI:
			return "zai"
		case ProtoApiProvider.HICAP:
			return "hicap"
		case ProtoApiProvider.DIFY:
			return "dify"
		case ProtoApiProvider.OCA:
			return "oca"
		case ProtoApiProvider.MINIMAX:
			return "minimax"
		case ProtoApiProvider.NOUSRESEARCH:
			return "nousResearch"
		case ProtoApiProvider.OPENAI_CODEX:
			return "openai-codex"
		case ProtoApiProvider.CLOUDFLARE:
			return "cloudflare"
		default:
			return "anthropic"
	}
}

// Converts application ApiConfiguration to proto ApiConfiguration
export function convertApiConfigurationToProto(config: ApiConfiguration): ProtoApiConfiguration {
	return {
		options: {
			ulid: config.ulid,
			liteLlmBaseUrl: config.liteLlmBaseUrl,
			liteLlmUsePromptCache: config.liteLlmUsePromptCache,
			openAiHeaders: config.openAiHeaders || {},
			anthropicBaseUrl: config.anthropicBaseUrl,
			openRouterProviderSorting: config.openRouterProviderSorting,
			awsRegion: config.awsRegion,
			awsUseCrossRegionInference: config.awsUseCrossRegionInference,
			awsUseGlobalInference: config.awsUseGlobalInference,
			awsBedrockUsePromptCache: config.awsBedrockUsePromptCache,
			awsUseProfile: config.awsUseProfile,
			awsAuthentication: config.awsAuthentication,
			awsProfile: config.awsProfile,
			awsBedrockEndpoint: config.awsBedrockEndpoint,
			claudeCodePath: config.claudeCodePath,
			openAiBaseUrl: config.openAiBaseUrl,
			ollamaBaseUrl: config.ollamaBaseUrl,
			ollamaApiOptionsCtxNum: config.ollamaApiOptionsCtxNum,
			lmStudioBaseUrl: config.lmStudioBaseUrl,
			lmStudioMaxTokens: config.lmStudioMaxTokens,
			geminiBaseUrl: config.geminiBaseUrl,
			fireworksModelMaxCompletionTokens: config.fireworksModelMaxCompletionTokens,
			fireworksModelMaxTokens: config.fireworksModelMaxTokens,
			qwenCodeOauthPath: config.qwenCodeOauthPath,
			azureApiVersion: config.azureApiVersion,
			azureIdentity: config.azureIdentity,
			qwenApiLine: config.qwenApiLine,
			moonshotApiLine: config.moonshotApiLine,
			asksageApiUrl: config.asksageApiUrl,
			requestTimeoutMs: config.requestTimeoutMs,
			sapAiResourceGroup: config.sapAiResourceGroup,
			sapAiCoreTokenUrl: config.sapAiCoreTokenUrl,
			sapAiCoreBaseUrl: config.sapAiCoreBaseUrl,
			sapAiCoreUseOrchestrationMode: config.sapAiCoreUseOrchestrationMode,
			zaiApiLine: config.zaiApiLine,
			difyBaseUrl: config.difyBaseUrl,
			ocaBaseUrl: config.ocaBaseUrl,
			ocaMode: config.ocaMode,
			minimaxApiLine: config.minimaxApiLine,
			hicapModelId: config.hicapModelId,
			embeddingProvider: config.embeddingProvider ? convertApiProviderToProto(config.embeddingProvider) : undefined,
			embeddingModelId: config.embeddingModelId,
			embeddingOpenAiBaseUrl: config.embeddingOpenAiBaseUrl,
			cloudflareAccountId: config.cloudflareAccountId,

			// Plan mode configurations
			planModeApiProvider: config.planModeApiProvider ? convertApiProviderToProto(config.planModeApiProvider) : undefined,
			planModeApiModelId: config.planModeApiModelId,
			planModeThinkingBudgetTokens: config.planModeThinkingBudgetTokens,
			geminiPlanModeThinkingLevel: config.geminiPlanModeThinkingLevel,
			planModeReasoningEffort: config.planModeReasoningEffort,
			planModeVsCodeLmModelSelector: config.planModeVsCodeLmModelSelector,
			planModeAwsBedrockCustomSelected: config.planModeAwsBedrockCustomSelected,
			planModeAwsBedrockCustomModelBaseId: config.planModeAwsBedrockCustomModelBaseId as string | undefined,
			planModeOpenRouterModelId: config.planModeOpenRouterModelId,
			planModeOpenRouterModelInfo: convertModelInfoToProtoOpenRouter(config.planModeOpenRouterModelInfo),
			planModeOpenAiModelId: config.planModeOpenAiModelId,
			planModeOpenAiModelInfo: convertOpenAiCompatibleModelInfoToProto(config.planModeOpenAiModelInfo),
			planModeOllamaModelId: config.planModeOllamaModelId,
			planModeLmStudioModelId: config.planModeLmStudioModelId,
			planModeLiteLlmModelId: config.planModeLiteLlmModelId,
			planModeLiteLlmModelInfo: convertLiteLLMModelInfoToProto(config.planModeLiteLlmModelInfo),
			planModeTogetherModelId: config.planModeTogetherModelId,
			planModeFireworksModelId: config.planModeFireworksModelId,
			planModeGroqModelId: config.planModeGroqModelId,
			planModeGroqModelInfo: convertModelInfoToProtoOpenRouter(config.planModeGroqModelInfo),
			planModeBasetenModelId: config.planModeBasetenModelId,
			planModeBasetenModelInfo: convertModelInfoToProtoOpenRouter(config.planModeBasetenModelInfo),
			planModeSapAiCoreModelId: config.planModeSapAiCoreModelId,
			planModeHuaweiCloudMaasModelId: config.planModeHuaweiCloudMaasModelId,
			planModeHuaweiCloudMaasModelInfo: convertModelInfoToProtoOpenRouter(config.planModeHuaweiCloudMaasModelInfo),
			planModeSapAiCoreDeploymentId: config.planModeSapAiCoreDeploymentId,
			planModeOcaModelId: config.planModeOcaModelId,
			planModeOcaModelInfo: convertOcaModelInfoToProtoOcaModelInfo(config.planModeOcaModelInfo),
			planModeOcaReasoningEffort: config.planModeOcaReasoningEffort,
			planModeHicapModelId: config.planModeHicapModelId,
			planModeHicapModelInfo: convertModelInfoToProtoOpenRouter(config.planModeHicapModelInfo),
			planModeNousResearchModelId: config.planModeNousResearchModelId,
			planModeVercelAiGatewayModelId: config.planModeVercelAiGatewayModelId,
			planModeVercelAiGatewayModelInfo: convertModelInfoToProtoOpenRouter(config.planModeVercelAiGatewayModelInfo),

			// Act mode configurations
			actModeApiProvider: config.actModeApiProvider ? convertApiProviderToProto(config.actModeApiProvider) : undefined,
			actModeApiModelId: config.actModeApiModelId,
			actModeThinkingBudgetTokens: config.actModeThinkingBudgetTokens,
			geminiActModeThinkingLevel: config.geminiActModeThinkingLevel,
			actModeReasoningEffort: config.actModeReasoningEffort,
			actModeVsCodeLmModelSelector: config.actModeVsCodeLmModelSelector,
			actModeAwsBedrockCustomSelected: config.actModeAwsBedrockCustomSelected,
			actModeAwsBedrockCustomModelBaseId: config.actModeAwsBedrockCustomModelBaseId as string | undefined,
			actModeOpenRouterModelId: config.actModeOpenRouterModelId,
			actModeOpenRouterModelInfo: convertModelInfoToProtoOpenRouter(config.actModeOpenRouterModelInfo),
			actModeOpenAiModelId: config.actModeOpenAiModelId,
			actModeOpenAiModelInfo: convertOpenAiCompatibleModelInfoToProto(config.actModeOpenAiModelInfo),
			actModeOllamaModelId: config.actModeOllamaModelId,
			actModeLmStudioModelId: config.actModeLmStudioModelId,
			actModeLiteLlmModelId: config.actModeLiteLlmModelId,
			actModeLiteLlmModelInfo: convertLiteLLMModelInfoToProto(config.actModeLiteLlmModelInfo),
			actModeTogetherModelId: config.actModeTogetherModelId,
			actModeFireworksModelId: config.actModeFireworksModelId,
			actModeGroqModelId: config.actModeGroqModelId,
			actModeGroqModelInfo: convertModelInfoToProtoOpenRouter(config.actModeGroqModelInfo),
			actModeBasetenModelId: config.actModeBasetenModelId,
			actModeBasetenModelInfo: convertModelInfoToProtoOpenRouter(config.actModeBasetenModelInfo),
			actModeSapAiCoreModelId: config.actModeSapAiCoreModelId,
			actModeHuaweiCloudMaasModelId: config.actModeHuaweiCloudMaasModelId,
			actModeHuaweiCloudMaasModelInfo: convertModelInfoToProtoOpenRouter(config.actModeHuaweiCloudMaasModelInfo),
			actModeSapAiCoreDeploymentId: config.actModeSapAiCoreDeploymentId,
			actModeOcaModelId: config.actModeOcaModelId,
			actModeOcaModelInfo: convertOcaModelInfoToProtoOcaModelInfo(config.actModeOcaModelInfo),
			actModeOcaReasoningEffort: config.actModeOcaReasoningEffort,
			actModeHicapModelId: config.actModeHicapModelId,
			actModeHicapModelInfo: convertModelInfoToProtoOpenRouter(config.actModeHicapModelInfo),
			actModeNousResearchModelId: config.actModeNousResearchModelId,
			actModeVercelAiGatewayModelId: config.actModeVercelAiGatewayModelId,
			actModeVercelAiGatewayModelInfo: convertModelInfoToProtoOpenRouter(config.actModeVercelAiGatewayModelInfo),
		},
		secrets: {
			apiKey: config.apiKey,
			liteLlmApiKey: config.liteLlmApiKey,
			openRouterApiKey: config.openRouterApiKey,
			awsAccessKey: config.awsAccessKey,
			awsSecretKey: config.awsSecretKey,
			awsSessionToken: config.awsSessionToken,
			awsBedrockApiKey: config.awsBedrockApiKey,
			openAiApiKey: config.openAiApiKey,
			ollamaApiKey: config.ollamaApiKey,
			geminiApiKey: config.geminiApiKey,
			openAiNativeApiKey: config.openAiNativeApiKey,
			deepSeekApiKey: config.deepSeekApiKey,
			togetherApiKey: config.togetherApiKey,
			fireworksApiKey: config.fireworksApiKey,
			qwenApiKey: config.qwenApiKey,
			doubaoApiKey: config.doubaoApiKey,
			mistralApiKey: config.mistralApiKey,
			nebiusApiKey: config.nebiusApiKey,
			asksageApiKey: config.asksageApiKey,
			xaiApiKey: config.xaiApiKey,
			sambanovaApiKey: config.sambanovaApiKey,
			cerebrasApiKey: config.cerebrasApiKey,
			sapAiCoreClientId: config.sapAiCoreClientId,
			sapAiCoreClientSecret: config.sapAiCoreClientSecret,
			moonshotApiKey: config.moonshotApiKey,
			groqApiKey: config.groqApiKey,
			huaweiCloudMaasApiKey: config.huaweiCloudMaasApiKey,
			basetenApiKey: config.basetenApiKey,
			zaiApiKey: config.zaiApiKey,
			vercelAiGatewayApiKey: config.vercelAiGatewayApiKey,
			difyApiKey: config.difyApiKey,
			ocaApiKey: config.ocaApiKey,
			ocaRefreshToken: config.ocaRefreshToken,
			minimaxApiKey: config.minimaxApiKey,
			embeddingApiKey: config.embeddingApiKey,
			hicapApiKey: config.hicapApiKey,
			nousResearchApiKey: config.nousResearchApiKey,
			cloudflareApiToken: config.cloudflareApiToken,
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
		liteLlmBaseUrl: options.liteLlmBaseUrl,
		liteLlmApiKey: secrets.liteLlmApiKey,
		liteLlmUsePromptCache: options.liteLlmUsePromptCache,
		openAiHeaders: Object.keys(options.openAiHeaders || {}).length > 0 ? options.openAiHeaders : undefined,
		anthropicBaseUrl: options.anthropicBaseUrl,
		openRouterApiKey: secrets.openRouterApiKey,
		openRouterProviderSorting: options.openRouterProviderSorting,
		awsAccessKey: secrets.awsAccessKey,
		awsSecretKey: secrets.awsSecretKey,
		awsSessionToken: secrets.awsSessionToken,
		awsRegion: options.awsRegion,
		awsUseCrossRegionInference: options.awsUseCrossRegionInference,
		awsUseGlobalInference: options.awsUseGlobalInference,
		awsBedrockUsePromptCache: options.awsBedrockUsePromptCache,
		awsUseProfile: options.awsUseProfile,
		awsAuthentication: options.awsAuthentication,
		awsProfile: options.awsProfile,
		awsBedrockApiKey: secrets.awsBedrockApiKey,
		awsBedrockEndpoint: options.awsBedrockEndpoint,
		claudeCodePath: options.claudeCodePath,
		openAiBaseUrl: options.openAiBaseUrl,
		openAiApiKey: secrets.openAiApiKey,
		ollamaBaseUrl: options.ollamaBaseUrl,
		ollamaApiKey: secrets.ollamaApiKey,
		ollamaApiOptionsCtxNum: options.ollamaApiOptionsCtxNum,
		lmStudioBaseUrl: options.lmStudioBaseUrl,
		lmStudioMaxTokens: options.lmStudioMaxTokens,
		geminiApiKey: secrets.geminiApiKey,
		geminiBaseUrl: options.geminiBaseUrl,
		openAiNativeApiKey: secrets.openAiNativeApiKey,
		deepSeekApiKey: secrets.deepSeekApiKey,
		togetherApiKey: secrets.togetherApiKey,
		fireworksApiKey: secrets.fireworksApiKey,
		fireworksModelMaxCompletionTokens:
			options.fireworksModelMaxCompletionTokens !== undefined
				? Number(options.fireworksModelMaxCompletionTokens)
				: undefined,
		fireworksModelMaxTokens:
			options.fireworksModelMaxTokens !== undefined ? Number(options.fireworksModelMaxTokens) : undefined,
		qwenApiKey: secrets.qwenApiKey,
		qwenCodeOauthPath: options.qwenCodeOauthPath,
		doubaoApiKey: secrets.doubaoApiKey,
		mistralApiKey: secrets.mistralApiKey,
		azureApiVersion: options.azureApiVersion,
		azureIdentity: options.azureIdentity,
		qwenApiLine: options.qwenApiLine,
		moonshotApiLine: options.moonshotApiLine,
		moonshotApiKey: secrets.moonshotApiKey,
		nebiusApiKey: secrets.nebiusApiKey,
		asksageApiUrl: options.asksageApiUrl,
		asksageApiKey: secrets.asksageApiKey,
		xaiApiKey: secrets.xaiApiKey,
		sambanovaApiKey: secrets.sambanovaApiKey,
		cerebrasApiKey: secrets.cerebrasApiKey,
		vercelAiGatewayApiKey: secrets.vercelAiGatewayApiKey,
		groqApiKey: secrets.groqApiKey,
		basetenApiKey: secrets.basetenApiKey,
		requestTimeoutMs: options.requestTimeoutMs !== undefined ? Number(options.requestTimeoutMs) : undefined,
		sapAiCoreClientId: secrets.sapAiCoreClientId,
		sapAiCoreClientSecret: secrets.sapAiCoreClientSecret,
		sapAiResourceGroup: options.sapAiResourceGroup,
		sapAiCoreTokenUrl: options.sapAiCoreTokenUrl,
		sapAiCoreBaseUrl: options.sapAiCoreBaseUrl,
		sapAiCoreUseOrchestrationMode: options.sapAiCoreUseOrchestrationMode,
		huaweiCloudMaasApiKey: secrets.huaweiCloudMaasApiKey,
		zaiApiLine: options.zaiApiLine,
		zaiApiKey: secrets.zaiApiKey,
		difyApiKey: secrets.difyApiKey,
		difyBaseUrl: options.difyBaseUrl,
		ocaBaseUrl: options.ocaBaseUrl,
		ocaMode: options.ocaMode,
		minimaxApiKey: secrets.minimaxApiKey,
		minimaxApiLine: options.minimaxApiLine,
		hicapApiKey: secrets.hicapApiKey,
		hicapModelId: options.hicapModelId,
		nousResearchApiKey: secrets.nousResearchApiKey,
		embeddingProvider:
			options.embeddingProvider !== undefined ? convertProtoToApiProvider(options.embeddingProvider) : undefined,
		embeddingModelId: options.embeddingModelId,
		embeddingApiKey: secrets.embeddingApiKey,
		embeddingOpenAiBaseUrl: options.embeddingOpenAiBaseUrl,
		cloudflareAccountId: options.cloudflareAccountId,
		cloudflareApiToken: secrets.cloudflareApiToken,

		// Plan mode configurations
		planModeApiProvider:
			options.planModeApiProvider !== undefined ? convertProtoToApiProvider(options.planModeApiProvider) : undefined,
		planModeApiModelId: options.planModeApiModelId,
		planModeThinkingBudgetTokens:
			options.planModeThinkingBudgetTokens !== undefined ? Number(options.planModeThinkingBudgetTokens) : undefined,
		geminiPlanModeThinkingLevel: options.geminiPlanModeThinkingLevel,
		planModeReasoningEffort: options.planModeReasoningEffort as OpenaiReasoningEffort | undefined,
		planModeVsCodeLmModelSelector: options.planModeVsCodeLmModelSelector,
		planModeAwsBedrockCustomSelected: options.planModeAwsBedrockCustomSelected,
		planModeAwsBedrockCustomModelBaseId: options.planModeAwsBedrockCustomModelBaseId as BedrockModelId | undefined,
		planModeOpenRouterModelId: options.planModeOpenRouterModelId,
		planModeOpenRouterModelInfo: convertProtoToModelInfo(options.planModeOpenRouterModelInfo),
		planModeOpenAiModelId: options.planModeOpenAiModelId,
		planModeOpenAiModelInfo: convertProtoToOpenAiCompatibleModelInfo(options.planModeOpenAiModelInfo),
		planModeOllamaModelId: options.planModeOllamaModelId,
		planModeLmStudioModelId: options.planModeLmStudioModelId,
		planModeLiteLlmModelId: options.planModeLiteLlmModelId,
		planModeLiteLlmModelInfo: convertProtoToLiteLLMModelInfo(options.planModeLiteLlmModelInfo),
		planModeTogetherModelId: options.planModeTogetherModelId,
		planModeFireworksModelId: options.planModeFireworksModelId,
		planModeGroqModelId: options.planModeGroqModelId,
		planModeGroqModelInfo: convertProtoToModelInfo(options.planModeGroqModelInfo),
		planModeBasetenModelId: options.planModeBasetenModelId,
		planModeBasetenModelInfo: convertProtoToModelInfo(options.planModeBasetenModelInfo),
		planModeSapAiCoreModelId: options.planModeSapAiCoreModelId,
		planModeHuaweiCloudMaasModelId: options.planModeHuaweiCloudMaasModelId,
		planModeHuaweiCloudMaasModelInfo: convertProtoToModelInfo(options.planModeHuaweiCloudMaasModelInfo),
		planModeSapAiCoreDeploymentId: options.planModeSapAiCoreDeploymentId,
		planModeOcaModelId: options.planModeOcaModelId,
		planModeOcaModelInfo: convertProtoOcaModelInfoToOcaModelInfo(options.planModeOcaModelInfo),
		planModeOcaReasoningEffort: options.planModeOcaReasoningEffort,
		planModeHicapModelId: options.planModeHicapModelId,
		planModeHicapModelInfo: convertProtoToModelInfo(options.planModeHicapModelInfo),
		planModeNousResearchModelId: options.planModeNousResearchModelId,
		planModeVercelAiGatewayModelId: options.planModeVercelAiGatewayModelId,
		planModeVercelAiGatewayModelInfo: convertProtoToModelInfo(options.planModeVercelAiGatewayModelInfo),

		// Act mode configurations
		actModeApiProvider:
			options.actModeApiProvider !== undefined ? convertProtoToApiProvider(options.actModeApiProvider) : undefined,
		actModeApiModelId: options.actModeApiModelId,
		actModeThinkingBudgetTokens:
			options.actModeThinkingBudgetTokens !== undefined ? Number(options.actModeThinkingBudgetTokens) : undefined,
		geminiActModeThinkingLevel: options.geminiActModeThinkingLevel,
		actModeReasoningEffort: options.actModeReasoningEffort as OpenaiReasoningEffort | undefined,
		actModeVsCodeLmModelSelector: options.actModeVsCodeLmModelSelector,
		actModeAwsBedrockCustomSelected: options.actModeAwsBedrockCustomSelected,
		actModeAwsBedrockCustomModelBaseId: options.actModeAwsBedrockCustomModelBaseId as BedrockModelId | undefined,
		actModeOpenRouterModelId: options.actModeOpenRouterModelId,
		actModeOpenRouterModelInfo: convertProtoToModelInfo(options.actModeOpenRouterModelInfo),
		actModeOpenAiModelId: options.actModeOpenAiModelId,
		actModeOpenAiModelInfo: convertProtoToOpenAiCompatibleModelInfo(options.actModeOpenAiModelInfo),
		actModeOllamaModelId: options.actModeOllamaModelId,
		actModeLmStudioModelId: options.actModeLmStudioModelId,
		actModeLiteLlmModelId: options.actModeLiteLlmModelId,
		actModeLiteLlmModelInfo: convertProtoToLiteLLMModelInfo(options.actModeLiteLlmModelInfo),
		actModeTogetherModelId: options.actModeTogetherModelId,
		actModeFireworksModelId: options.actModeFireworksModelId,
		actModeGroqModelId: options.actModeGroqModelId,
		actModeGroqModelInfo: convertProtoToModelInfo(options.actModeGroqModelInfo),
		actModeBasetenModelId: options.actModeBasetenModelId,
		actModeBasetenModelInfo: convertProtoToModelInfo(options.actModeBasetenModelInfo),
		actModeSapAiCoreModelId: options.actModeSapAiCoreModelId,
		actModeHuaweiCloudMaasModelId: options.actModeHuaweiCloudMaasModelId,
		actModeHuaweiCloudMaasModelInfo: convertProtoToModelInfo(options.actModeHuaweiCloudMaasModelInfo),
		actModeSapAiCoreDeploymentId: options.actModeSapAiCoreDeploymentId,
		actModeOcaModelId: options.actModeOcaModelId,
		actModeOcaModelInfo: convertProtoOcaModelInfoToOcaModelInfo(options.actModeOcaModelInfo),
		actModeOcaReasoningEffort: options.actModeOcaReasoningEffort,
		actModeHicapModelId: options.actModeHicapModelId,
		actModeHicapModelInfo: convertProtoToModelInfo(options.actModeHicapModelInfo),
		actModeNousResearchModelId: options.actModeNousResearchModelId,
		actModeVercelAiGatewayModelId: options.actModeVercelAiGatewayModelId,
		actModeVercelAiGatewayModelInfo: convertProtoToModelInfo(options.actModeVercelAiGatewayModelInfo),
	}
}
