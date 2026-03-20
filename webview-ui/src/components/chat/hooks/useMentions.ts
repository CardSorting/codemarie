import { StringRequest } from "@shared/proto/codemarie/common"
import { FileSearchRequest, FileSearchType } from "@shared/proto/codemarie/file"
import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FileServiceClient } from "@/services/protobus-client"
import {
	ContextMenuOptionType,
	getContextMenuOptionIndex,
	getContextMenuOptions,
	insertMention,
	insertMentionDirectly,
	removeMention,
	type SearchResult,
	shouldShowContextMenu,
} from "@/utils/context-mentions"

const DEFAULT_CONTEXT_MENU_OPTION = getContextMenuOptionIndex(ContextMenuOptionType.File)

interface GitCommit {
	type: ContextMenuOptionType.Git
	value: string
	label: string
	description: string
}

interface UseMentionsProps {
	inputValue: string
	setInputValue: (value: string) => void
	cursorPosition: number
	setCursorPosition: (pos: number) => void
	setIntendedCursorPosition: (pos: number | null) => void
	intendedCursorPosition: number | null
	textAreaRef: React.RefObject<HTMLTextAreaElement | null>
	updateHighlights: () => void
}

export const useMentions = ({
	inputValue,
	setInputValue,
	cursorPosition,
	setCursorPosition,
	setIntendedCursorPosition,
	intendedCursorPosition,
	textAreaRef,
	updateHighlights,
}: UseMentionsProps) => {
	const [showContextMenu, setShowContextMenu] = useState(false)
	const [selectedMenuIndex, setSelectedMenuIndex] = useState(-1)
	const [searchQuery, setSearchQuery] = useState("")
	const [selectedType, setSelectedType] = useState<ContextMenuOptionType | null>(null)
	const [fileSearchResults, setFileSearchResults] = useState<SearchResult[]>([])
	const [searchLoading, setSearchLoading] = useState(false)
	const [gitCommits, setGitCommits] = useState<GitCommit[]>([])
	const [justDeletedSpaceAfterMention, setJustDeletedSpaceAfterMention] = useState(false)
	const [pendingInsertions, setPendingInsertions] = useState<string[]>([])
	const contextMenuContainerRef = useRef<HTMLDivElement>(null)
	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const currentSearchQueryRef = useRef<string>("")

	// Fetch git commits when Git is selected or when typing a hash
	useEffect(() => {
		if (selectedType === ContextMenuOptionType.Git || /^[a-f0-9]+$/i.test(searchQuery)) {
			FileServiceClient.searchCommits(StringRequest.create({ value: searchQuery || "" }))
				.then((response) => {
					if (response.commits) {
						const commits: GitCommit[] = response.commits.map((commit: any) => ({
							type: ContextMenuOptionType.Git,
							value: commit.hash,
							label: commit.subject,
							description: `${commit.shortHash} by ${commit.author} on ${commit.date}`,
						}))
						setGitCommits(commits)
					}
				})
				.catch((error) => {
					console.error("Error searching commits:", error)
				})
		}
	}, [selectedType, searchQuery])

	const queryItems = useMemo(() => {
		return [
			{ type: ContextMenuOptionType.Problems, value: "problems" },
			{ type: ContextMenuOptionType.Terminal, value: "terminal" },
			...gitCommits,
		]
	}, [gitCommits])

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (contextMenuContainerRef.current && !contextMenuContainerRef.current.contains(event.target as Node)) {
				setShowContextMenu(false)
			}
		}

		if (showContextMenu) {
			document.addEventListener("mousedown", handleClickOutside)
		}

		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [showContextMenu])

	useEffect(() => {
		if (!showContextMenu) {
			setSelectedType(null)
		}
	}, [showContextMenu])

	const handleMentionSelect = useCallback(
		(type: ContextMenuOptionType, value?: string) => {
			if (type === ContextMenuOptionType.NoResults) {
				return
			}

			if (
				type === ContextMenuOptionType.File ||
				type === ContextMenuOptionType.Folder ||
				type === ContextMenuOptionType.Git
			) {
				if (!value) {
					setSelectedType(type)
					setSearchQuery("")
					setSelectedMenuIndex(0)

					if (type === ContextMenuOptionType.File || type === ContextMenuOptionType.Folder) {
						setSearchLoading(true)

						let searchType: FileSearchType | undefined
						if (type === ContextMenuOptionType.File) {
							searchType = FileSearchType.FILE
						} else if (type === ContextMenuOptionType.Folder) {
							searchType = FileSearchType.FOLDER
						}

						FileServiceClient.searchFiles(
							FileSearchRequest.create({
								query: "",
								mentionsRequestId: "",
								selectedType: searchType,
							}),
						)
							.then((results) => {
								setFileSearchResults((results.results || []) as SearchResult[])
								setSearchLoading(false)
							})
							.catch((error) => {
								console.error("Error searching files:", error)
								setFileSearchResults([])
								setSearchLoading(false)
							})
					}
					return
				}
			}

			setShowContextMenu(false)
			setSelectedType(null)
			const queryLength = searchQuery.length
			setSearchQuery("")

			if (textAreaRef.current) {
				let insertValue = value || ""
				if (type === ContextMenuOptionType.Problems) {
					insertValue = "problems"
				} else if (type === ContextMenuOptionType.Terminal) {
					insertValue = "terminal"
				}

				const { newValue, mentionIndex } = insertMention(
					textAreaRef.current.value,
					cursorPosition,
					insertValue,
					queryLength,
				)

				setInputValue(newValue)
				const newCursorPosition = newValue.indexOf(" ", mentionIndex + insertValue.length) + 1
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
		[setInputValue, cursorPosition, searchQuery, textAreaRef, setCursorPosition, setIntendedCursorPosition],
	)

	const updateMentionsMenu = useCallback(
		(newValue: string, newCursorPosition: number) => {
			const show = shouldShowContextMenu(newValue, newCursorPosition)
			setShowContextMenu(show)

			if (show) {
				const lastAtIndex = newValue.lastIndexOf("@", newCursorPosition - 1)
				const query = newValue.slice(lastAtIndex + 1, newCursorPosition)
				setSearchQuery(query)
				currentSearchQueryRef.current = query

				if (query.length > 0) {
					setSelectedMenuIndex(0)

					if (searchTimeoutRef.current) {
						clearTimeout(searchTimeoutRef.current)
					}

					setSearchLoading(true)

					const searchType =
						selectedType === ContextMenuOptionType.File
							? FileSearchType.FILE
							: selectedType === ContextMenuOptionType.Folder
								? FileSearchType.FOLDER
								: undefined

					let workspaceHint: string | undefined
					let sQuery = query
					const workspaceHintMatch = query.match(/^([\w-]+):\/(.*)$/)
					if (workspaceHintMatch) {
						workspaceHint = workspaceHintMatch[1]
						sQuery = workspaceHintMatch[2]
					}

					searchTimeoutRef.current = setTimeout(() => {
						FileServiceClient.searchFiles(
							FileSearchRequest.create({
								query: sQuery,
								mentionsRequestId: query,
								selectedType: searchType,
								workspaceHint: workspaceHint,
							}),
						)
							.then((results) => {
								setFileSearchResults((results.results || []) as SearchResult[])
								setSearchLoading(false)
							})
							.catch((error) => {
								console.error("Error searching files:", error)
								setFileSearchResults([])
								setSearchLoading(false)
							})
					}, 200)
				} else {
					setSelectedMenuIndex(DEFAULT_CONTEXT_MENU_OPTION)
				}
			} else {
				setSearchQuery("")
				setSelectedMenuIndex(-1)
				setFileSearchResults([])
			}
			return show
		},
		[selectedType],
	)

	const handleMentionKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (!showContextMenu) return false

			if (event.key === "Escape") {
				setShowContextMenu(false)
				setSelectedType(null)
				setSelectedMenuIndex(DEFAULT_CONTEXT_MENU_OPTION)
				setSearchQuery("")
				return true
			}

			if (event.key === "ArrowUp" || event.key === "ArrowDown") {
				event.preventDefault()
				setSelectedMenuIndex((prevIndex) => {
					const direction = event.key === "ArrowUp" ? -1 : 1
					const options = getContextMenuOptions(searchQuery, selectedType, queryItems, fileSearchResults)
					const optionsLength = options.length

					if (optionsLength === 0) {
						return prevIndex
					}

					const selectableOptions = options.filter(
						(option) => option.type !== ContextMenuOptionType.URL && option.type !== ContextMenuOptionType.NoResults,
					)

					if (selectableOptions.length === 0) {
						return -1
					}

					const currentSelectableIndex = selectableOptions.indexOf(options[prevIndex])
					const newSelectableIndex =
						(currentSelectableIndex + direction + selectableOptions.length) % selectableOptions.length

					return options.indexOf(selectableOptions[newSelectableIndex])
				})
				return true
			}

			if ((event.key === "Enter" || event.key === "Tab") && selectedMenuIndex !== -1) {
				event.preventDefault()
				const selectedOption = getContextMenuOptions(searchQuery, selectedType, queryItems, fileSearchResults)[
					selectedMenuIndex
				]
				if (
					selectedOption &&
					selectedOption.type !== ContextMenuOptionType.URL &&
					selectedOption.type !== ContextMenuOptionType.NoResults
				) {
					const mentionValue = selectedOption.label?.includes(":") ? selectedOption.label : selectedOption.value
					handleMentionSelect(selectedOption.type, mentionValue)
				}
				return true
			}

			return false
		},
		[showContextMenu, searchQuery, selectedType, queryItems, fileSearchResults, selectedMenuIndex, handleMentionSelect],
	)

	const handleMentionDelete = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (justDeletedSpaceAfterMention) {
				const { newText, newPosition } = removeMention(inputValue, cursorPosition)
				if (newText !== inputValue) {
					event.preventDefault()
					setInputValue(newText)
					setIntendedCursorPosition(newPosition)
				}
				setJustDeletedSpaceAfterMention(false)
				setShowContextMenu(false)
				return true
			}
			return false
		},
		[justDeletedSpaceAfterMention, inputValue, cursorPosition, setInputValue, setIntendedCursorPosition],
	)

	const handleContextButtonClick = useCallback(() => {
		textAreaRef.current?.focus()

		if (!inputValue.trim()) {
			const _event = {
				target: {
					value: "@",
					selectionStart: 1,
				},
			} as React.ChangeEvent<HTMLTextAreaElement>
			setInputValue("@")
			setCursorPosition(1)
			updateMentionsMenu("@", 1)
			updateHighlights()
			return
		}

		if (inputValue.endsWith(" ")) {
			const newValue = `${inputValue}@`
			const newPos = inputValue.length + 1
			setInputValue(newValue)
			setCursorPosition(newPos)
			updateMentionsMenu(newValue, newPos)
			updateHighlights()
			return
		}

		const newValue = `${inputValue} @`
		const newPos = inputValue.length + 2
		setInputValue(newValue)
		setCursorPosition(newPos)
		updateMentionsMenu(newValue, newPos)
		updateHighlights()
	}, [inputValue, setInputValue, setCursorPosition, updateMentionsMenu, updateHighlights, textAreaRef])

	useEffect(() => {
		if (pendingInsertions.length === 0 || !textAreaRef.current) {
			return
		}

		const path = pendingInsertions[0]
		const currentTextArea = textAreaRef.current
		const currentValue = currentTextArea.value
		const currentCursorPos =
			intendedCursorPosition ?? (currentTextArea.selectionStart >= 0 ? currentTextArea.selectionStart : currentValue.length)

		const { newValue, mentionIndex } = insertMentionDirectly(currentValue, currentCursorPos, path)

		setInputValue(newValue)

		const newCursorPosition = mentionIndex + path.length + 2
		setIntendedCursorPosition(newCursorPosition)

		setPendingInsertions((prev) => prev.slice(1))
	}, [pendingInsertions, setInputValue, intendedCursorPosition, textAreaRef, setIntendedCursorPosition])

	return {
		showContextMenu,
		setShowContextMenu,
		selectedMenuIndex,
		setSelectedMenuIndex,
		searchQuery,
		setSearchQuery,
		selectedType,
		setSelectedType,
		fileSearchResults,
		setFileSearchResults,
		searchLoading,
		setSearchLoading,
		gitCommits,
		justDeletedSpaceAfterMention,
		setJustDeletedSpaceAfterMention,
		pendingInsertions,
		setPendingInsertions,
		contextMenuContainerRef,
		queryItems,
		handleMentionSelect,
		updateMentionsMenu,
		handleMentionKeyDown,
		handleMentionDelete,
		handleContextButtonClick,
	}
}
