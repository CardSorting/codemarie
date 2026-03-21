import {
	CheckpointEvent,
	CodemarieMessage,
	McpMarketplaceCatalog,
	McpServers,
	OpenRouterCompatibleModelInfo,
	StateUpdate,
	SystemUpdate,
	UiEvent,
} from "@shared/proto/codemarie/system"
import { Logger } from "@/shared/services/Logger"
import { StreamingResponseHandler } from "../protobus-handler"

// Keep track of active system update subscriptions
const activeSystemSubscriptions = new Set<StreamingResponseHandler<SystemUpdate>>()

/**
 * Subscribe to unified system updates
 * @param responseStream The streaming response handler
 */
export function addSystemSubscription(responseStream: StreamingResponseHandler<SystemUpdate>) {
	activeSystemSubscriptions.add(responseStream)
}

/**
 * Unsubscribe from unified system updates
 * @param responseStream The streaming response handler
 */
export function removeSystemSubscription(responseStream: StreamingResponseHandler<SystemUpdate>) {
	activeSystemSubscriptions.delete(responseStream)
}

/**
 * Broadcast a system update to all active subscribers
 * @param update The update message to broadcast
 */
export async function broadcastSystemUpdate(update: SystemUpdate): Promise<void> {
	if (activeSystemSubscriptions.size === 0) return

	const promises = Array.from(activeSystemSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(update, false)
		} catch (error) {
			Logger.error("Error broadcasting system update:", error)
			activeSystemSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}

// Helper methods to broadcast specific update types

export async function broadcastStateUpdate(stateUpdate: StateUpdate): Promise<void> {
	await broadcastSystemUpdate(SystemUpdate.create({ state: stateUpdate }))
}

export async function broadcastUiEvent(uiEvent: UiEvent): Promise<void> {
	await broadcastSystemUpdate(SystemUpdate.create({ uiEvent }))
}

export async function broadcastMcpServers(mcpServers: McpServers): Promise<void> {
	await broadcastSystemUpdate(SystemUpdate.create({ mcpServers }))
}

export async function broadcastMcpMarketplace(mcpMarketplace: McpMarketplaceCatalog): Promise<void> {
	await broadcastSystemUpdate(SystemUpdate.create({ mcpMarketplace }))
}

export async function broadcastOpenRouterModels(models: OpenRouterCompatibleModelInfo): Promise<void> {
	await broadcastSystemUpdate(SystemUpdate.create({ openRouterModels: models }))
}

export async function broadcastLiteLlmModels(models: OpenRouterCompatibleModelInfo): Promise<void> {
	await broadcastSystemUpdate(SystemUpdate.create({ liteLlmModels: models }))
}

export async function broadcastPartialMessage(message: CodemarieMessage): Promise<void> {
	await broadcastSystemUpdate(SystemUpdate.create({ partialMessage: message }))
}

export async function broadcastCheckpointEvent(event: CheckpointEvent): Promise<void> {
	await broadcastSystemUpdate(SystemUpdate.create({ checkpointEvent: event }))
}
