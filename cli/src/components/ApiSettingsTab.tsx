import { Box, Text } from "ink"
import React from "react"
import { supportsReasoningEffortForModel } from "@/utils/model-utils"
import { COLORS } from "../constants/colors"
import { getProviderLabel } from "./ProviderPicker"

interface ApiSettingsTabProps {
	provider: string
	actModelId: string
	planModelId: string
	separateModels: boolean
	actThinkingEnabled: boolean
	planThinkingEnabled: boolean
	actReasoningEffort: string
	planReasoningEffort: string
	onToggleSeparateModels: () => void
	onToggleActThinking: () => void
	onTogglePlanThinking: () => void
	onChangeActReasoningEffort: () => void
	onChangePlanReasoningEffort: () => void
}

export const ApiSettingsTab: React.FC<ApiSettingsTabProps> = ({
	provider,
	actModelId,
	planModelId,
	separateModels,
	actThinkingEnabled,
	planThinkingEnabled,
	actReasoningEffort,
	planReasoningEffort,
}) => {
	const providerUsesReasoningEffort = provider === "openai-native" || provider === "openai-codex"
	const showActReasoningEffort = supportsReasoningEffortForModel(actModelId || "")
	const showPlanReasoningEffort = supportsReasoningEffortForModel(planModelId || "")
	const showActThinkingOption = !providerUsesReasoningEffort && !showActReasoningEffort
	const showPlanThinkingOption = !providerUsesReasoningEffort && !showPlanReasoningEffort

	return (
		<Box flexDirection="column" paddingLeft={1}>
			<Box>
				<Box width={15}>
					<Text color="gray">Provider: </Text>
				</Box>
				<Text color="cyan">{getProviderLabel(provider)}</Text>
			</Box>

			{separateModels ? (
				<Box flexDirection="column">
					<Box marginTop={1}>
						<Text bold color={COLORS.primaryBlue}>
							Act Mode
						</Text>
					</Box>
					<Box>
						<Box width={15}>
							<Text color="gray">Model ID: </Text>
						</Box>
						<Text>{actModelId || "not set"}</Text>
					</Box>
					{showActThinkingOption && (
						<Box>
							<Box width={15}>
								<Text color="gray">Thinking: </Text>
							</Box>
							<Text color={actThinkingEnabled ? "green" : "red"}>
								{actThinkingEnabled ? "Enabled" : "Disabled"}
							</Text>
						</Box>
					)}
					{showActReasoningEffort && (
						<Box>
							<Box width={15}>
								<Text color="gray">Reasoning: </Text>
							</Box>
							<Text color="magenta">{actReasoningEffort}</Text>
						</Box>
					)}

					<Box marginTop={1}>
						<Text bold color={COLORS.primaryBlue}>
							Plan Mode
						</Text>
					</Box>
					<Box>
						<Box width={15}>
							<Text color="gray">Model ID: </Text>
						</Box>
						<Text>{planModelId || "not set"}</Text>
					</Box>
					{showPlanThinkingOption && (
						<Box>
							<Box width={15}>
								<Text color="gray">Thinking: </Text>
							</Box>
							<Text color={planThinkingEnabled ? "green" : "red"}>
								{planThinkingEnabled ? "Enabled" : "Disabled"}
							</Text>
						</Box>
					)}
					{showPlanReasoningEffort && (
						<Box>
							<Box width={15}>
								<Text color="gray">Reasoning: </Text>
							</Box>
							<Text color="magenta">{planReasoningEffort}</Text>
						</Box>
					)}
				</Box>
			) : (
				<Box flexDirection="column">
					<Box marginTop={1}>
						<Box width={15}>
							<Text color="gray">Model ID: </Text>
						</Box>
						<Text>{actModelId || "not set"}</Text>
					</Box>
					{showActThinkingOption && (
						<Box>
							<Box width={15}>
								<Text color="gray">Thinking: </Text>
							</Box>
							<Text color={actThinkingEnabled ? "green" : "red"}>
								{actThinkingEnabled ? "Enabled" : "Disabled"}
							</Text>
						</Box>
					)}
					{showActReasoningEffort && (
						<Box>
							<Box width={15}>
								<Text color="gray">Reasoning: </Text>
							</Box>
							<Text color="magenta">{actReasoningEffort}</Text>
						</Box>
					)}
				</Box>
			)}

			<Box marginTop={1}>
				<Box width={35}>
					<Text color="gray">Use separate models for Plan and Act: </Text>
				</Box>
				<Text color={separateModels ? "green" : "red"}>{separateModels ? "Yes" : "No"}</Text>
			</Box>
		</Box>
	)
}
