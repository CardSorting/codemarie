import type { CodemarieMessage } from "@shared/ExtensionMessage"
import { Box, Text, useApp } from "ink"
import React, { useCallback, useState } from "react"
import type { Controller } from "@/core/controller"
import { useTaskContext } from "../context/TaskContext"
import { useChatInput } from "../hooks/useChatInput"
import { useGitStats } from "../hooks/useGitStats"
import { useIsSpinnerActive } from "../hooks/useStateSubscriber"
import { shutdownEvent } from "../vscode-shim"
import { getButtonConfig } from "./ActionButtons"
import { ChatHeader } from "./ChatHeader"
import { ChatInputArea } from "./ChatInputArea"
import { ChatMessageList } from "./ChatMessageList"
import { ChatStatusArea } from "./ChatStatusArea"

interface ChatViewProps {
	controller: Controller
	isExiting?: boolean
	globalHooks?: any[]
	globalSkills?: any[]
	hooksEnabled?: boolean
	initialImages?: string[]
	onNavigateToSettings?: () => void
	onToggleHook?: (isGlobal: boolean, hookName: string, enabled: boolean, workspaceName?: string) => void
	onToggleSkill?: (isGlobal: boolean, skillPath: string, enabled: boolean) => void
	skillsEnabled?: boolean
	workspaceHooks?: any[]
	initialPrompt?: string
	localSkills?: any[]
	onComplete?: () => void
	onError?: () => void
	onExit?: () => void
	onViewChange?: (view: any) => void
	taskId?: string
}

export const ChatView: React.FC<ChatViewProps> = ({ controller, isExiting = false, onExit, taskId }) => {
	const { state } = useTaskContext()
	const { exit } = useApp()
	const [internalIsExiting, setInternalIsExiting] = useState(false)

	React.useEffect(() => {
		const disposable = shutdownEvent.event(() => {
			setInternalIsExiting(true)
		})
		return () => disposable.dispose()
	}, [])

	const effectiveIsExiting = isExiting || internalIsExiting
	const messages = state.codemarieMessages || []
	const { isActive: isSpinnerActive, startTime: spinnerStartTime } = useIsSpinnerActive()

	const workspaceRoots = controller?.stateManager.getGlobalStateKey("workspaceRoots")
	const primaryRootIndex = controller?.stateManager.getGlobalStateKey("primaryRootIndex") || 0
	const workspacePath = (workspaceRoots?.[primaryRootIndex]?.path as string) || process.cwd()
	const { gitBranch, gitDiffStats } = useGitStats(workspacePath)

	// Declare setTextInput and setCursorPos refs to allow submitMessage to access them
	// even if submitMessage is defined before useChatInput.
	const setTextInputRef = React.useRef<(text: string) => void>(() => {})
	const setCursorPosRef = React.useRef<(pos: number) => void>(() => {})

	const submitMessage = useCallback(
		async (text: string) => {
			const textToSubmit = text.trim()
			if (!textToSubmit) return

			if (textToSubmit === "/q" || textToSubmit === "/exit") {
				onExit?.()
				exit()
				return
			}

			setTextInputRef.current("")
			setCursorPosRef.current(0)

			try {
				const lastMessage = messages[messages.length - 1] as CodemarieMessage | undefined
				if (lastMessage?.type === "ask" && controller?.task) {
					await controller.task.handleWebviewAskResponse("messageResponse" as any, textToSubmit)
				} else {
					await controller?.initTask(textToSubmit)
				}
			} catch (error) {
				console.error("Failed to submit message:", error)
			}
		},
		[onExit, exit, controller, messages],
	)

	const {
		text: textInput,
		setText: setTextInput,
		setCursorPos,
		cursorPos,
		fileResults,
		selectedIndex,
		isSearching,
		filteredCommands,
		selectedSlashIndex,
		slashInfo,
		showSlashMenu,
		handleKeyboardSequence: handleKeyboardSequenceInternal,
	} = useChatInput({
		controller,
		storageKey: `chatInput-${taskId || "default"}`,
		onSubmit: (text) => submitMessage(text),
	})

	// Update refs after useChatInput provides the actual setters
	React.useEffect(() => {
		setTextInputRef.current = setTextInput
		setCursorPosRef.current = setCursorPos
	}, [setTextInput, setCursorPos])

	const handleKeyboardSequence = useCallback(
		(input: string, key: any) => {
			const handled = handleKeyboardSequenceInternal(input, key)
			if (!handled && key.return) {
				submitMessage(textInput)
				return true
			}
			return handled
		},
		[handleKeyboardSequenceInternal, textInput, submitMessage],
	)

	const lastMessage = messages[messages.length - 1]
	const buttonConfig = getButtonConfig(lastMessage, isSpinnerActive)

	const apiConfig = state.apiConfiguration
	const modelId = apiConfig?.actModeApiModelId || "claude-3-5-sonnet-20241022"

	return (
		<Box flexDirection="column" height="100%" width="100%">
			<ChatHeader />

			<Box flexDirection="column" flexGrow={1} width="100%">
				<ChatMessageList messages={messages} />
			</Box>

			<ChatStatusArea
				gitBranch={gitBranch}
				gitDiffStats={gitDiffStats}
				isExiting={effectiveIsExiting}
				isSpinnerActive={isSpinnerActive}
				modelId={modelId}
				spinnerStartTime={spinnerStartTime}
			/>
			<Box paddingLeft={1}>
				<Text color="gray">Auto-approve</Text>
			</Box>

			<ChatInputArea
				buttonConfig={buttonConfig}
				cursorPos={cursorPos}
				fileResults={fileResults}
				filteredCommands={filteredCommands}
				isExiting={effectiveIsExiting}
				isLoading={isSearching}
				mode="act"
				onButtonAction={() => {}}
				onKeyboardSequence={handleKeyboardSequence}
				placeholder="Message Codemarie..."
				query={slashInfo.query}
				selectedIndex={selectedIndex}
				selectedSlashIndex={selectedSlashIndex}
				showSlashMenu={showSlashMenu}
				textInput={textInput}
			/>
		</Box>
	)
}
