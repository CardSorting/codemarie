import { SlashCommandInfo } from "@shared/proto/codemarie/system"
import { Box, Text, useInput } from "ink"
import React from "react"
import { FileSearchResult } from "../utils/file-search"
import { ActionButtons, type ButtonConfig } from "./ActionButtons"
import { FileMentionMenu } from "./FileMentionMenu"
import { HighlightedInput } from "./HighlightedInput"
import { SlashCommandMenu } from "./SlashCommandMenu"

interface ChatInputAreaProps {
	textInput: string
	cursorPos: number
	mode: "act" | "plan"
	placeholder: string
	isLoading: boolean
	fileResults: FileSearchResult[]
	selectedIndex: number
	showSlashMenu: boolean
	filteredCommands: SlashCommandInfo[]
	selectedSlashIndex: number
	buttonConfig: ButtonConfig
	isExiting: boolean
	onButtonAction: (type: string) => void
	query: string
	onKeyboardSequence: (input: string, key: any) => void
}

export const ChatInputArea: React.FC<ChatInputAreaProps> = ({
	textInput,
	cursorPos,
	mode,
	placeholder,
	isLoading,
	fileResults,
	selectedIndex,
	showSlashMenu,
	filteredCommands,
	selectedSlashIndex,
	buttonConfig,
	isExiting,
	query,
	onKeyboardSequence,
}) => {
	useInput(onKeyboardSequence, { isActive: !isExiting })

	return (
		<Box flexDirection="column" marginTop={1} width="100%">
			{!isExiting && fileResults.length > 0 && (
				<FileMentionMenu isLoading={isLoading} query={query} results={fileResults} selectedIndex={selectedIndex} />
			)}

			{!isExiting && showSlashMenu && (
				<Box marginBottom={1}>
					<SlashCommandMenu commands={filteredCommands} query={query} selectedIndex={selectedSlashIndex} />
				</Box>
			)}

			<Box borderStyle="round" flexDirection="column" paddingX={1} width="100%">
				<Box justifyContent="space-between" width="100%">
					{!isExiting ? (
						<Box>
							<Text>Input: </Text>
							<HighlightedInput
								availableCommands={filteredCommands.map((c) => c.name)}
								cursorPos={cursorPos}
								text={textInput}
							/>
						</Box>
					) : (
						<Box />
					)}
					<Text color="gray">/ for commands, @ for files</Text>
				</Box>
				{!isExiting && textInput.length === 0 && (
					<Box marginLeft={1} position="absolute">
						<Box>
							<HighlightedInput text={placeholder} />
						</Box>
					</Box>
				)}
			</Box>

			{!isExiting && (
				<Box marginTop={1} paddingLeft={1} width="100%">
					<ActionButtons config={buttonConfig} mode={mode} />
				</Box>
			)}
		</Box>
	)
}
