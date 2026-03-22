import { AnimatePresence, motion } from "framer-motion"
import type React from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface PromptSuggestionsProps {
	suggestions: string[]
	onSelect: (suggestion: string) => void
	isLoading?: boolean
}

const SuggestionsContainer = styled(motion.div)`
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	padding: 8px 0;
	margin-bottom: 4px;
`

const LoadingIndicator = styled(motion.div)`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 0;
	margin-bottom: 4px;
	font-size: 11px;
	color: var(--vscode-descriptionForeground);

	&::before {
		content: "";
		width: 12px;
		height: 12px;
		border: 2px solid var(--vscode-progressBar-background);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
`

const SuggestionButton = styled(motion.button)`
	background-color: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	border: 1px solid var(--vscode-button-secondaryHoverBackground);
	border-radius: 16px;
	padding: 4px 12px;
	font-size: 11px;
	cursor: pointer;
	white-space: nowrap;
	display: flex;
	align-items: center;
	gap: 6px;

	&:hover {
		background-color: var(--vscode-button-secondaryHoverBackground);
		border-color: var(--vscode-button-hoverBackground);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const ShortcutIndicator = styled.span`
	opacity: 0.6;
	font-size: 9px;
	background: var(--vscode-badge-background);
	color: var(--vscode-badge-foreground);
	padding: 1px 4px;
	border-radius: 4px;
	font-family: var(--vscode-editor-font-family);
`

const PromptSuggestions: React.FC<PromptSuggestionsProps> = ({ suggestions, onSelect, isLoading }) => {
	const { platform } = useExtensionState()
	const isMac = platform === "darwin"
	const modKey = isMac ? "⌘" : "Ctrl"

	return (
		<AnimatePresence mode="wait">
			{isLoading ? (
				<LoadingIndicator
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -5 }}
					initial={{ opacity: 0, y: 5 }}
					key="loading"
					transition={{ duration: 0.2 }}>
					Generating suggestions...
				</LoadingIndicator>
			) : suggestions && suggestions.length > 0 ? (
				<SuggestionsContainer
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -10 }}
					initial={{ opacity: 0, y: 10 }}
					key="suggestions"
					transition={{ duration: 0.3, staggerChildren: 0.05 }}>
					{suggestions.map((suggestion, index) => (
						<SuggestionButton
							animate={{ opacity: 1, scale: 1 }}
							initial={{ opacity: 0, scale: 0.9 }}
							key={index}
							onClick={() => onSelect(suggestion)}
							transition={{ delay: index * 0.05 }}
							whileHover={{ scale: 1.02 }}
							whileTap={{ scale: 0.98 }}>
							{suggestion}
							<ShortcutIndicator>
								{modKey}
								{index + 1}
							</ShortcutIndicator>
						</SuggestionButton>
					))}
				</SuggestionsContainer>
			) : null}
		</AnimatePresence>
	)
}

export default PromptSuggestions
