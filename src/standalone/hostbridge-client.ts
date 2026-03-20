import * as net from "net"
import { log } from "./utils"

export const HOSTBRIDGE_PORT = 26041

export async function waitForHostBridgeReady(timeoutMs = 60000, intervalMs = 500): Promise<string> {
	const address = process.env.HOST_BRIDGE_ADDRESS || `127.0.0.1:${HOSTBRIDGE_PORT}`
	const [host, portStr] = address.split(":")
	const port = Number.parseInt(portStr, 10)

	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const ok = await checkTcpPort(host, port)
		if (ok) {
			log(`HostBridge serving at ${address}; continuing startup`)
			return address
		}
		log("Waiting for hostbridge to be ready...")
		await new Promise((r) => setTimeout(r, intervalMs))
	}
	throw new Error(`HostBridge port check timed out after ${timeoutMs}ms at ${address}`)
}

async function checkTcpPort(host: string, port: number): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const socket = new net.Socket()
		socket.setTimeout(1000)
		socket
			.once("connect", () => {
				socket.destroy()
				resolve(true)
			})
			.once("timeout", () => {
				socket.destroy()
				resolve(false)
			})
			.once("error", () => {
				socket.destroy()
				resolve(false)
			})
			.connect(port, host)
	})
}
