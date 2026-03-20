import { type SlashCommand } from "@shared/slashCommands"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
	getMatchingSlashCommands,
	insertSlashCommand,
	removeSlashCommand,
	shouldShowSlashCommandsMenu,
} from "@/utils/slash-commands"

interface UseSlashCommandsProps {
	inputValue: string
	setInputValue: (value: string) => void
	cursorPosition: number
	setCursorPosition: (pos: number) => void
	setIntendedCursorPosition: (pos: number | null) => void
	textAreaRef: React.RefObject<HTMLTextAreaElement | null>
	localWorkflowToggles: Record<string, boolean>
	globalWorkflowToggles: Record<string, boolean>
	remoteWorkflowToggles: Record<string, boolean>
	remoteGlobalWorkflows?: any[]
	mcpServers: any[]
}

export const useSlashCommands = ({
	inputValue,
	setInputValue,
	cursorPosition,
	setCursorPosition,
	setIntendedCursorPosition,
	textAreaRef,
	localWorkflowToggles,
	globalWorkflowToggles,
	remoteWorkflowToggles,
	remoteGlobalWorkflows,
	mcpServers,
}: UseSlashCommandsProps) => {
	const [showSlashCommandsMenu, setShowSlashCommandsMenu] = useState(false)
	const [selectedSlashCommandsIndex, setSelectedSlashCommandsIndex] = useState(0)
	const [slashCommandsQuery, setSlashCommandsQuery] = useState("")
	const [justDeletedSpaceAfterSlashCommand, setJustDeletedSpaceAfterSlashCommand] = useState(false)
	const slashCommandsMenuContainerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handleClickOutsideSlashMenu = (event: MouseEvent) => {
			if (slashCommandsMenuContainerRef.current && !slashCommandsMenuContainerRef.current.contains(event.target as Node)) {
				setShowSlashCommandsMenu(false)
			}
		}

		if (showSlashCommandsMenu) {
			document.addEventListener("mousedown", handleClickOutsideSlashMenu)
		}

		return () => {
			document.removeEventListener("mousedown", handleClickOutsideSlashMenu)
		}
	}, [showSlashCommandsMenu])

	const handleSlashCommandsSelect = useCallback(
		(command: SlashCommand) => {
			setShowSlashCommandsMenu(false)
			const queryLength = slashCommandsQuery.length
			setSlashCommandsQuery("")

			if (textAreaRef.current) {
				const { newValue, commandIndex } = insertSlashCommand(
					textAreaRef.current.value,
					command.name,
					queryLength,
					cursorPosition,
				)
				const newCursorPosition = newValue.indexOf(" ", commandIndex + 1 + command.name.length) + 1

				setInputValue(newValue)
				setCursorPosition(newCursorPosition)
				setIntendedCursorPosition(newCursorPosition)

				setTimeout(() => {
					if (textAreaRef.current) {
						textAreaRef.current.blur()
						textAreaRef.current.focus()
					}
				}, 0)
			}
		},
		[setInputValue, slashCommandsQuery, cursorPosition, textAreaRef, setCursorPosition, setIntendedCursorPosition],
	)

	const updateSlashCommandsMenu = useCallback((newValue: string, newCursorPosition: number) => {
		const show = shouldShowSlashCommandsMenu(newValue, newCursorPosition)
		setShowSlashCommandsMenu(show)

		if (show) {
			const beforeCursor = newValue.slice(0, newCursorPosition)
			const slashIndex = beforeCursor.lastIndexOf("/")
			const query = newValue.slice(slashIndex + 1, newCursorPosition)
			setSlashCommandsQuery(query)
			setSelectedSlashCommandsIndex(0)
		} else {
			setSlashCommandsQuery("")
			setSelectedSlashCommandsIndex(0)
		}
		return show
	}, [])

	const handleSlashCommandKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (!showSlashCommandsMenu) return false

			if (event.key === "Escape") {
				setShowSlashCommandsMenu(false)
				setSlashCommandsQuery("")
				return true
			}

			if (event.key === "ArrowUp" || event.key === "ArrowDown") {
				event.preventDefault()
				setSelectedSlashCommandsIndex((prevIndex) => {
					const direction = event.key === "ArrowUp" ? -1 : 1
					const allCommands = getMatchingSlashCommands(
						slashCommandsQuery,
						localWorkflowToggles,
						globalWorkflowToggles,
						remoteWorkflowToggles,
						remoteGlobalWorkflows,
						mcpServers,
					)

					if (allCommands.length === 0) {
						return prevIndex
					}

					const totalCommandCount = allCommands.length
					const newIndex = (prevIndex + direction + totalCommandCount) % totalCommandCount
					return newIndex
				})
				return true
			}

			if ((event.key === "Enter" || event.key === "Tab") && selectedSlashCommandsIndex !== -1) {
				event.preventDefault()
				const commands = getMatchingSlashCommands(
					slashCommandsQuery,
					localWorkflowToggles,
					globalWorkflowToggles,
					remoteWorkflowToggles,
					remoteGlobalWorkflows,
					mcpServers,
				)
				if (commands.length > 0) {
					handleSlashCommandsSelect(commands[selectedSlashCommandsIndex])
				}
				return true
			}

			return false
		},
		[
			showSlashCommandsMenu,
			slashCommandsQuery,
			localWorkflowToggles,
			globalWorkflowToggles,
			remoteWorkflowToggles,
			remoteGlobalWorkflows,
			mcpServers,
			selectedSlashCommandsIndex,
			handleSlashCommandsSelect,
		],
	)

	const handleSlashCommandDelete = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (justDeletedSpaceAfterSlashCommand) {
				const { newText, newPosition } = removeSlashCommand(inputValue, cursorPosition)
				if (newText !== inputValue) {
					event.preventDefault()
					setInputValue(newText)
					setIntendedCursorPosition(newPosition)
				}
				setJustDeletedSpaceAfterSlashCommand(false)
				setShowSlashCommandsMenu(false)
				return true
			}
			return false
		},
		[justDeletedSpaceAfterSlashCommand, inputValue, cursorPosition, setInputValue, setIntendedCursorPosition],
	)

	return {
		showSlashCommandsMenu,
		setShowSlashCommandsMenu,
		selectedSlashCommandsIndex,
		setSelectedSlashCommandsIndex,
		slashCommandsQuery,
		setSlashCommandsQuery,
		justDeletedSpaceAfterSlashCommand,
		setJustDeletedSpaceAfterSlashCommand,
		slashCommandsMenuContainerRef,
		handleSlashCommandsSelect,
		updateSlashCommandsMenu,
		handleSlashCommandKeyDown,
		handleSlashCommandDelete,
	}
}
