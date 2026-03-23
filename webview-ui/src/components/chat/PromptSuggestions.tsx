import type { PromptSuggestion, SuggestionType } from "@shared/ExtensionMessage"
import { AnimatePresence, motion } from "framer-motion"
import type React from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface PromptSuggestionsProps {
	suggestions: PromptSuggestion[]
	onSelect: (suggestion: string) => void
	isLoading?: boolean
}

const SuggestionsContainer = styled(motion.div)`
	display: flex;
	flex-wrap: nowrap;
	overflow-x: auto;
	gap: 8px;
	padding: 6px 0 10px 0;
	margin-bottom: 2px;
	scrollbar-width: none;
	&::-webkit-scrollbar {
		display: none;
	}

	/* Premium fade effect for horizontal scroll */
	mask-image: linear-gradient(to right, black 90%, transparent 100%);
`

const LoadingIndicator = styled(motion.div)`
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 0;
	margin-bottom: 2px;
	font-size: 10px;
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
	border-radius: 12px;
	padding: 4px 12px;
	font-size: 10px;
	cursor: pointer;
	white-space: nowrap;
	display: flex;
	align-items: center;
	gap: 8px;
	position: relative;
	overflow: hidden;
	transition: all 0.2s ease;

	&:hover {
		background-color: var(--vscode-button-secondaryHoverBackground);
		border-color: var(--vscode-button-hoverBackground);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const TypeIndicator = styled.span<{ type: SuggestionType }>`
	width: 6px;
	height: 6px;
	border-radius: 50%;
	flex-shrink: 0;
	background-color: ${(props) =>
		props.type === "fix"
			? "var(--vscode-charts-red)"
			: props.type === "design"
				? "var(--vscode-charts-blue)"
				: "var(--vscode-charts-green)"};
	box-shadow: 0 0 4px ${(props) =>
		props.type === "fix"
			? "var(--vscode-charts-red)"
			: props.type === "design"
				? "var(--vscode-charts-blue)"
				: "var(--vscode-charts-green)"};
`

const ImpactBar = styled.div<{ impact: number }>`
	position: absolute;
	bottom: 0;
	left: 0;
	height: 2px;
	background-color: var(--vscode-charts-orange);
	width: ${(props) => props.impact * 100}%;
	opacity: 0.4;
	transition: width 0.3s ease-out;
`

const ShortcutIndicator = styled.span`
	opacity: 0.4;
	font-size: 8px;
	background: rgba(255, 255, 255, 0.05);
	color: var(--vscode-descriptionForeground);
	padding: 0px 4px;
	border-radius: 3px;
	font-family: var(--vscode-editor-font-family);
	margin-left: 4px;
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
					Thinking...
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
							key={suggestion.text}
							onClick={() => onSelect(suggestion.text)}
							title={`${suggestion.type.toUpperCase()} | Impact Score: ${suggestion.impact || 0}`}
							transition={{ delay: index * 0.05 }}
							whileHover={{ scale: 1.02, y: -1 }}
							whileTap={{ scale: 0.98 }}>
							<TypeIndicator type={suggestion.type} />
							{suggestion.text}
							<ShortcutIndicator>
								{modKey}
								{index + 1}
							</ShortcutIndicator>
							{suggestion.impact !== undefined && <ImpactBar impact={suggestion.impact} />}
						</SuggestionButton>
					))}
				</SuggestionsContainer>
			) : null}
		</AnimatePresence>
	)
}

export default PromptSuggestions
