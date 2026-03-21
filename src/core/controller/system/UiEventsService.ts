import { EmptyRequest } from "@shared/proto/codemarie/common"
import { UiEvent as ProtoUiEvent } from "@shared/proto/codemarie/system"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../index"
import { getProtobusRequestRegistry, StreamingResponseHandler } from "../protobus-handler"
import { broadcastUiEvent } from "./SystemUpdatesEmitter"

export enum UiEventType {
	MCP_BUTTON_CLICKED = "mcp_button_clicked",
	HISTORY_BUTTON_CLICKED = "history_button_clicked",
	CHAT_BUTTON_CLICKED = "chat_button_clicked",
	ACCOUNT_BUTTON_CLICKED = "account_button_clicked",
	SETTINGS_BUTTON_CLICKED = "settings_button_clicked",
	WORKTREES_BUTTON_CLICKED = "worktrees_button_clicked",
	RELINQUISH_CONTROL = "relinquish_control",
}

export interface UiEvent {
	type: UiEventType
	// biome-ignore lint/suspicious/noExplicitAny: UI event data can be any JSON-serializable object
	data?: any
}

// Keep track of active UI event subscribers
const activeSubscribers = new Set<StreamingResponseHandler<UiEvent>>()

/**
 * Subscribe to all UI events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request
 */
export async function subscribeToUiEvents(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<UiEvent>,
	requestId?: string,
): Promise<void> {
	activeSubscribers.add(responseStream)

	const cleanup = () => {
		activeSubscribers.delete(responseStream)
	}

	if (requestId) {
		getProtobusRequestRegistry().registerRequest(requestId, cleanup, { type: "ui_events_subscription" }, responseStream)
	}
}

/**
 * Send a UI event to all active subscribers
 */
// biome-ignore lint/suspicious/noExplicitAny: UI event data can be any JSON-serializable object
export async function sendUiEvent(type: UiEventType, data?: any): Promise<void> {
	const promises = Array.from(activeSubscribers).map(async (responseStream) => {
		try {
			await responseStream({ type, data }, false)
		} catch (error) {
			Logger.error(`[UiEventsService] Error sending event ${type}:`, error)
			activeSubscribers.delete(responseStream)
		}
	})

	await broadcastUiEvent(
		ProtoUiEvent.create({
			type,
			dataJson: data ? JSON.stringify(data) : undefined,
		}),
	)

	await Promise.all(promises)
}
