import { Controller } from "@core/controller"

/**
 * Type definition for a Protobus handler function.
 * This represents a function that takes a Controller instance and a request object,
 * and returns a Promise of the response type.
 *
 * @template TRequest - The type of the request object
 * @template TResponse - The type of the response object
 */
export type ProtobusHandler<TRequest, TResponse> = (controller: Controller, req: TRequest) => Promise<TResponse>

export type ProtobusStreamingResponseHandler<TRequest, TResponse> = (
	controller: Controller,
	req: TRequest,
	streamResponseHandler: StreamingResponseWriter<TResponse>,
	requestId?: string,
) => Promise<void>

export type StreamingResponseWriter<TResponse> = (response: TResponse, isLast?: boolean, sequenceNumber?: number) => Promise<void>

/**
 * Abstract base class for type-safe Protobus client implementations.
 */
export abstract class BaseProtobusClient<TClient> {
	protected client: TClient | null = null
	protected address: string

	constructor(address: string) {
		this.address = address
	}

	protected abstract createClient(): TClient

	protected getClient(): TClient {
		if (!this.client) {
			this.client = this.createClient()
		}
		return this.client
	}

	protected destroyClient(): void {
		this.client = null
	}

	protected async makeRequest<T>(requestFn: (client: TClient) => Promise<T>): Promise<T> {
		const client = this.getClient()
		return await requestFn(client)
	}
}
