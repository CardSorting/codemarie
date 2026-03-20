import { v4 as uuidv4 } from "uuid"
import { WebSocket } from "ws"

const serviceNames = [
	"codemarie.AccountService",
	"codemarie.BrowserService",
	"codemarie.CheckpointsService",
	"codemarie.CommandsService",
	"codemarie.FileService",
	"codemarie.McpService",
	"codemarie.ModelsService",
	"codemarie.SlashService",
	"codemarie.StateService",
	"codemarie.TaskService",
	"codemarie.UiService",
	"codemarie.WebService",
] as const

export type ServiceClients = {
	[K in (typeof serviceNames)[number]]: any
}

export class WebSocketAdapter {
	private ws: WebSocket | null = null
	private address: string
	private pendingRequests: Map<string, { resolve: (val: any) => void; reject: (err: any) => void }> = new Map()

	constructor(address: string) {
		this.address = address.startsWith("ws://") ? address : `ws://${address}`
	}

	private async ensureConnection(): Promise<WebSocket> {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			return this.ws
		}

		return new Promise((resolve, reject) => {
			const ws = new WebSocket(this.address)

			ws.on("open", () => {
				this.ws = ws
				resolve(ws)
			})

			ws.on("message", (data: string) => {
				try {
					const message = JSON.parse(data.toString())
					if (message.type === "grpc_response") {
						const { request_id, message: responseMessage, error } = message.grpc_response
						const pending = this.pendingRequests.get(request_id)
						if (pending) {
							if (error) {
								pending.reject(new Error(error))
							} else {
								pending.resolve(responseMessage)
							}
							this.pendingRequests.delete(request_id)
						}
					}
				} catch (error) {
					console.error("[WebSocketAdapter] Error parsing message:", error)
				}
			})

			ws.on("error", (error) => {
				console.error("[WebSocketAdapter] WebSocket error:", error)
				if (!this.ws) reject(error)
			})

			ws.on("close", () => {
				this.ws = null
				console.log("[WebSocketAdapter] WebSocket connection closed")
			})
		})
	}

	async call(service: keyof ServiceClients, method: string, request: any): Promise<any> {
		const ws = await this.ensureConnection()
		const requestId = uuidv4()

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(requestId, { resolve, reject })

			const message = {
				type: "grpc_request",
				grpc_request: {
					service,
					method,
					message: request,
					request_id: requestId,
					is_streaming: false,
				},
			}

			ws.send(JSON.stringify(message))

			// Add timeout
			setTimeout(() => {
				if (this.pendingRequests.has(requestId)) {
					this.pendingRequests.delete(requestId)
					reject(new Error(`Request timeout: ${service}.${method} (${requestId})`))
				}
			}, 30000)
		})
	}

	close(): void {
		if (this.ws) {
			this.ws.close()
			this.ws = null
		}
	}
}
