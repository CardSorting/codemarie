function normalizeModelId(modelId: string): string {
	return modelId.trim().toLowerCase()
}

const CLINE_FREE_MODEL_EXCEPTIONS = ["minimax-m2", "devstral-2512", "arcee-ai/trinity-large"]

export function isCodemarieFreeModelException(modelId: string): boolean {
	const normalizedModelId = normalizeModelId(modelId)
	return CLINE_FREE_MODEL_EXCEPTIONS.some((token) => normalizedModelId.includes(token))
}

/**
 * Filters OpenRouter model IDs based on provider-specific rules.
 * For Codemarie provider: excludes :free models (except known exception models)
 * For OpenRouter/Vercel: excludes codemarie/ prefixed models
 * @param modelIds Array of model IDs to filter
 * @param provider The current API provider
 * @param allowedFreeModelIds Optional list of Codemarie free model IDs to keep visible
 * @returns Filtered array of model IDs
 */
export function filterOpenRouterModelIds(modelIds: string[]): string[] {
	// For OpenRouter and Vercel AI Gateway providers: exclude Codemarie-specific models
	return modelIds.filter((id) => !id.startsWith("codemarie/"))
}
