import { mentionRegex, mentionRegexGlobal } from "@shared/context-mentions"
import { PlanActMode, TogglePlanActModeRequest } from "@shared/proto/codemarie/state"
import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { AtSignIcon, PlusIcon } from "lucide-react"
import type React from "react"
import { forwardRef, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import DynamicTextArea from "react-textarea-autosize"
import ContextMenu from "@/components/chat/components/layout/ContextMenu"
import SlashCommandMenu from "@/components/chat/components/layout/SlashCommandMenu"
import { useFileDragAndDrop } from "@/components/chat/hooks/useFileDragAndDrop"
import { useFilePaste } from "@/components/chat/hooks/useFilePaste"
import { useMentions } from "@/components/chat/hooks/useMentions"
import { useSlashCommands } from "@/components/chat/hooks/useSlashCommands"
import { useTextAreaHeight } from "@/components/chat/hooks/useTextAreaHeight"
import CodemarieRulesToggleModal from "@/components/codemarie-rules/CodemarieRulesToggleModal"
import { getModeSpecificFields, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import Thumbnails from "@/components/ui/thumbnails"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PLATFORM_CONFIG } from "@/config/platform.config"
import { useGlobalState } from "@/context/GlobalStateContext"
import { useNavigation } from "@/context/NavigationContext"
import { useMetaKeyDetection, useShortcut } from "@/hooks"
import { cn } from "@/lib/utils"
import { StateServiceClient } from "@/services/protobus-client"
import { isSafari } from "@/utils/platformUtils"
import { slashCommandDeleteRegex, slashCommandRegexGlobal, validateSlashCommand } from "@/utils/slash-commands"
import ServersToggleModal from "./ServersToggleModal"

// const { MAX_IMAGES_AND_FILES_PER_MESSAGE } = CHAT_CONSTANTS

interface ChatTextAreaProps {
	inputValue: string
	activeQuote: string | null
	setInputValue: (value: string) => void
	sendingDisabled: boolean
	placeholderText: string
	selectedFiles: string[]
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>
	onSend: () => void
	onSelectFilesAndImages: () => void
	shouldDisableFilesAndImages: boolean
	onHeightChange?: (height: number) => void
	onFocusChange?: (isFocused: boolean) => void
}

const PLAN_MODE_COLOR = "var(--vscode-activityWarningBadge-background)"

const ChatTextArea = forwardRef<HTMLTextAreaElement, ChatTextAreaProps>(
	(
		{
			inputValue,
			setInputValue,
			sendingDisabled,
			placeholderText,
			selectedFiles,
			selectedImages,
			setSelectedImages,
			setSelectedFiles,
			onSend,
			onSelectFilesAndImages,
			shouldDisableFilesAndImages,
			onHeightChange,
			onFocusChange,
		},
		ref,
	) => {
		const {
			mode,
			apiConfiguration,
			platform,
			localWorkflowToggles,
			globalWorkflowToggles,
			remoteWorkflowToggles,
			remoteConfigSettings,
			mcpServers,
		} = useGlobalState()
		const { navigateToSettingsModelPicker } = useNavigation()
		const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
		const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
		const [cursorPosition, setCursorPosition] = useState(0)
		const [intendedCursorPosition, setIntendedCursorPosition] = useState<number | null>(null)
		const highlightLayerRef = useRef<HTMLDivElement>(null)
		const [isMouseDownOnMenu, setIsMouseDownOnMenu] = useState(false)

		const [shownTooltipMode, setShownTooltipMode] = useState<Mode | null>(null)

		const [, metaKeyChar] = useMetaKeyDetection(platform)

		const { thumbnailsHeight, textAreaBaseHeight, handleThumbnailsHeightChange, handleTextAreaHeightChange } =
			useTextAreaHeight({
				selectedImages,
				selectedFiles,
				onHeightChange,
			})

		const updateHighlights = useCallback(() => {
			if (!textAreaRef.current || !highlightLayerRef.current) {
				return
			}

			let processedText = textAreaRef.current.value

			processedText = processedText
				.replace(/\n$/, "\n\n")
				.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] || c)
				// highlight @mentions
				.replace(mentionRegexGlobal, '<mark class="mention-context-textarea-highlight">$&</mark>')

			// Highlight only the FIRST valid /slash-command in the text
			// Only one slash command is processed per message, so we only highlight the first one
			slashCommandRegexGlobal.lastIndex = 0
			let hasHighlightedSlashCommand = false
			processedText = processedText.replace(slashCommandRegexGlobal, (match, prefix, command) => {
				// Only highlight the first valid slash command
				if (hasHighlightedSlashCommand) {
					return match
				}

				// Extract just the command name (without the slash)
				const commandName = command.substring(1)
				const isValidCommand = validateSlashCommand(
					commandName,
					localWorkflowToggles,
					globalWorkflowToggles,
					remoteWorkflowToggles,
					remoteConfigSettings?.remoteGlobalWorkflows,
				)

				if (isValidCommand) {
					hasHighlightedSlashCommand = true
					// Keep the prefix (whitespace or empty) and wrap the command in highlight
					return `${prefix}<mark class="mention-context-textarea-highlight">${command}</mark>`
				}
				return match
			})

			highlightLayerRef.current.innerHTML = processedText
			highlightLayerRef.current.scrollTop = textAreaRef.current.scrollTop
			highlightLayerRef.current.scrollLeft = textAreaRef.current.scrollLeft
		}, [localWorkflowToggles, globalWorkflowToggles, remoteWorkflowToggles, remoteConfigSettings])

		const {
			showContextMenu,
			setShowContextMenu,
			selectedMenuIndex,
			setSelectedMenuIndex,
			searchQuery,
			selectedType,
			fileSearchResults,
			searchLoading,
			contextMenuContainerRef,
			queryItems,
			handleMentionSelect,
			updateMentionsMenu,
			handleMentionKeyDown,
			handleMentionDelete,
			handleContextButtonClick,
			setJustDeletedSpaceAfterMention,
			setPendingInsertions,
		} = useMentions({
			inputValue,
			setInputValue,
			cursorPosition,
			setCursorPosition,
			setIntendedCursorPosition,
			intendedCursorPosition,
			textAreaRef,
			updateHighlights,
		})

		const {
			showSlashCommandsMenu,
			setShowSlashCommandsMenu,
			selectedSlashCommandsIndex,
			setSelectedSlashCommandsIndex,
			slashCommandsQuery,
			slashCommandsMenuContainerRef,
			handleSlashCommandsSelect,
			updateSlashCommandsMenu,
			handleSlashCommandKeyDown,
			handleSlashCommandDelete,
			setJustDeletedSpaceAfterSlashCommand,
		} = useSlashCommands({
			inputValue,
			setInputValue,
			cursorPosition,
			setCursorPosition,
			setIntendedCursorPosition,
			textAreaRef,
			localWorkflowToggles,
			globalWorkflowToggles,
			remoteWorkflowToggles: remoteWorkflowToggles || {},
			remoteGlobalWorkflows: remoteConfigSettings?.remoteGlobalWorkflows || [],
			mcpServers,
		})

		const { handlePaste, showDimensionError: pasteDimensionError } = useFilePaste({
			inputValue,
			setInputValue,
			cursorPosition,
			setCursorPosition,
			setIntendedCursorPosition,
			selectedImages,
			setSelectedImages,
			selectedFiles,
			shouldDisableFilesAndImages,
			setShowContextMenu,
			textAreaRef,
		})

		const {
			handleDragEnter,
			onDragOver,
			handleDragLeave,
			onDrop,
			isDraggingOver,
			showUnsupportedFileError,
			showDimensionError: dropDimensionError,
		} = useFileDragAndDrop({
			inputValue,
			setInputValue,
			cursorPosition,
			setCursorPosition,
			setIntendedCursorPosition,
			selectedImages,
			setSelectedImages,
			selectedFiles,
			shouldDisableFilesAndImages,
			setPendingInsertions,
			textAreaRef,
		})

		const showDimensionError = pasteDimensionError || dropDimensionError

		const handleKeyDown = useCallback(
			(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
				const isSelectAllShortcut =
					(event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a"
				if (isSelectAllShortcut) {
					event.preventDefault()
					event.stopPropagation()
					const textArea = event.currentTarget
					textArea.setSelectionRange(0, textArea.value.length)
					setCursorPosition(0)
					return
				}

				if (handleSlashCommandKeyDown(event)) return
				if (handleMentionKeyDown(event)) return

				// Safari does not support InputEvent.isComposing (always false), so we need to fallback to keyCode === 229 for it
				const isComposing = isSafari ? event.nativeEvent.keyCode === 229 : (event.nativeEvent?.isComposing ?? false)
				if (event.key === "Enter" && !event.shiftKey && !isComposing) {
					event.preventDefault()

					if (!sendingDisabled) {
						setIsTextAreaFocused(false)
						onSend()
					}
				}

				if (event.key === "Backspace" && !isComposing) {
					const charBeforeCursor = inputValue[cursorPosition - 1]
					const charAfterCursor = inputValue[cursorPosition + 1]

					const charBeforeIsWhitespace =
						charBeforeCursor === " " || charBeforeCursor === "\n" || charBeforeCursor === "\r\n"
					const charAfterIsWhitespace =
						charAfterCursor === " " || charAfterCursor === "\n" || charAfterCursor === "\r\n"

					// Check if we're right after a space that follows a mention or slash command
					if (
						charBeforeIsWhitespace &&
						inputValue.slice(0, cursorPosition - 1).match(new RegExp(`${mentionRegex.source}$`))
					) {
						// File mention handling
						const newCursorPosition = cursorPosition - 1
						if (!charAfterIsWhitespace) {
							event.preventDefault()
							textAreaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition)
							setCursorPosition(newCursorPosition)
						}
						setCursorPosition(newCursorPosition)
						setJustDeletedSpaceAfterMention(true)
						setJustDeletedSpaceAfterSlashCommand(false)
					} else if (charBeforeIsWhitespace && inputValue.slice(0, cursorPosition - 1).match(slashCommandDeleteRegex)) {
						// New slash command handling
						const newCursorPosition = cursorPosition - 1
						if (!charAfterIsWhitespace) {
							event.preventDefault()
							textAreaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition)
							setCursorPosition(newCursorPosition)
						}
						setCursorPosition(newCursorPosition)
						setJustDeletedSpaceAfterSlashCommand(true)
						setJustDeletedSpaceAfterMention(false)
					}
					// Handle the second backspace press for mentions or slash commands
					else if (handleMentionDelete(event)) {
						// Handled in hook
					} else if (handleSlashCommandDelete(event)) {
						// Handled in hook
					}
					// Default case - reset flags if none of the above apply
					else {
						setJustDeletedSpaceAfterMention(false)
						setJustDeletedSpaceAfterSlashCommand(false)
					}
				}
			},
			[
				onSend,
				sendingDisabled,
				handleSlashCommandKeyDown,
				handleMentionKeyDown,
				inputValue,
				cursorPosition,
				handleMentionDelete,
				handleSlashCommandDelete,
				setJustDeletedSpaceAfterMention,
				setJustDeletedSpaceAfterSlashCommand,
			],
		)

		// Effect to set cursor position after state updates
		useLayoutEffect(() => {
			if (intendedCursorPosition !== null && textAreaRef.current) {
				textAreaRef.current.setSelectionRange(intendedCursorPosition, intendedCursorPosition)
				setIntendedCursorPosition(null) // Reset the state after applying
			}
		}, [intendedCursorPosition])

		const handleInputChange = useCallback(
			(e: React.ChangeEvent<HTMLTextAreaElement>) => {
				const newValue = e.target.value
				const newCursorPosition = e.target.selectionStart
				setInputValue(newValue)
				setCursorPosition(newCursorPosition)

				const isSlashVisible = updateSlashCommandsMenu(newValue, newCursorPosition)
				if (!isSlashVisible) {
					updateMentionsMenu(newValue, newCursorPosition)
				} else {
					setShowContextMenu(false)
				}
			},
			[setInputValue, updateSlashCommandsMenu, updateMentionsMenu, setShowContextMenu],
		)

		const handleBlur = useCallback(() => {
			// Only hide the context menu if the user didn't click on it
			if (!isMouseDownOnMenu) {
				setShowContextMenu(false)
				setShowSlashCommandsMenu(false)
			}
			setIsTextAreaFocused(false)
			onFocusChange?.(false) // Call prop on blur
		}, [isMouseDownOnMenu, onFocusChange, setShowContextMenu, setShowSlashCommandsMenu])

		const handleMenuMouseDown = useCallback(() => {
			setIsMouseDownOnMenu(true)
		}, [])

		useLayoutEffect(() => {
			updateHighlights()
		}, [updateHighlights])

		const updateCursorPosition = useCallback(() => {
			if (textAreaRef.current) {
				setCursorPosition(textAreaRef.current.selectionStart)
			}
		}, [])

		const handleKeyUp = useCallback(
			(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
					updateCursorPosition()
				}
			},
			[updateCursorPosition],
		)

		const onModeToggle = useCallback(() => {
			void (async () => {
				const convertedProtoMode = mode === "plan" ? PlanActMode.ACT : PlanActMode.PLAN
				const response = await StateServiceClient.togglePlanActModeProto(
					TogglePlanActModeRequest.create({
						mode: convertedProtoMode,
						chatContent: {
							message: inputValue.trim() ? inputValue : undefined,
							images: selectedImages,
							files: selectedFiles,
						},
					}),
				)
				// Focus the textarea after mode toggle with slight delay
				setTimeout(() => {
					if (response.value) {
						setInputValue("")
					}
					textAreaRef.current?.focus()
				}, 100)
			})()
		}, [mode, inputValue, selectedImages, selectedFiles, setInputValue])

		useShortcut(PLATFORM_CONFIG.togglePlanActKeys, onModeToggle, { disableTextInputs: false })

		const handleModelButtonClick = () => {
			navigateToSettingsModelPicker({ targetSection: "api-config" })
		}

		// Get model display name
		const modelDisplayName = useMemo(() => {
			const { selectedProvider, selectedModelId } = normalizeApiConfiguration(apiConfiguration, mode)
			const {
				vsCodeLmModelSelector,
				togetherModelId,
				lmStudioModelId,
				ollamaModelId,
				liteLlmModelId,
				requestyModelId,
				vercelAiGatewayModelId,
			} = getModeSpecificFields(apiConfiguration, mode)
			const unknownModel = "unknown"

			if (!apiConfiguration) {
				return unknownModel
			}
			switch (selectedProvider) {
				case "codemarie":
					return `${selectedProvider}:${selectedModelId}`
				case "openai":
					return `openai-compat:${selectedModelId}`
				case "vscode-lm":
					return `vscode-lm:${vsCodeLmModelSelector ? `${vsCodeLmModelSelector.vendor ?? ""}/${vsCodeLmModelSelector.family ?? ""}` : unknownModel}`
				case "together":
					return `${selectedProvider}:${togetherModelId}`
				case "lmstudio":
					return `${selectedProvider}:${lmStudioModelId}`
				case "ollama":
					return `${selectedProvider}:${ollamaModelId}`
				case "litellm":
					return `${selectedProvider}:${liteLlmModelId}`
				case "requesty":
					return `${selectedProvider}:${requestyModelId}`
				case "vercel-ai-gateway":
					return `${selectedProvider}:${vercelAiGatewayModelId || selectedModelId}`
				default:
					return `${selectedProvider}:${selectedModelId}`
			}
		}, [apiConfiguration, mode])
		const togglePlanActKeys = PLATFORM_CONFIG.togglePlanActKeys
			.replace("Meta", metaKeyChar)
			.replace(/.$/, (match) => match.toUpperCase())

		return (
			<div>
				<div
					className="relative flex transition-colors ease-in-out duration-100 px-3.5 py-2.5"
					onDragEnter={handleDragEnter}
					onDragLeave={handleDragLeave}
					onDragOver={onDragOver}
					onDrop={onDrop}
					role="presentation">
					{showDimensionError && (
						<div className="absolute inset-2.5 bg-[rgba(var(--vscode-errorForeground-rgb),0.1)] border-2 border-error rounded-xs flex items-center justify-center z-10 pointer-events-none">
							<span className="text-error font-bold text-xs text-center">Image dimensions exceed 7500px</span>
						</div>
					)}
					{showUnsupportedFileError && (
						<div className="absolute inset-2.5 bg-[rgba(var(--vscode-errorForeground-rgb),0.1)] border-2 border-error rounded-xs flex items-center justify-center z-10 pointer-events-none">
							<span className="text-error font-bold text-xs">Files other than images are currently disabled</span>
						</div>
					)}
					{showSlashCommandsMenu && (
						<div ref={slashCommandsMenuContainerRef}>
							<SlashCommandMenu
								globalWorkflowToggles={globalWorkflowToggles}
								localWorkflowToggles={localWorkflowToggles}
								mcpServers={mcpServers}
								onMouseDown={handleMenuMouseDown}
								onSelect={handleSlashCommandsSelect}
								query={slashCommandsQuery}
								remoteWorkflows={remoteConfigSettings?.remoteGlobalWorkflows}
								remoteWorkflowToggles={remoteWorkflowToggles}
								selectedIndex={selectedSlashCommandsIndex}
								setSelectedIndex={setSelectedSlashCommandsIndex}
							/>
						</div>
					)}

					{showContextMenu && (
						<div ref={contextMenuContainerRef}>
							<ContextMenu
								dynamicSearchResults={fileSearchResults}
								isLoading={searchLoading}
								onMouseDown={handleMenuMouseDown}
								onSelect={handleMentionSelect}
								queryItems={queryItems}
								searchQuery={searchQuery}
								selectedIndex={selectedMenuIndex}
								selectedType={selectedType}
								setSelectedIndex={setSelectedMenuIndex}
							/>
						</div>
					)}
					<div
						className={cn(
							"absolute bottom-2.5 top-2.5 whitespace-pre-wrap break-words rounded-xs overflow-hidden bg-input-background",
							isTextAreaFocused ? "left-3.5 right-3.5" : "left-3.5 right-3.5 border border-input-border",
						)}
						ref={highlightLayerRef}
						style={{
							position: "absolute",
							pointerEvents: "none",
							whiteSpace: "pre-wrap",
							wordWrap: "break-word",
							color: "transparent",
							overflow: "hidden",
							fontFamily: "var(--vscode-font-family)",
							fontSize: "var(--vscode-editor-font-size)",
							lineHeight: "var(--vscode-editor-line-height)",
							borderRadius: 2,
							borderLeft: isTextAreaFocused ? 0 : undefined,
							borderRight: isTextAreaFocused ? 0 : undefined,
							borderTop: isTextAreaFocused ? 0 : undefined,
							borderBottom: isTextAreaFocused ? 0 : undefined,
							padding: `9px 28px ${9 + thumbnailsHeight}px 9px`,
						}}
					/>
					<DynamicTextArea
						autoFocus={true}
						data-testid="chat-input"
						maxRows={10}
						minRows={3}
						onBlur={handleBlur}
						onChange={(e) => {
							handleInputChange(e)
							updateHighlights()
						}}
						onFocus={() => {
							setIsTextAreaFocused(true)
							onFocusChange?.(true)
						}}
						onHeightChange={handleTextAreaHeightChange}
						onKeyDown={handleKeyDown}
						onKeyUp={handleKeyUp}
						onMouseUp={updateCursorPosition}
						onPaste={handlePaste}
						onScroll={() => updateHighlights()}
						onSelect={updateCursorPosition}
						placeholder={showUnsupportedFileError || showDimensionError ? "" : placeholderText}
						ref={(el) => {
							if (typeof ref === "function") {
								ref(el)
							} else if (ref) {
								ref.current = el
							}
							textAreaRef.current = el
						}}
						style={{
							width: "100%",
							boxSizing: "border-box",
							backgroundColor: "transparent",
							color: "var(--vscode-input-foreground)",
							borderRadius: 2,
							fontFamily: "var(--vscode-font-family)",
							fontSize: "var(--vscode-editor-font-size)",
							lineHeight: "var(--vscode-editor-line-height)",
							resize: "none",
							overflowX: "hidden",
							overflowY: "scroll",
							scrollbarWidth: "none",
							borderLeft: 0,
							borderRight: 0,
							borderTop: 0,
							borderBottom: `${thumbnailsHeight}px solid transparent`,
							borderColor: "transparent",
							padding: "9px 28px 9px 9px",
							cursor: "text",
							flex: 1,
							zIndex: 1,
							outline:
								isDraggingOver && !showUnsupportedFileError
									? "2px dashed var(--vscode-focusBorder)"
									: isTextAreaFocused
										? `1px solid ${mode === "plan" ? PLAN_MODE_COLOR : "var(--vscode-focusBorder)"}`
										: "none",
							outlineOffset: isDraggingOver && !showUnsupportedFileError ? "1px" : "0px",
						}}
						value={inputValue}
					/>
					{!inputValue && selectedImages.length === 0 && selectedFiles.length === 0 && (
						<div className="text-xs absolute bottom-5 left-6.5 right-16 text-(--vscode-input-placeholderForeground)/50 whitespace-nowrap overflow-hidden text-ellipsis pointer-events-none z-1">
							Type @ for context, / for slash commands & workflows, hold shift to drag in files/images
						</div>
					)}
					{(selectedImages.length > 0 || selectedFiles.length > 0) && (
						<Thumbnails
							files={selectedFiles}
							images={selectedImages}
							onHeightChange={handleThumbnailsHeightChange}
							setFiles={setSelectedFiles}
							setImages={setSelectedImages}
							style={{
								position: "absolute",
								paddingTop: 4,
								bottom: 14,
								left: 22,
								right: 47,
								zIndex: 2,
							}}
						/>
					)}
					<div
						className="absolute flex items-end bottom-4.5 right-5 z-10 h-8 text-xs"
						style={{ height: textAreaBaseHeight }}>
						<div className="flex flex-row items-center">
							<button
								className={cn(
									"input-icon-button",
									{ disabled: sendingDisabled },
									"codicon codicon-send text-sm bg-transparent border-none p-0 cursor-pointer block",
								)}
								data-testid="send-button"
								onClick={() => {
									if (!sendingDisabled) {
										setIsTextAreaFocused(false)
										onSend()
									}
								}}
								type="button"
							/>
						</div>
					</div>
				</div>
				<div className="flex justify-between items-center -mt-[2px] px-3 pb-2">
					<div className="relative flex-1 min-w-0 h-5">
						<div className="absolute top-0 left-0 right-0 ease-in-out w-full h-5 z-10 flex items-center gap-1">
							<Tooltip>
								<TooltipContent>Add Context</TooltipContent>
								<TooltipTrigger>
									<VSCodeButton
										appearance="icon"
										aria-label="Add Context"
										className="p-0 m-0 flex items-center"
										data-testid="context-button"
										onClick={handleContextButtonClick}>
										<AtSignIcon size={12} />
									</VSCodeButton>
								</TooltipTrigger>
							</Tooltip>

							<Tooltip>
								<TooltipContent>Add Files & Images</TooltipContent>
								<TooltipTrigger>
									<VSCodeButton
										appearance="icon"
										aria-label="Add Files & Images"
										className="p-0 m-0 flex items-center"
										data-testid="files-button"
										disabled={shouldDisableFilesAndImages}
										onClick={() => {
											if (!shouldDisableFilesAndImages) {
												onSelectFilesAndImages()
											}
										}}>
										<PlusIcon size={13} />
									</VSCodeButton>
								</TooltipTrigger>
							</Tooltip>

							<ServersToggleModal />

							<CodemarieRulesToggleModal />

							<div className="flex-1 min-w-0" />
							<VSCodeButton
								appearance="icon"
								className="text-xs px-2 h-5 min-w-0 flex items-center"
								onClick={handleModelButtonClick}
								title="Open API Settings">
								<span className="truncate">{modelDisplayName}</span>
							</VSCodeButton>
						</div>
					</div>
					<Tooltip>
						<TooltipContent
							className="text-xs px-2 flex flex-col gap-1"
							hidden={shownTooltipMode === null}
							side="top">
							{`In ${shownTooltipMode === "act" ? "Act" : "Plan"}  mode, Codemarie will ${shownTooltipMode === "act" ? "complete the task immediately" : "gather information to architect a plan"}`}
							<p className="text-description/80 text-xs mb-0">
								Toggle w/ <kbd className="text-muted-foreground mx-1">{togglePlanActKeys}</kbd>
							</p>
						</TooltipContent>
						<TooltipTrigger>
							<div
								className="flex items-center gap-1 bg-input-background border border-input-border rounded-full p-0.5 cursor-pointer relative w-24 h-6"
								data-testid="mode-switch"
								onClick={onModeToggle}>
								<div
									className={cn(
										"absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-full transition-all duration-200",
										mode === "plan"
											? "left-0.5 bg-(--vscode-activityWarningBadge-background)"
											: "left-[calc(50%+1px)] bg-(--vscode-focusBorder)",
									)}
								/>
								{["Plan", "Act"].map((m) => (
									<div
										aria-checked={mode === m.toLowerCase()}
										className={cn(
											"z-10 text-xs w-1/2 text-center",
											mode === m.toLowerCase() ? "text-white" : "text-input-foreground",
										)}
										key={m}
										onMouseLeave={() => setShownTooltipMode(null)}
										onMouseOver={() => setShownTooltipMode(m.toLowerCase() as Mode)}
										role="switch">
										{m}
									</div>
								))}
							</div>
						</TooltipTrigger>
					</Tooltip>
				</div>
			</div>
		)
	},
)

export default ChatTextArea
