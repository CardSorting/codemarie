import { EmptyRequest } from "@shared/proto/codemarie/common"
import { UiEvent } from "@shared/proto/codemarie/system"
import { Controller } from "../index"
import { StreamingResponseHandler } from "../protobus-handler"
import { subscribeToUiEvents as subscribe } from "./UiEventsService"

/**
 * RPC handler for subscribing to consolidated UI events.
 */
export async function subscribeToUiEvents(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler<UiEvent>,
	requestId?: string,
): Promise<void> {
	return subscribe(controller, request, responseStream, requestId)
}
