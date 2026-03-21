import { Box, Text } from "ink"
import React from "react"

const FEATURE_SETTINGS = {
	subagents: {
		label: "Subagents",
		description: "Let Codemarie run focused subagents in parallel to explore the codebase for you",
	},
	autoCondense: {
		label: "Auto-condense",
		description: "Automatically summarize long conversations",
	},
	webTools: {
		label: "Web tools",
		description: "Enable web search and fetch tools",
	},
	strictPlanMode: {
		label: "Strict plan mode",
		description: "Require explicit mode switching",
	},
	nativeToolCall: {
		label: "Native tool call",
		description: "Use model's native tool calling API",
	},
	parallelToolCalling: {
		label: "Parallel tool calling",
		description: "Allow multiple tools in a single response",
	},
	doubleCheckCompletion: {
		label: "Double-check completion",
		description: "Reject first completion attempt and require re-verification",
	},
} as const

type FeatureKey = keyof typeof FEATURE_SETTINGS

interface FeaturesSettingsTabProps {
	features: Record<FeatureKey, boolean>
	onToggle: (key: FeatureKey) => void
}

export const FeaturesSettingsTab: React.FC<FeaturesSettingsTabProps> = ({ features }) => {
	return (
		<Box flexDirection="column" paddingLeft={1}>
			{(Object.entries(FEATURE_SETTINGS) as [FeatureKey, typeof FEATURE_SETTINGS.subagents][]).map(([key, config]) => (
				<Box flexDirection="column" key={key} marginBottom={1}>
					<Box>
						<Text color={features[key] ? "green" : "red"}>{features[key] ? " [x] " : " [ ] "}</Text>
						<Text color={features[key] ? "white" : "gray"}>{config.label}</Text>
					</Box>
					<Box marginLeft={5}>
						<Text color="gray" dimColor italic>
							{config.description}
						</Text>
					</Box>
				</Box>
			))}
		</Box>
	)
}
