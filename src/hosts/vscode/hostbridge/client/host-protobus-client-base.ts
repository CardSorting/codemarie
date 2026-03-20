import { v4 as uuidv4 } from "uuid"
import { StreamingCallbacks } from "@/hosts/host-provider-types"
import { ProtobusHandler } from "@/hosts/vscode/hostbridge-handler"
import { Logger } from "@/shared/services/Logger"

// Generic type for any protobuf service definition
export type ProtoService = {
	name: string
	fullName: string
	methods: {
		[key: string]: {
			name: string
			requestType: any
			responseType: any
			requestStream: boolean
			responseStream: boolean
			options: any
		}
	}
}

// Define a unified client type that handles both unary and streaming methods
export type ProtobusClientType<T extends ProtoService> = {
	[K in keyof T["methods"]]: T["methods"][K]["responseStream"] extends true
		? (
				request: InstanceType<T["methods"][K]["requestType"]>,
				options: StreamingCallbacks<InstanceType<T["methods"][K]["responseType"]>>,
			) => () => void // Returns a cancel function
		: (request: InstanceType<T["methods"][K]["requestType"]>) => Promise<InstanceType<T["methods"][K]["responseType"]>>
}

/**
 * Creates a client for any protobuf service with inferred types.
 */
export function createProtobusClient<T extends ProtoService>(service: T): ProtobusClientType<T> {
	const client = {} as ProtobusClientType<T>
	const protobusHandler = new ProtobusHandler()

	Object.values(service.methods).forEach((method) => {
		// Use lowercase method name as the key in the client object
		const name = method.name
		const mKey = name.charAt(0).toLowerCase() + name.slice(1)

		// Streaming method implementation
		if (method.responseStream) {
			client[mKey as keyof ProtobusClientType<T>] = ((
				request: any,
				options: StreamingCallbacks<InstanceType<typeof method.responseType>>,
			) => {
				// Use handleRequest with streaming callbacks
				const requestId = uuidv4()

				// We need to await the promise and then return the cancel function
				return (async () => {
					try {
						const result = await protobusHandler.handleRequest<InstanceType<typeof method.responseType>>(
							service.fullName,
							mKey,
							request,
							requestId,
							options,
						)

						// If the result is a function, it's the cancel function
						if (typeof result === "function") {
							return result
						}
						// This shouldn't happen, but just in case
						Logger.error(`Expected cancel function but got response object for streaming request: ${requestId}`)
						return () => {}
					} catch (error) {
						Logger.error(`Error in streaming request: ${error}`)
						if (options.onError) {
							options.onError(error instanceof Error ? error : new Error(String(error)))
						}
						return () => {}
					}
				})()
			}) as any
		} else {
			// Unary method implementation
			client[mKey as keyof ProtobusClientType<T>] = (async (request: any) => {
				const requestId = uuidv4()
				try {
					const response = await protobusHandler.handleRequest(service.fullName, mKey, request, requestId)

					// Check if the response is a function (streaming)
					if (typeof response === "function") {
						// This shouldn't happen for unary requests
						throw new Error("Received streaming response for unary request")
					}
					return response
				} catch (e) {
					Logger.log(`[DEBUG] Protobus host ERR to ${service.fullName}.${mKey} req:${requestId} err:${e}`)
					throw e
				}
			}) as any
		}
	})
	return client
}
