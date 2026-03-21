/**
 * Shared types for chat row components.
 * Extracted to a separate file to break circular dependencies between
 * ChatRow and individual row components (e.g., CompletionOutputRow).
 */

export interface QuoteButtonState {
	visible: boolean
	top: number
	left: number
	selectedText: string
}
