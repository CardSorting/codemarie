import { EmptyRequest } from "@shared/proto/codemarie/common"
import { State } from "@shared/proto/codemarie/state"
import { StateUpdate } from "@shared/proto/codemarie/system"
import deepEqual from "fast-deep-equal"
import { ExtensionState } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../index"
import { getProtobusRequestRegistry, StreamingResponseHandler } from "../protobus-handler"
import { broadcastStateUpdate } from "../system/SystemUpdatesEmitter"

// Keep track of active state subscriptions
const activeStateSubscriptions = new Set<StreamingResponseHandler<State>>()

/**
 * Subscribe to state updates
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the Protobus handler)
 */
export async function subscribeToState(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<State>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeStateSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeStateSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getProtobusRequestRegistry().registerRequest(requestId, cleanup, { type: "state_subscription" }, responseStream)
	}

	// Send the initial state
	const initialState = await controller.getStateToPostToWebview()
	const initialStateJson = JSON.stringify(initialState)

	try {
		await responseStream(
			State.create({
				stateJson: initialStateJson,
				partialUpdates: {},
			}),
			false, // Not the last message
		)
	} catch (error) {
		Logger.error("Error sending initial state:", error)
		activeStateSubscriptions.delete(responseStream)
	}
}

/**
 * Send a state update to all active subscribers
 * @param state The state to send
 * @param previousState The previous state to calculate partial updates
 */
export async function sendStateUpdate(state: ExtensionState, previousState?: ExtensionState): Promise<void> {
	const partialUpdates: Record<string, string> = {}
	let stateJson = ""

	if (previousState) {
		for (const key in state) {
			const k = key as keyof ExtensionState
			if (!deepEqual(state[k], previousState[k])) {
				partialUpdates[k] = JSON.stringify(state[k])
			}
		}
	} else {
		stateJson = JSON.stringify(state)
	}

	// If there are no changes and it's a partial update, don't send anything
	if (previousState && Object.keys(partialUpdates).length === 0) {
		return
	}

	const stateProto = State.create({
		stateJson,
		partialUpdates,
	})

	// Send the state to all active subscribers
	const promises = Array.from(activeStateSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				stateProto,
				false, // Not the last message
			)
		} catch (error) {
			Logger.error("Error sending state update:", error)
			// Remove the subscription if there was an error
			activeStateSubscriptions.delete(responseStream)
		}
	})

	await broadcastStateUpdate(
		StateUpdate.create({
			stateJson,
			partialUpdates,
		}),
	)

	await Promise.all(promises)
}
