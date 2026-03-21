import { EmptyRequest } from "@shared/proto/codemarie/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/codemarie/system"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../index"
import { getProtobusRequestRegistry, StreamingResponseHandler } from "../protobus-handler"
import { broadcastOpenRouterModels } from "./SystemUpdatesEmitter"

// Keep track of active OpenRouter models subscriptions
const activeOpenRouterModelsSubscriptions = new Set<StreamingResponseHandler<OpenRouterCompatibleModelInfo>>()

/**
 * Subscribe to OpenRouter models events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the Protobus handler)
 */
export async function subscribeToOpenRouterModels(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<OpenRouterCompatibleModelInfo>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeOpenRouterModelsSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeOpenRouterModelsSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getProtobusRequestRegistry().registerRequest(
			requestId,
			cleanup,
			{ type: "openRouterModels_subscription" },
			responseStream,
		)
	}
}

/**
 * Send an OpenRouter models event to all active subscribers
 * @param models The OpenRouter models to send
 */
export async function sendOpenRouterModelsEvent(models: OpenRouterCompatibleModelInfo): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeOpenRouterModelsSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				models,
				false, // Not the last message
			)
			Logger.log("[DEBUG] sending OpenRouter models event")
		} catch (error) {
			Logger.error("Error sending OpenRouter models event:", error)
			// Remove the subscription if there was an error
			activeOpenRouterModelsSubscriptions.delete(responseStream)
		}
	})

	await broadcastOpenRouterModels(models)

	await Promise.all(promises)
}
