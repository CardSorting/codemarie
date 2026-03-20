import { Controller } from "@core/controller"
import { startProtobusWsService } from "./protobus-ws-service"

export const PROTOBUS_PORT = Number(process.env.PROTOBUS_PORT) || 26040

/**
 * Starts the ProtoBus service using WebSockets.
 * This replaces the previous Protobus implementation with a more direct WebSocket alternative.
 *
 * @param controller - The controller instance to handle requests
 * @returns A promise that resolves to the server address (host:port)
 */
export function startProtobusService(controller: Controller): Promise<string> {
	return startProtobusWsService(controller)
}
