import { EmptyRequest } from "@shared/proto/codemarie/common"
import type { SlashCommandInfo } from "@shared/proto/codemarie/system"
import { CLI_ONLY_COMMANDS } from "@shared/slashCommands"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Controller } from "@/core/controller"
import { getAvailableSlashCommands } from "@/core/controller/system/getAvailableSlashCommands"
import { extractMentionQuery, type FileSearchResult, insertMention, searchWorkspaceFiles } from "../utils/file-search"
import { extractSlashQuery, filterCommands, insertSlashCommand, sortCommandsWorkflowsFirst } from "../utils/slash-commands"
import { useTextInput } from "./useTextInput"

interface UseChatInputProps {
	controller?: Controller
	storageKey: string
	onSubmit?: (text: string) => void
}

const SEARCH_DEBOUNCE_MS = 150

export function useChatInput({ controller, storageKey, onSubmit }: UseChatInputProps) {
	const {
		text,
		cursorPos,
		setText,
		setCursorPos,
		handleKeyboardSequence: handleKeyboardSequenceFromTextInput,
		handleCtrlShortcut,
		deleteCharBefore,
		insertText,
	} = useTextInput()
	const [fileResults, setFileResults] = useState<FileSearchResult[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isSearching, setIsSearching] = useState(false)
	const [availableCommands, setAvailableCommands] = useState<SlashCommandInfo[]>([])
	const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)
	const [slashMenuDismissed, setSlashMenuDismissed] = useState(false)

	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	// Fetch slash commands
	useEffect(() => {
		const loadCommands = async () => {
			if (!controller) return
			try {
				const response = await getAvailableSlashCommands(controller, EmptyRequest.create())
				const cliCommands = response.commands.filter((cmd: SlashCommandInfo) => cmd.cliCompatible !== false)
				const cliOnlyCommands: SlashCommandInfo[] = CLI_ONLY_COMMANDS.map((cmd) => ({
					name: cmd.name,
					description: cmd.description || "",
					section: cmd.section || "default",
					cliCompatible: true,
				}))
				setAvailableCommands([...cliOnlyCommands, ...sortCommandsWorkflowsFirst(cliCommands)])
			} catch (err) {
				console.error("Error fetching slash commands:", err)
			}
		}
		loadCommands()
	}, [controller])
	// Handle search for mentions
	const mentionInfo = useMemo(() => extractMentionQuery(text), [text])

	useEffect(() => {
		if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)

		if (mentionInfo.query) {
			setIsSearching(true)
			searchTimeoutRef.current = setTimeout(async () => {
				const workspaceRoots = controller?.stateManager.getGlobalStateKey("workspaceRoots")
				const primaryRootIndex = controller?.stateManager.getGlobalStateKey("primaryRootIndex") || 0
				const workspacePath = workspaceRoots?.[primaryRootIndex]?.path || process.cwd()
				const results = await searchWorkspaceFiles(mentionInfo.query!, workspacePath)
				setFileResults(results)
				setSelectedIndex(0)
				setIsSearching(false)
			}, SEARCH_DEBOUNCE_MS)
		} else {
			setFileResults([])
			setIsSearching(false)
		}
	}, [mentionInfo.query, controller]) // Added controller to dependencies

	const slashInfo = useMemo(() => extractSlashQuery(text, cursorPos), [text, cursorPos])
	const filteredCommands = useMemo(
		() => filterCommands(availableCommands, slashInfo.query),
		[availableCommands, slashInfo.query],
	)
	const showSlashMenu = slashInfo.inSlashMode && filteredCommands.length > 0 && !slashMenuDismissed

	const handleSlashSelect = useCallback(() => {
		const command = filteredCommands[selectedSlashIndex]
		if (command) {
			const commandText = `/${command.name}`
			const { text: newText, cursorPos: newPos } = insertSlashCommand(text, cursorPos, command.name)
			setText(newText)
			setCursorPos(newPos)
			setSlashMenuDismissed(true)

			// Auto-submit CLI-only commands that don't need arguments
			if (["q", "exit", "help", "clear", "history", "settings", "models", "skills", "checkpoints"].includes(command.name)) {
				onSubmit?.(commandText)
			}
			return true
		}
		return false
	}, [filteredCommands, selectedSlashIndex, text, cursorPos, setText, setCursorPos, onSubmit])

	const handleMentionSelect = useCallback(() => {
		const result = fileResults[selectedIndex]
		if (result) {
			const { text: newText, cursorPos: newPos } = insertMention(text, cursorPos, result.path)
			setText(newText)
			setCursorPos(newPos)
			setFileResults([])
			return true
		}
		return false
	}, [fileResults, selectedIndex, text, cursorPos, setText, setCursorPos])

	const handleKeyboardSequence = useCallback(
		(input: string, key: any): boolean => {
			// 1. Text input sequences (Option+Arrows)
			if (handleKeyboardSequenceFromTextInput(input)) return true
			// 2. Ctrl shortcuts
			if (key?.name && handleCtrlShortcut(key.name)) return true

			// 3. Arrow keys for menus
			if (showSlashMenu || fileResults.length > 0) {
				if (key.upArrow) {
					if (showSlashMenu) {
						setSelectedSlashIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1))
					} else {
						setSelectedIndex((prev) => (prev > 0 ? prev - 1 : fileResults.length - 1))
					}
					return true
				}
				if (key.downArrow) {
					if (showSlashMenu) {
						setSelectedSlashIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0))
					} else {
						setSelectedIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0))
					}
					return true
				}
			}

			// 4. Enter / Return
			if (key.return) {
				if (showSlashMenu) {
					handleSlashSelect()
					return true
				}
				if (fileResults.length > 0) {
					handleMentionSelect()
					return true
				}

				// Submission is handled by the caller who receives return=true?
				// No, let's keep it here for character handling return false to let caller handle Enter if we want,
				// but it's cleaner to handle it in one place.
				return false // Let ChatView handle Enter for submission
			}

			if (key.tab) {
				if (showSlashMenu) {
					handleSlashSelect()
					return true
				}
				if (fileResults.length > 0) {
					handleMentionSelect()
					return true
				}
			}

			if (key.backspace || key.delete) {
				deleteCharBefore()
				return true
			}

			if (input && !key.ctrl && !key.meta) {
				insertText(input)
				return true
			}

			return false
		},
		[
			handleKeyboardSequenceFromTextInput,
			handleCtrlShortcut,
			showSlashMenu,
			fileResults.length,
			handleSlashSelect,
			handleMentionSelect,
			deleteCharBefore,
			insertText,
			filteredCommands.length,
		],
	)

	return {
		text,
		cursorPos,
		setText,
		setCursorPos,
		handleKeyboardSequence,
		handleCtrlShortcut,
		deleteCharBefore,
		insertText,
		fileResults,
		selectedIndex,
		setSelectedIndex,
		isSearching,
		availableCommands,
		filteredCommands,
		selectedSlashIndex,
		setSelectedSlashIndex,
		slashInfo,
		showSlashMenu,
		handleSlashSelect,
		handleMentionSelect,
	}
}
