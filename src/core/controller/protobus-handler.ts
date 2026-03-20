import { Controller } from "@core/controller/index"
import { serviceHandlers } from "@generated/hosts/vscode/protobus-services"
import { ProtobusRecorderBuilder } from "@/core/controller/protobus-recorder/protobus-recorder.builder"
import { ProtobusRequestRegistry } from "@/core/controller/protobus-request-registry"
import { ExtensionMessage } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { ProtobusCancel, ProtobusRequest } from "@/shared/WebviewMessage"

/**
 * Type definition for a streaming response handler
 */
export type StreamingResponseHandler<TResponse> = (
	response: TResponse,
	isLast?: boolean,
	sequenceNumber?: number,
) => Promise<void>

export type PostMessageToWebview = (message: ExtensionMessage) => Thenable<boolean | undefined>

/**
 * Creates a middleware wrapper for recording Protobus requests and responses
 */
function withRecordingMiddleware(postMessage: PostMessageToWebview, controller: Controller): PostMessageToWebview {
	return async (response: ExtensionMessage) => {
		if (response?.protobus_response) {
			try {
				ProtobusRecorderBuilder.getRecorder(controller).recordResponse(
					response.protobus_response.request_id,
					response.protobus_response,
				)
			} catch (e) {
				Logger.warn("Failed to record Protobus response:", e)
			}
		}
		return postMessage(response)
	}
}

/**
 * Records Protobus request with error handling
 */
function recordRequest(request: ProtobusRequest, controller: Controller): void {
	try {
		ProtobusRecorderBuilder.getRecorder(controller).recordRequest(request as any)
	} catch (e) {
		Logger.warn("Failed to record Protobus request:", e)
	}
}

/**
 * Handles a Protobus request from the webview.
 */
export async function handleProtobusRequest(
	controller: Controller,
	postMessageToWebview: PostMessageToWebview,
	request: ProtobusRequest,
): Promise<void> {
	recordRequest(request, controller)

	// Create recording middleware wrapper
	const postMessageWithRecording = withRecordingMiddleware(postMessageToWebview, controller)

	if (request.is_streaming) {
		await handleStreamingRequest(controller, postMessageWithRecording, request)
	} else {
		await handleUnaryRequest(controller, postMessageWithRecording, request)
	}
}

/**
 * Handles a Protobus unary request from the webview.
 *
 * Calls the handler using the service and method name, and then posts the result back to the webview.
 */
async function handleUnaryRequest(
	controller: Controller,
	postMessageToWebview: PostMessageToWebview,
	request: ProtobusRequest,
): Promise<void> {
	try {
		// Get the service handler from the config
		const handler = getHandler(request.service, request.method)
		// Handle unary request
		const response = await handler(controller, request.message)
		// Send response to the webview
		await postMessageToWebview({
			type: "protobus_response",
			protobus_response: {
				message: response,
				request_id: request.request_id,
			},
		})
	} catch (error) {
		// Send error response
		Logger.log("Protobus error:", error)
		await postMessageToWebview({
			type: "protobus_response",
			protobus_response: {
				error: error instanceof Error ? error.message : String(error),
				request_id: request.request_id,
				is_streaming: false,
			},
		})
	}
}

/**
 * Handle a streaming Protobus request from the webview.
 *
 * Calls the handler using the service and method name, and creates a streaming response handler
 * which posts results back to the webview.
 */
async function handleStreamingRequest(
	controller: Controller,
	postMessageToWebview: PostMessageToWebview,
	request: ProtobusRequest,
): Promise<void> {
	// Create a response stream function
	const responseStream: StreamingResponseHandler<any> = async (response: any, isLast = false, sequenceNumber?: number) => {
		await postMessageToWebview({
			type: "protobus_response",
			protobus_response: {
				message: response,
				request_id: request.request_id,
				is_streaming: !isLast,
				sequence_number: sequenceNumber,
			},
		})
	}

	try {
		// Get the service handler from the config
		const handler = getHandler(request.service, request.method)

		// Handle streaming request and pass the requestId to all streaming handlers
		await handler(controller, request.message, responseStream, request.request_id)

		// Don't send a final message here - the stream should stay open for future updates
		// The stream will be closed when the client disconnects or when the service explicitly ends it
	} catch (error) {
		// Send error response
		Logger.log("Protobus error:", error)
		await postMessageToWebview({
			type: "protobus_response",
			protobus_response: {
				error: error instanceof Error ? error.message : String(error),
				request_id: request.request_id,
				is_streaming: false,
			},
		})
	}
}

/**
 * Handles a Protobus request cancellation from the webview.
 * @param controller The controller instance
 * @param request The cancellation request
 */
export async function handleProtobusRequestCancel(postMessageToWebview: PostMessageToWebview, request: ProtobusCancel) {
	const cancelled = requestRegistry.cancelRequest(request.request_id)

	if (cancelled) {
		// Send a cancellation confirmation
		await postMessageToWebview({
			type: "protobus_response",
			protobus_response: {
				message: { cancelled: true },
				request_id: request.request_id,
				is_streaming: false,
			},
		})
	} else {
		Logger.log(`[DEBUG] Request not found for cancellation: ${request.request_id}`)
	}
}

// Registry to track active Protobus requests and their cleanup functions
const requestRegistry = new ProtobusRequestRegistry()

/**
 * Get the request registry instance
 * This allows other parts of the code to access the registry
 */
export function getProtobusRequestRegistry(): ProtobusRequestRegistry {
	return requestRegistry
}

function getHandler(serviceName: string, methodName: string): any {
	// Get the service handler from the config
	const serviceConfig = serviceHandlers[serviceName]
	if (!serviceConfig) {
		throw new Error(`Unknown service: ${serviceName}`)
	}
	const handler = serviceConfig[methodName]
	if (!handler) {
		throw new Error(`Unknown rpc: ${serviceName}.${methodName}`)
	}
	return handler
}
