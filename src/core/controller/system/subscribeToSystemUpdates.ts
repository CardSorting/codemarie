import { EmptyRequest } from "@shared/proto/codemarie/common"
import { StateUpdate, SystemUpdate } from "@shared/proto/codemarie/system"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../index"
import { getProtobusRequestRegistry, StreamingResponseHandler } from "../protobus-handler"
import { addSystemSubscription, removeSystemSubscription } from "./SystemUpdatesEmitter"

/**
 * Subscribe to unified system updates
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the Protobus handler)
 */
export async function subscribeToSystemUpdates(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<SystemUpdate>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active system subscriptions
	addSystemSubscription(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		removeSystemSubscription(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getProtobusRequestRegistry().registerRequest(requestId, cleanup, { type: "system_subscription" }, responseStream)
	}

	// Send the initial state as part of the system update
	const initialState = await controller.getStateToPostToWebview()
	const initialStateJson = JSON.stringify(initialState)

	try {
		await responseStream(
			SystemUpdate.create({
				state: StateUpdate.create({
					stateJson: initialStateJson,
					partialUpdates: {},
				}),
			}),
			false,
		)
	} catch (error) {
		Logger.error("Error sending initial state in system update:", error)
		removeSystemSubscription(responseStream)
	}
}
