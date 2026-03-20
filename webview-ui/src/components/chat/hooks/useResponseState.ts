import type { CodemarieMessage } from "@shared/ExtensionMessage"
import { useMemo } from "react"
import { isToolGroup } from "../utils/messageUtils"

/**
 * Hook to determine if the chat is currently waiting for a response from the assistant.
 * Extracted from MessagesArea.tsx for better modularity.
 */
export const useResponseState = (
	modifiedMessages: CodemarieMessage[],
	codemarieMessages: CodemarieMessage[],
	groupedMessages: (CodemarieMessage | CodemarieMessage[])[],
) => {
	const lastRawMessage = useMemo(() => codemarieMessages.at(-1), [codemarieMessages])

	const lastVisibleRow = useMemo(() => groupedMessages.at(-1), [groupedMessages])
	const lastVisibleMessage = useMemo(() => {
		const lastRow = lastVisibleRow
		if (!lastRow) return undefined
		return Array.isArray(lastRow) ? lastRow.at(-1) : lastRow
	}, [lastVisibleRow])

	const isWaitingForResponse = useMemo(() => {
		const lastMsg = modifiedMessages[modifiedMessages.length - 1]

		// Never show thinking while waiting on user input (any ask state).
		if (lastRawMessage?.type === "ask") return false

		// attempt_completion emits a final say("completion_result") before ask("completion_result").
		if (lastRawMessage?.type === "say" && lastRawMessage.say === "completion_result") return false

		if (lastRawMessage?.type === "say" && lastRawMessage.say === "api_req_started") {
			try {
				const info = JSON.parse(lastRawMessage.text || "{}")
				if (info.cancelReason === "user_cancelled") return false
			} catch {
				/* ignore */
			}
		}

		// Always show while task has started but no visible rows are rendered yet.
		if (groupedMessages.length === 0) return true
		if (!lastVisibleMessage) return true

		// Always show when the last rendered row is a toolgroup.
		if (lastVisibleRow && isToolGroup(lastVisibleRow)) return true

		// If the last visible row is not actively partial, always show Thinking in the footer.
		if (lastVisibleMessage.partial !== true) return true

		if (!lastMsg) return true
		if (lastMsg.say === "user_feedback" || lastMsg.say === "user_feedback_diff") return true
		if (lastMsg.say === "api_req_started") {
			try {
				const info = JSON.parse(lastMsg.text || "{}")
				return info.cost == null
			} catch {
				return true
			}
		}
		return false
	}, [lastRawMessage, groupedMessages.length, lastVisibleMessage, lastVisibleRow, modifiedMessages])

	const showThinkingLoaderRow = useMemo(() => {
		const handoffToReasoningPending =
			lastRawMessage?.type === "say" &&
			lastRawMessage.say === "reasoning" &&
			lastRawMessage.partial === true &&
			lastVisibleMessage?.say !== "reasoning"

		return isWaitingForResponse || handoffToReasoningPending
	}, [isWaitingForResponse, lastRawMessage, lastVisibleMessage?.say])

	return {
		isWaitingForResponse,
		showThinkingLoaderRow,
		lastVisibleMessage,
	}
}
