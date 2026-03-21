import {
	ApiConfiguration,
	ApiProvider,
	anthropicDefaultModelId,
	anthropicModels,
	claudeCodeDefaultModelId,
	claudeCodeModels,
	geminiDefaultModelId,
	geminiModels,
	ModelInfo,
	nousResearchDefaultModelId,
	nousResearchModels,
	openAiCodexDefaultModelId,
	openAiCodexModels,
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
} from "@shared/api"
import { Mode } from "@shared/storage/types"
import * as reasoningSupport from "@shared/utils/reasoning-support"

export function supportsReasoningEffortForModelId(modelId?: string, _allowShortOpenAiIds = false): boolean {
	return reasoningSupport.supportsReasoningEffortForModel(modelId)
}

/**
 * Returns the static model list for a provider.
 * For providers with dynamic models (openrouter, ollama, etc.), returns undefined.
 * Some providers depend on configuration (qwen, zai) for region-specific models.
 */
export function getModelsForProvider(
	provider: ApiProvider,
	apiConfiguration?: ApiConfiguration,
): Record<string, ModelInfo> | undefined {
	switch (provider) {
		case "anthropic":
			return anthropicModels
		case "claude-code":
			return claudeCodeModels
		case "gemini":
			return geminiModels
		case "openai-native":
			return openAiNativeModels
		case "openai-codex":
			return openAiCodexModels
		case "nousResearch":
			return nousResearchModels
		default:
			return undefined
	}
}

/**
 * Interface for normalized API configuration
 */
export interface NormalizedApiConfig {
	selectedProvider: ApiProvider
	selectedModelId: string
	selectedModelInfo: ModelInfo
}

/**
 * Normalizes API configuration to ensure consistent values
 */
export function normalizeApiConfiguration(
	apiConfiguration: ApiConfiguration | undefined,
	currentMode: Mode,
): NormalizedApiConfig {
	const provider =
		(currentMode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider) || "anthropic"

	const modelId = currentMode === "plan" ? apiConfiguration?.planModeApiModelId : apiConfiguration?.actModeApiModelId

	const getProviderData = (models: Record<string, ModelInfo>, defaultId: string) => {
		let selectedModelId: string
		let selectedModelInfo: ModelInfo
		if (modelId && modelId in models) {
			selectedModelId = modelId
			selectedModelInfo = models[modelId]
		} else {
			selectedModelId = defaultId
			selectedModelInfo = models[defaultId]
		}
		return {
			selectedProvider: provider,
			selectedModelId,
			selectedModelInfo,
		}
	}

	switch (provider) {
		case "anthropic":
			return getProviderData(anthropicModels, anthropicDefaultModelId)
		case "claude-code":
			return getProviderData(claudeCodeModels, claudeCodeDefaultModelId)
		case "gemini":
			return getProviderData(geminiModels, geminiDefaultModelId)
		case "openai-native":
			return getProviderData(openAiNativeModels, openAiNativeDefaultModelId)
		case "openai-codex":
			return getProviderData(openAiCodexModels, openAiCodexDefaultModelId)
		case "openrouter":
			const openRouterModelId =
				currentMode === "plan" ? apiConfiguration?.planModeOpenRouterModelId : apiConfiguration?.actModeOpenRouterModelId
			const openRouterModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeOpenRouterModelInfo
					: apiConfiguration?.actModeOpenRouterModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: openRouterModelId || openRouterDefaultModelId,
				selectedModelInfo: openRouterModelInfo || openRouterDefaultModelInfo,
			}
		case "openai":
			const openAiModelId =
				currentMode === "plan" ? apiConfiguration?.planModeOpenAiModelId : apiConfiguration?.actModeOpenAiModelId
			const openAiModelInfo =
				currentMode === "plan" ? apiConfiguration?.planModeOpenAiModelInfo : apiConfiguration?.actModeOpenAiModelInfo
			return {
				selectedProvider: provider,
				selectedModelId: openAiModelId || "",
				selectedModelInfo: openAiModelInfo || openAiModelInfoSaneDefaults,
			}
		case "nousResearch":
			const nousResearchModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeNousResearchModelId
					: apiConfiguration?.actModeNousResearchModelId
			return {
				selectedProvider: provider,
				selectedModelId: nousResearchModelId || nousResearchDefaultModelId,
				selectedModelInfo:
					nousResearchModelId && nousResearchModelId in nousResearchModels
						? nousResearchModels[nousResearchModelId as keyof typeof nousResearchModels]
						: nousResearchModels[nousResearchDefaultModelId],
			}
		default:
			return getProviderData(anthropicModels, anthropicDefaultModelId)
	}
}

/**
 * Gets mode-specific field values from API configuration
 * @param apiConfiguration The API configuration object
 * @param mode The current mode ("plan" or "act")
 * @returns Object containing mode-specific field values for clean destructuring
 */
export function getModeSpecificFields(apiConfiguration: ApiConfiguration | undefined, mode: Mode) {
	if (!apiConfiguration) {
		return {
			// Core fields
			apiProvider: undefined,
			apiModelId: undefined,

			// Provider-specific model IDs
			openAiModelId: undefined,
			openRouterModelId: undefined,
			nousResearchModelId: undefined,

			// Model info objects
			openAiModelInfo: undefined,
			openRouterModelInfo: undefined,

			// Other mode-specific fields
			thinkingBudgetTokens: undefined,
			reasoningEffort: undefined,
		}
	}

	return {
		// Core fields
		apiProvider: mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider,
		apiModelId: mode === "plan" ? apiConfiguration.planModeApiModelId : apiConfiguration.actModeApiModelId,

		// Provider-specific model IDs
		openAiModelId: mode === "plan" ? apiConfiguration.planModeOpenAiModelId : apiConfiguration.actModeOpenAiModelId,
		openRouterModelId:
			mode === "plan" ? apiConfiguration.planModeOpenRouterModelId : apiConfiguration.actModeOpenRouterModelId,
		nousResearchModelId:
			mode === "plan" ? apiConfiguration.planModeNousResearchModelId : apiConfiguration.actModeNousResearchModelId,

		// Model info objects
		openAiModelInfo: mode === "plan" ? apiConfiguration.planModeOpenAiModelInfo : apiConfiguration.actModeOpenAiModelInfo,
		openRouterModelInfo:
			mode === "plan" ? apiConfiguration.planModeOpenRouterModelInfo : apiConfiguration.actModeOpenRouterModelInfo,

		// Other mode-specific fields
		thinkingBudgetTokens:
			mode === "plan" ? apiConfiguration.planModeThinkingBudgetTokens : apiConfiguration.actModeThinkingBudgetTokens,
		reasoningEffort: mode === "plan" ? apiConfiguration.planModeReasoningEffort : apiConfiguration.actModeReasoningEffort,
	}
}

/**
 * Synchronizes mode configurations by copying the source mode's settings to both modes
 * This is used when the "Use different models for Plan and Act modes" toggle is unchecked
 */
export async function syncModeConfigurations(
	apiConfiguration: ApiConfiguration | undefined,
	sourceMode: Mode,
	handleFieldsChange: (updates: Partial<ApiConfiguration>) => Promise<void>,
): Promise<void> {
	if (!apiConfiguration) {
		return
	}

	const sourceFields = getModeSpecificFields(apiConfiguration, sourceMode)
	const { apiProvider } = sourceFields

	if (!apiProvider) {
		return
	}

	// Build the complete update object with both plan and act mode fields
	const updates: Partial<ApiConfiguration> = {
		// Always sync common fields
		planModeApiProvider: sourceFields.apiProvider,
		actModeApiProvider: sourceFields.apiProvider,
		planModeThinkingBudgetTokens: sourceFields.thinkingBudgetTokens,
		actModeThinkingBudgetTokens: sourceFields.thinkingBudgetTokens,
		planModeReasoningEffort: sourceFields.reasoningEffort,
		actModeReasoningEffort: sourceFields.reasoningEffort,
	}

	// Handle provider-specific fields
	switch (apiProvider) {
		case "openrouter":
			updates.planModeOpenRouterModelId = sourceFields.openRouterModelId
			updates.actModeOpenRouterModelId = sourceFields.openRouterModelId
			updates.planModeOpenRouterModelInfo = sourceFields.openRouterModelInfo
			updates.actModeOpenRouterModelInfo = sourceFields.openRouterModelInfo
			break

		case "openai":
			updates.planModeOpenAiModelId = sourceFields.openAiModelId
			updates.actModeOpenAiModelId = sourceFields.openAiModelId
			updates.planModeOpenAiModelInfo = sourceFields.openAiModelInfo
			updates.actModeOpenAiModelInfo = sourceFields.openAiModelInfo
			break

		case "nousResearch":
			updates.planModeNousResearchModelId = sourceFields.nousResearchModelId
			updates.actModeNousResearchModelId = sourceFields.nousResearchModelId
			break

		default:
			updates.planModeApiModelId = sourceFields.apiModelId
			updates.actModeApiModelId = sourceFields.apiModelId
			break
	}

	// Make the atomic update
	await handleFieldsChange(updates)
}

export { filterOpenRouterModelIds } from "@shared/utils/model-filters"

// Helper to get provider-specific configuration info and empty state guidance
export const getProviderInfo = (
	provider: ApiProvider,
	apiConfiguration: any,
	effectiveMode: "plan" | "act",
): { modelId?: string; baseUrl?: string; helpText: string } => {
	switch (provider) {
		case "openai":
			return {
				modelId:
					effectiveMode === "plan" ? apiConfiguration.planModeOpenAiModelId : apiConfiguration.actModeOpenAiModelId,
				baseUrl: apiConfiguration.openAiBaseUrl,
				helpText: "Add your OpenAI API key and endpoint",
			}
		default:
			return {
				modelId: undefined,
				baseUrl: undefined,
				helpText: "Configure this provider in model settings",
			}
	}
}
