import { useEffect } from "react"
import { SystemServiceClient } from "@/services/protobus-client"
import type { ChatState } from "../types/chatTypes"

/**
 * Hook to manage event subscriptions for the chat view.
 * Extracted from ChatView.tsx for better modularity.
 */
export const useChatSubscriptions = (
	isHidden: boolean,
	chatState: ChatState,
	setInputValue: React.Dispatch<React.SetStateAction<string>>,
) => {
	const { textAreaRef, sendingDisabled, enableButtons } = chatState

	// Subscribe to show webview events from the backend
	useEffect(() => {
		const cleanup = SystemServiceClient.subscribeToShowWebview(
			{},
			{
				onResponse: (event) => {
					// Only focus if not hidden and preserveEditorFocus is false
					if (!isHidden && !event.preserveEditorFocus) {
						textAreaRef.current?.focus()
					}
				},
				onError: (error) => {
					console.error("Error in showWebview subscription:", error)
				},
				onComplete: () => {
					console.log("showWebview subscription completed")
				},
			},
		)

		return cleanup
	}, [isHidden, textAreaRef])

	// Set up addToInput subscription
	useEffect(() => {
		const cleanup = SystemServiceClient.subscribeToAddToInput(
			{},
			{
				onResponse: (event) => {
					if (event.value) {
						setInputValue((prevValue) => {
							const newText = event.value
							const newTextWithNewline = `${newText}\n`
							return prevValue ? `${prevValue}\n${newTextWithNewline}` : newTextWithNewline
						})
						// Auto focus the input and start the cursor on a new line for easy typing
						setTimeout(() => {
							if (textAreaRef.current) {
								textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight
								textAreaRef.current.focus()
							}
						}, 0)
					}
				},
				onError: (error) => {
					console.error("Error in addToInput subscription:", error)
				},
				onComplete: () => {
					console.log("addToInput subscription completed")
				},
			},
		)

		return cleanup
	}, [setInputValue, textAreaRef])

	// Auto focus timer
	useEffect(() => {
		const timer = setTimeout(() => {
			if (!isHidden && !sendingDisabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		}, 50)
		return () => {
			clearTimeout(timer)
		}
	}, [isHidden, sendingDisabled, enableButtons, textAreaRef])
}
