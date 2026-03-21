import { findLastIndex } from "@shared/array"
import { EmptyRequest } from "@shared/proto/codemarie/common"
import { convertProtoToCodemarieMessage } from "@shared/proto-conversions/codemarie-message"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { fromProtobufModels } from "@shared/proto-conversions/models/typeConversion"
import { useEffect, useRef } from "react"
import { openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../../src/shared/api"
import { useGlobalState } from "../context/GlobalStateContext"
import { useModels } from "../context/ModelStateContext"
import { useNavigation } from "../context/NavigationContext"
import { StateServiceClient, SystemServiceClient } from "../services/protobus-client"

export function useProtobusSubscriptions() {
	const {
		setState,
		setMcpServers,
		setMcpMarketplaceCatalog,
		setAvailableTerminalProfiles,
		setDidHydrateState,
		setShowWelcome,
		showWelcome,
		triggerRelinquishControl: onRelinquishControl,
	} = useGlobalState()

	const { navigateToMcp, navigateToHistory, navigateToChat, navigateToSettings, navigateToWorktrees, navigateToAccount } =
		useNavigation()

	const { setOpenRouterModels } = useModels()

	const lastStateJsonRef = useRef<string | null>(null)

	useEffect(() => {
		// Single unified subscription for all system updates
		const unsubscribe = SystemServiceClient.subscribeToSystemUpdates(EmptyRequest.create({}), {
			onResponse: (update) => {
				// 1. Handle State Updates
				if (update.state) {
					const response = update.state
					setState((prevState) => {
						let newStateData: any = prevState ? { ...prevState } : {}

						if (response.stateJson) {
							if (response.stateJson !== lastStateJsonRef.current) {
								lastStateJsonRef.current = response.stateJson
								try {
									newStateData = JSON.parse(response.stateJson)
								} catch (e) {
									console.error("Error parsing full state JSON:", e)
								}
							}
						}

						const partialUpdates = (response as { partialUpdates?: Record<string, unknown> }).partialUpdates
						if (partialUpdates && Object.keys(partialUpdates).length > 0) {
							for (const [key, value] of Object.entries(partialUpdates)) {
								try {
									newStateData[key] = JSON.parse(value as string)
								} catch (e) {
									console.error(`Error parsing partial update for ${key}:`, e)
								}
							}
						}

						const incomingVersion = newStateData.autoApprovalSettings?.version ?? 1
						const currentVersion = prevState?.autoApprovalSettings?.version ?? 1
						const shouldUpdateAutoApproval = incomingVersion > currentVersion

						if (newStateData.currentTaskItem?.id === prevState?.currentTaskItem?.id) {
							newStateData.codemarieMessages = newStateData.codemarieMessages?.length
								? newStateData.codemarieMessages
								: prevState?.codemarieMessages
						}

						const finalState = {
							...newStateData,
							autoApprovalSettings: shouldUpdateAutoApproval
								? newStateData.autoApprovalSettings
								: prevState?.autoApprovalSettings,
						} as any

						if (!finalState.welcomeViewCompleted && !showWelcome) {
							setShowWelcome(true)
						} else if (finalState.welcomeViewCompleted) {
							setShowWelcome(false)
						}

						setDidHydrateState(true)
						return finalState
					})
				}

				// 2. Handle UI Events
				if (update.uiEvent) {
					const event = update.uiEvent
					switch (event.type) {
						case "mcp_button_clicked":
							navigateToMcp()
							break
						case "history_button_clicked":
							navigateToHistory()
							break
						case "chat_button_clicked":
							navigateToChat()
							break
						case "settings_button_clicked":
							navigateToSettings()
							break
						case "worktrees_button_clicked":
							navigateToWorktrees()
							break
						case "account_button_clicked":
							navigateToAccount()
							break
						case "relinquish_control":
							onRelinquishControl()
							break
					}
				}

				// 3. Handle MCP Updates
				if (update.mcpServers) {
					setMcpServers(convertProtoMcpServersToMcpServers(update.mcpServers.mcpServers))
				}

				if (update.mcpMarketplace) {
					setMcpMarketplaceCatalog(update.mcpMarketplace)
				}

				// 4. Handle Model Updates
				if (update.openRouterModels) {
					const models = fromProtobufModels(update.openRouterModels.models)
					setOpenRouterModels({
						[openRouterDefaultModelId]: openRouterDefaultModelInfo,
						...models,
					})
				}

				// 5. Handle Partial Messages
				if (update.partialMessage) {
					const protoMessage = update.partialMessage
					try {
						if (!protoMessage.ts || protoMessage.ts <= 0) return
						const partialMessage = convertProtoToCodemarieMessage(protoMessage)
						setState((prevState) => {
							const lastIndex = findLastIndex(prevState.codemarieMessages, (msg) => msg.ts === partialMessage.ts)
							if (lastIndex !== -1) {
								const newCodemarieMessages = [...prevState.codemarieMessages]
								newCodemarieMessages[lastIndex] = partialMessage
								return { ...prevState, codemarieMessages: newCodemarieMessages }
							}
							return prevState
						})
					} catch (error) {
						console.error("Failed to process partial message:", error)
					}
				}
			},
			onError: (error) => console.error("Error in system updates subscription:", error),
		})

		// Initializations
		SystemServiceClient.initializeWebview(EmptyRequest.create({})).catch(console.error)
		StateServiceClient.getAvailableTerminalProfiles(EmptyRequest.create({}))
			.then((response) => setAvailableTerminalProfiles(response.profiles))
			.catch(console.error)

		return () => {
			unsubscribe()
		}
	}, [
		setState,
		setMcpServers,
		setMcpMarketplaceCatalog,
		setOpenRouterModels,
		setAvailableTerminalProfiles,
		navigateToMcp,
		navigateToHistory,
		navigateToChat,
		navigateToSettings,
		navigateToWorktrees,
		navigateToAccount,
		onRelinquishControl,
		setShowWelcome,
		setDidHydrateState,
		showWelcome,
	])
}
