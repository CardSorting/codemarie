import { CodemarieMessage } from "@shared/ExtensionMessage"
import { useEffect, useRef } from "react"

export const useAutoExpand = (message: CodemarieMessage, isLast: boolean) => {
	const hasAutoExpandedRef = useRef(false)
	const hasAutoCollapsedRef = useRef(false)
	const prevIsLastRef = useRef(isLast)

	// Auto-expand completion output when it's the last message (runs once per message)
	useEffect(() => {
		const isCompletionResult = message.ask === "completion_result" || message.say === "completion_result"

		// Auto-expand if it's last and we haven't already auto-expanded
		if (isLast && isCompletionResult && !hasAutoExpandedRef.current) {
			hasAutoExpandedRef.current = true
			hasAutoCollapsedRef.current = false // Reset the auto-collapse flag when expanding
		}
	}, [isLast, message.ask, message.say])

	// Auto-collapse completion output ONCE when transitioning from last to not-last
	useEffect(() => {
		const isCompletionResult = message.ask === "completion_result" || message.say === "completion_result"
		const wasLast = prevIsLastRef.current

		// Only auto-collapse if transitioning from last to not-last, and we haven't already auto-collapsed
		if (wasLast && !isLast && isCompletionResult && !hasAutoCollapsedRef.current) {
			hasAutoCollapsedRef.current = true
			hasAutoExpandedRef.current = false // Reset the auto-expand flag when collapsing
		}

		prevIsLastRef.current = isLast
	}, [isLast, message.ask, message.say])
}
