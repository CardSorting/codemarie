import { EmptyRequest } from "@shared/proto/codemarie/common"
import { CodemarieMessage } from "@shared/proto/codemarie/system"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../index"
import { getProtobusRequestRegistry, StreamingResponseHandler } from "../protobus-handler"
import { broadcastPartialMessage } from "./SystemUpdatesEmitter"

// Keep track of active partial message subscriptions (Protobus streams)
const activePartialMessageSubscriptions = new Set<StreamingResponseHandler<CodemarieMessage>>()

// Keep track of callback-based subscriptions (for CLI and other non-Protobus consumers)
export type PartialMessageCallback = (message: CodemarieMessage) => void
const callbackSubscriptions = new Set<PartialMessageCallback>()

/**
 * Subscribe to partial message events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the Protobus handler)
 */
export async function subscribeToPartialMessage(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<CodemarieMessage>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activePartialMessageSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activePartialMessageSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getProtobusRequestRegistry().registerRequest(requestId, cleanup, { type: "partial_message_subscription" }, responseStream)
	}
}

/**
 * Register a callback to receive partial message events (for CLI and non-Protobus consumers)
 * @param callback The callback function to receive messages
 * @returns A function to unsubscribe
 */
export function registerPartialMessageCallback(callback: PartialMessageCallback): () => void {
	callbackSubscriptions.add(callback)
	return () => {
		callbackSubscriptions.delete(callback)
	}
}

/**
 * Send a partial message event to all active subscribers
 * @param partialMessage The CodemarieMessage to send
 */
export async function sendPartialMessageEvent(partialMessage: CodemarieMessage): Promise<void> {
	// Send to Protobus stream subscribers
	const streamPromises = Array.from(activePartialMessageSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				partialMessage,
				false, // Not the last message
			)
		} catch (error) {
			Logger.error("Error sending partial message event:", error)
			// Remove the subscription if there was an error
			activePartialMessageSubscriptions.delete(responseStream)
		}
	})

	// Send to callback subscribers (synchronous)
	for (const callback of callbackSubscriptions) {
		try {
			callback(partialMessage)
		} catch (error) {
			Logger.error("Error in partial message callback:", error)
		}
	}

	await broadcastPartialMessage(partialMessage)

	await Promise.all(streamPromises)
}
