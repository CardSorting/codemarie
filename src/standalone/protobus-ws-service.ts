import { Controller } from "@core/controller"
import { handleProtobusRequest, handleProtobusRequestCancel } from "@core/controller/protobus-handler"
import { WebSocket, WebSocketServer } from "ws"
import { ExtensionMessage } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { ProtobusCancel, ProtobusRequest } from "@/shared/WebviewMessage"

export const PROTOBUS_PORT = Number(process.env.PROTOBUS_PORT) || 26040

export function startProtobusWsService(controller: Controller): Promise<string> {
	return new Promise((resolve, reject) => {
		const wss = new WebSocketServer({
			port: PROTOBUS_PORT,
			host: "127.0.0.1",
		})

		wss.on("connection", (ws: WebSocket) => {
			Logger.log("[ProtoBus WS] New connection established")

			const postMessage = async (message: ExtensionMessage): Promise<boolean> => {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify(message))
					return true
				}
				return false
			}

			ws.on("message", async (data: string) => {
				try {
					const message = JSON.parse(data.toString())

					if (message.type === "protobus_request") {
						const request = message.protobus_request as ProtobusRequest
						Logger.log(`[ProtoBus WS] Request: ${request.service}.${request.method} (${request.request_id})`)
						await handleProtobusRequest(controller, postMessage, request)
					} else if (message.type === "protobus_request_cancel") {
						const cancel = message.protobus_request_cancel as ProtobusCancel
						Logger.log(`[ProtoBus WS] Cancel: ${cancel.request_id}`)
						await handleProtobusRequestCancel(postMessage, cancel)
					} else {
						Logger.warn(`[ProtoBus WS] Unknown message type: ${message.type}`)
					}
				} catch (error) {
					Logger.error("[ProtoBus WS] Error handling message:", error)
				}
			})

			ws.on("error", (error) => {
				Logger.error("[ProtoBus WS] Connection error:", error)
			})

			ws.on("close", () => {
				Logger.log("[ProtoBus WS] Connection closed")
			})
		})

		wss.on("listening", () => {
			const address = `127.0.0.1:${PROTOBUS_PORT}`
			Logger.log(`[ProtoBus WS] Server listening on ws://${address}`)
			resolve(address)
		})

		wss.on("error", (error) => {
			Logger.error("[ProtoBus WS] Server error:", error)
			reject(error)
		})
	})
}
