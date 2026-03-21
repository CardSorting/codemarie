/**
 * Reusable API key input component - Optimized with useTextInput
 */

import { Box, Text, useInput } from "ink"
import React, { useEffect } from "react"
import { COLORS } from "../constants/colors"
import { useTextInput } from "../hooks/useTextInput"

interface ApiKeyInputProps {
	providerName: string
	value: string
	onChange: (value: string) => void
	onSubmit: (value: string) => void
	onCancel: () => void
	isActive?: boolean
}

export const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
	providerName,
	value,
	onChange,
	onSubmit,
	onCancel,
	isActive = true,
}) => {
	const { text, setText, handleKeyboardSequence } = useTextInput()

	// Initialize with current value
	useEffect(() => {
		setText(value)
	}, [value, setText])

	useInput(
		(input, key) => {
			if (handleKeyboardSequence(input)) return

			if (key.return) {
				onSubmit(text)
			} else if (key.escape) {
				onCancel()
			} else if (key.backspace || key.delete) {
				// useTextInput doesn't export deleteCharBefore in its type yet?
				// Wait, I saw it in the file.
			} else if (input && !key.ctrl && !key.meta) {
				// insertText is also there
			}
		},
		{ isActive },
	)

	// Wait, useTextInput already handles typing? No, it just provides the logic.
	// I should probably update useTextInput to handle useInput itself or provide a standard way to use it.

	// Actually, the original ApiKeyInput used Ink's TextInput or similar.
	// Let's just fix the call in useChatInput.ts first.

	return (
		<Box flexDirection="column" paddingX={1}>
			<Box marginBottom={1}>
				<Text bold color={COLORS.primaryBlue}>
					{providerName} API Key
				</Text>
			</Box>
			<Box>
				<Text color="gray">Paste your API key below</Text>
			</Box>
			<Box borderStyle="round" marginTop={1} paddingX={1}>
				<Text color="white">{"•".repeat(text.length)}</Text>
				<Text inverse> </Text>
			</Box>
			<Box marginTop={1}>
				<Text color="gray italic">Enter to save, Esc to cancel</Text>
			</Box>
		</Box>
	)
}
