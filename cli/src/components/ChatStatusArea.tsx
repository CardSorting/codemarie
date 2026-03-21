import { Box, Text } from "ink"
import React from "react"
import type { GitDiffStats } from "../hooks/useGitStats"
import { StatusBar } from "./StatusBar"
import { ThinkingIndicator } from "./ThinkingIndicator"

interface ChatStatusAreaProps {
	gitBranch: string | null
	gitDiffStats: GitDiffStats | null
	isSpinnerActive: boolean
	spinnerStartTime?: number
	isExiting: boolean
	modelId: string
}

export const ChatStatusArea: React.FC<ChatStatusAreaProps> = ({
	gitBranch,
	gitDiffStats,
	isSpinnerActive,
	spinnerStartTime,
	isExiting,
	modelId,
}) => {
	return (
		<Box flexDirection="column" width="100%">
			{isSpinnerActive && (
				<Box marginBottom={1}>
					<ThinkingIndicator startTime={spinnerStartTime} />
				</Box>
			)}
			<StatusBar gitBranch={gitBranch} gitDiffStats={gitDiffStats} modelId={modelId} />
			<Box paddingLeft={1}>
				<Text color="gray">Mode: Plan | </Text>
				<Text bold>Act</Text>
			</Box>
		</Box>
	)
}
