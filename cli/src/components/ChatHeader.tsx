import { Box, Text } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import { StaticRobotFrame } from "./AsciiMotionCli"

interface ChatHeaderProps {
	terminalWidth?: number
}

/**
 * Center text by padding with spaces
 */
function centerText(text: string, terminalWidth?: number): string {
	const width = terminalWidth || process.stdout.columns || 80
	const padding = Math.max(0, Math.floor((width - text.length) / 2))
	return " ".repeat(padding) + text
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ terminalWidth }) => {
	return (
		<Box alignItems="center" flexDirection="column" width="100%">
			<Box marginBottom={1} marginTop={1}>
				<StaticRobotFrame />
			</Box>
			<Box marginBottom={1}>
				<Text bold color={COLORS.primaryBlue}>
					{centerText("Codemarie CLI - Intelligent Pair Programming", terminalWidth)}
				</Text>
			</Box>
		</Box>
	)
}
