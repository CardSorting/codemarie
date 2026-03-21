/**
 * React Context for task state management in CLI
 * Provides access to ExtensionState and task controller
 */

import { Controller } from "@core/controller"
import type { CodemarieMessage, ExtensionState } from "@shared/ExtensionMessage"
import { SystemUpdate } from "@shared/proto/codemarie/system"
import { convertProtoToCodemarieMessage } from "@shared/proto-conversions/codemarie-message"
import React, { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react"

interface TaskContextType {
	state: Partial<ExtensionState>
	controller: Controller
	isComplete: boolean
	setIsComplete: (complete: boolean) => void
	lastError: string | null
	setLastError: (error: string | null) => void
	clearState: () => void
}

const TaskContext = createContext<TaskContextType | undefined>(undefined)

interface TaskContextProviderProps {
	controller: Controller
	children: ReactNode
}

export const TaskContextProvider: React.FC<TaskContextProviderProps> = ({ controller, children }) => {
	const [state, setState] = useState<Partial<ExtensionState>>(
		() =>
			({
				codemarieMessages: [],
				currentTaskItem: null,
			}) as unknown as Partial<ExtensionState>,
	)
	const [isComplete, setIsComplete] = useState(false)
	const [lastError, setLastError] = useState<string | null>(null)

	// Use ref to track latest state for partial message callback
	const stateRef = useRef(state)
	stateRef.current = state

	// Subscribe to controller state updates
	useEffect(() => {
		const originalPostState = controller.postStateToWebview.bind(controller)

		const handleStateUpdate = async () => {
			try {
				const newState = await controller.getStateToPostToWebview()
				// Ignore transient empty messages state during cancel/reinit
				// When clearTask() runs, messages briefly become [] before new task loads them
				const hadMessages = (stateRef.current.codemarieMessages?.length ?? 0) > 0
				const hasMessages = (newState.codemarieMessages?.length ?? 0) > 0
				if (hadMessages && !hasMessages) {
					return
				}
				setState(newState)
			} catch (error) {
				setLastError(error instanceof Error ? error.message : String(error))
			}
		}

		// Override postStateToWebview to update React state
		controller.postStateToWebview = async () => {
			await originalPostState()
			await handleStateUpdate()
		}

		// Subscribe to partial message events (for streaming updates) via unified system stream
		const partialMessageHandler = (update: SystemUpdate) => {
			if (update.partialMessage) {
				const updatedMessage = convertProtoToCodemarieMessage(update.partialMessage) as CodemarieMessage
				setState((prevState) => {
					const messages = prevState.codemarieMessages || []
					// Find and update the message by timestamp
					const index = messages.findIndex((m) => m.ts === updatedMessage.ts)
					if (index >= 0) {
						const newMessages = [...messages]
						newMessages[index] = updatedMessage
						return { ...prevState, codemarieMessages: newMessages }
					}
					return prevState
				})
			}
		}

		const { addSystemSubscription } = require("@core/controller/system/SystemUpdatesEmitter")
		addSystemSubscription(partialMessageHandler)

		// Get initial state
		handleStateUpdate()

		// Cleanup
		return () => {
			controller.postStateToWebview = originalPostState
			const { removeSystemSubscription } = require("@core/controller/system/SystemUpdatesEmitter")
			removeSystemSubscription(partialMessageHandler)
		}
	}, [controller])

	// Force clear state (bypasses the empty messages check for intentional clears like /clear)
	const clearState = () => {
		setState({
			codemarieMessages: [],
			currentTaskItem: null,
		} as unknown as Partial<ExtensionState>)
	}

	const value: TaskContextType = {
		state,
		controller,
		isComplete,
		setIsComplete,
		lastError,
		setLastError,
		clearState,
	}

	return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>
}

/**
 * Hook to access task context
 */
export const useTaskContext = (): TaskContextType => {
	const context = useContext(TaskContext)
	if (!context) {
		throw new Error("useTaskContext must be used within TaskContextProvider")
	}
	return context
}

/**
 * Hook to access task state only
 */
export const useTaskState = (): Partial<ExtensionState> => {
	const { state } = useTaskContext()
	return state
}

/**
 * Hook to access controller
 */
export const useTaskController = () => {
	const { controller } = useTaskContext()
	return controller
}
