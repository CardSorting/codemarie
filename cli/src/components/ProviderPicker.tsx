/**
 * Provider picker component for API provider selection
 */

import React, { useMemo } from "react"
import { StateManager } from "@/core/storage/StateManager"
import type { ApiConfiguration } from "@/shared/api"
import { getProviderLabel, useValidProviders } from "../utils/providers"
import { SearchableList, type SearchableListItem } from "./SearchableList"

// Re-export for backwards compatibility
export { getProviderLabel }

/**
 * Check if a provider is configured (has required credentials/settings)
 * Based on webview's getConfiguredProviders logic
 */
function isProviderConfigured(providerId: string, config: ApiConfiguration): boolean {
	switch (providerId) {
		case "anthropic":
			return !!config.apiKey
		case "openrouter":
			return !!config.openRouterApiKey

		case "gemini":
			return !!config.geminiApiKey
		case "openai-native":
			return !!config.openAiNativeApiKey
		case "openai-codex":
			// OpenAI Codex uses OAuth with credentials stored as JSON blob
			return !!(config as Record<string, unknown>)["openai-codex-oauth-credentials"]
		case "nousResearch":
			return !!config.nousResearchApiKey
		case "openai":
			return !!(
				(config.openAiBaseUrl && config.openAiApiKey) ||
				config.planModeOpenAiModelId ||
				config.actModeOpenAiModelId
			)
		case "claude-code":
			return !!config.claudeCodePath
		default:
			return false
	}
}

interface ProviderPickerProps {
	onSelect: (providerId: string) => void
	isActive?: boolean
}

export const ProviderPicker: React.FC<ProviderPickerProps> = ({ onSelect, isActive = true }) => {
	// Get API configuration to check which providers are configured
	const apiConfig = StateManager.get().getApiConfiguration()
	const sorted = useValidProviders()

	// Use providers.json order, filtered to exclude CLI-incompatible providers
	const items: SearchableListItem[] = useMemo(() => {
		return sorted.map((providerId: string) => ({
			id: providerId,
			label: getProviderLabel(providerId),
			suffix: isProviderConfigured(providerId, apiConfig) ? "(Configured)" : undefined,
		}))
	}, [apiConfig, sorted])

	return <SearchableList isActive={isActive} items={items} onSelect={(item) => onSelect(item.id)} />
}
