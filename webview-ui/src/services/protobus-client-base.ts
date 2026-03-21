/** biome-ignore-all lint/complexity/noThisInStatic: In static methods, this refers to the constructor (the subclass that invoked the method) when we want to refer to the subclass serviceName.
 *
 * NOTE: This file imports PLATFORM_CONFIG directly rather than using the PlatformProvider
 * because it contains static utility methods that are called from various contexts,
 * including non-React code. The configuration is compile-time constant, so direct
 * import is safe and ensures the methods work consistently regardless of React context.
 */
import { PLATFORM_CONFIG } from "../config/platform.config"

export interface Callbacks<TResponse> {
	onResponse: (response: TResponse) => void
	onError?: (error: Error) => void
	onComplete?: () => void
}

/* biome-ignore lint/complexity/noStaticOnlyClass: ProtoBusClient is used as a namespace for Protobus methods */
export abstract class ProtoBusClient {
	static serviceName: string
	static notificationHandler: ((type: "info" | "warning" | "error", message: string) => void) | null = null

	static setNotificationHandler(handler: (type: "info" | "warning" | "error", message: string) => void) {
		this.notificationHandler = handler
	}

	// biome-ignore lint/suspicious/noExplicitAny: Message type is determined by host
	static handleHostAction(message: any) {
		if (message.type === "host_action") {
			const { method, args } = message.host_action
			const messageText = args[0]
			let type: "info" | "warning" | "error" = "info"

			if (method === "showInformationMessage") {
				type = "info"
			} else if (method === "showWarningMessage") {
				type = "warning"
			} else if (method === "showErrorMessage") {
				type = "error"
			} else {
				return false
			}

			if (this.notificationHandler) {
				this.notificationHandler(type, messageText)
			} else {
				console.log(`[${type.toUpperCase()}] ${messageText}`)
			}
			return true
		}
		return false
	}

	static async makeUnaryRequest<TRequest, TResponse>(
		methodName: string,
		request: TRequest,
		encodeRequest: (_: TRequest) => unknown,
		decodeResponse: (_: Record<string, unknown>) => TResponse,
	): Promise<TResponse> {
		return new Promise((resolve, reject) => {
			const requestId = crypto.randomUUID()

			// Set up one-time listener for this specific request
			const handleResponse = (event: MessageEvent) => {
				const message = event.data
				if (this.handleHostAction(message)) {
					return
				}
				if (message.type === "protobus_response" && message.protobus_response?.request_id === requestId) {
					// Remove listener once we get our response
					window.removeEventListener("message", handleResponse)
					if (message.protobus_response.message) {
						const response = PLATFORM_CONFIG.decodeMessage(message.protobus_response.message, decodeResponse)
						resolve(response)
					} else if (message.protobus_response.error) {
						reject(new Error(message.protobus_response.error))
					} else {
						console.error("Received ProtoBus message with no response or error ", JSON.stringify(message))
					}
				}
			}

			window.addEventListener("message", handleResponse)
			PLATFORM_CONFIG.postMessage({
				type: "protobus_request",
				protobus_request: {
					service: this.serviceName,
					method: methodName,
					message: PLATFORM_CONFIG.encodeMessage(request, encodeRequest),
					request_id: requestId,
					is_streaming: false,
				},
			})
		})
	}

	static makeStreamingRequest<TRequest, TResponse>(
		methodName: string,
		request: TRequest,
		encodeRequest: (_: TRequest) => unknown,
		decodeResponse: (_: Record<string, unknown>) => TResponse,
		callbacks: Callbacks<TResponse>,
	): () => void {
		const requestId = crypto.randomUUID()
		// Set up listener for streaming responses
		const handleResponse = (event: MessageEvent) => {
			const message = event.data
			if (this.handleHostAction(message)) {
				return
			}
			if (message.type === "protobus_response" && message.protobus_response?.request_id === requestId) {
				if (message.protobus_response.message) {
					// Process streaming message
					const response = PLATFORM_CONFIG.decodeMessage(message.protobus_response.message, decodeResponse)
					callbacks.onResponse(response)
				} else if (message.protobus_response.error) {
					// Handle error
					if (callbacks.onError) {
						callbacks.onError(new Error(message.protobus_response.error))
					}
					// Only remove the event listener on error
					window.removeEventListener("message", handleResponse)
				} else {
					console.error("Received ProtoBus message with no response or error ", JSON.stringify(message))
				}
				if (message.protobus_response.is_streaming === false) {
					if (callbacks.onComplete) {
						callbacks.onComplete()
					}
					// Only remove the event listener when the stream is explicitly ended
					window.removeEventListener("message", handleResponse)
				}
			}
		}
		window.addEventListener("message", handleResponse)
		PLATFORM_CONFIG.postMessage({
			type: "protobus_request",
			protobus_request: {
				service: this.serviceName,
				method: methodName,
				message: PLATFORM_CONFIG.encodeMessage(request, encodeRequest),
				request_id: requestId,
				is_streaming: true,
			},
		})
		// Return a function to cancel the stream
		return () => {
			window.removeEventListener("message", handleResponse)
			PLATFORM_CONFIG.postMessage({
				type: "protobus_request_cancel",
				protobus_request_cancel: {
					request_id: requestId,
				},
			})
			console.log(`[DEBUG] Sent cancellation for request: ${requestId}`)
		}
	}
}
