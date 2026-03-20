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
import { McpServiceClient, ModelsServiceClient, StateServiceClient, UiServiceClient } from "../services/protobus-client"

export function useProtobusSubscriptions() {
	const {
		setState,
		setMcpServers,
		setMcpMarketplaceCatalog,
		setAvailableTerminalProfiles,
		setDidHydrateState,
		setShowWelcome,
		setOnboardingModels,
		showWelcome,
		triggerRelinquishControl: onRelinquishControl,
	} = useGlobalState()

	const { navigateToMcp, navigateToHistory, navigateToChat, navigateToSettings, navigateToWorktrees, navigateToAccount } =
		useNavigation()

	const { setOpenRouterModels, setLiteLlmModels } = useModels()

	const stateSubscriptionRef = useRef<(() => void) | null>(null)
	const mcpButtonUnsubscribeRef = useRef<(() => void) | null>(null)
	const historyButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const chatButtonUnsubscribeRef = useRef<(() => void) | null>(null)
	const accountButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const settingsButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const worktreesButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const partialMessageUnsubscribeRef = useRef<(() => void) | null>(null)
	const mcpMarketplaceUnsubscribeRef = useRef<(() => void) | null>(null)
	const openRouterModelsUnsubscribeRef = useRef<(() => void) | null>(null)
	const liteLlmModelsUnsubscribeRef = useRef<(() => void) | null>(null)
	const relinquishControlUnsubscribeRef = useRef<(() => void) | null>(null)
	const mcpServersSubscriptionRef = useRef<(() => void) | null>(null)

	useEffect(() => {
		// Set up state subscription
		stateSubscriptionRef.current = StateServiceClient.subscribeToState(EmptyRequest.create({}), {
			onResponse: (response) => {
				if (response.stateJson) {
					try {
						const stateData = JSON.parse(response.stateJson)
						setState((prevState) => {
							const incomingVersion = stateData.autoApprovalSettings?.version ?? 1
							const currentVersion = prevState.autoApprovalSettings?.version ?? 1
							const shouldUpdateAutoApproval = incomingVersion > currentVersion

							if (stateData.currentTaskItem?.id === prevState.currentTaskItem?.id) {
								stateData.codemarieMessages = stateData.codemarieMessages?.length
									? stateData.codemarieMessages
									: prevState.codemarieMessages
							}

							const newState = {
								...stateData,
								autoApprovalSettings: shouldUpdateAutoApproval
									? stateData.autoApprovalSettings
									: prevState.autoApprovalSettings,
							}

							if (!newState.welcomeViewCompleted && !showWelcome) {
								setShowWelcome(true)
								setOnboardingModels(newState.onboardingModels)
							} else if (newState.welcomeViewCompleted) {
								setShowWelcome(false)
								setOnboardingModels(undefined)
							}

							setDidHydrateState(true)
							return newState
						})
					} catch (error) {
						console.error("Error parsing state JSON:", error)
					}
				}
			},
			onError: (error) => console.error("Error in state subscription:", error),
			onComplete: () => console.log("State subscription completed"),
		})

		// UI Event Subscriptions
		mcpButtonUnsubscribeRef.current = UiServiceClient.subscribeToMcpButtonClicked(
			{},
			{
				onResponse: () => navigateToMcp(),
				onError: (err) => console.error("McpButton error:", err),
				onComplete: () => {},
			},
		)
		historyButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToHistoryButtonClicked(
			{},
			{
				onResponse: () => navigateToHistory(),
				onError: (err) => console.error("HistoryButton error:", err),
				onComplete: () => {},
			},
		)
		chatButtonUnsubscribeRef.current = UiServiceClient.subscribeToChatButtonClicked(
			{},
			{
				onResponse: () => navigateToChat(),
				onError: (err) => console.error("ChatButton error:", err),
				onComplete: () => {},
			},
		)
		settingsButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToSettingsButtonClicked(
			{},
			{
				onResponse: () => navigateToSettings(),
				onError: (err) => console.error("SettingsButton error:", err),
				onComplete: () => {},
			},
		)
		worktreesButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToWorktreesButtonClicked(
			{},
			{
				onResponse: () => navigateToWorktrees(),
				onError: (err) => console.error("WorktreesButton error:", err),
				onComplete: () => {},
			},
		)
		accountButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToAccountButtonClicked(
			{},
			{
				onResponse: () => navigateToAccount(),
				onError: (err) => console.error("AccountButton error:", err),
				onComplete: () => {},
			},
		)
		relinquishControlUnsubscribeRef.current = UiServiceClient.subscribeToRelinquishControl(
			{},
			{
				onResponse: () => onRelinquishControl(),
				onError: (err) => console.error("RelinquishControl error:", err),
				onComplete: () => {},
			},
		)

		// Functional Subscriptions
		mcpServersSubscriptionRef.current = McpServiceClient.subscribeToMcpServers(EmptyRequest.create(), {
			onResponse: (response) => {
				if (response.mcpServers) {
					setMcpServers(convertProtoMcpServersToMcpServers(response.mcpServers))
				}
			},
			onError: (err) => console.error("McpServers error:", err),
			onComplete: () => {},
		})

		partialMessageUnsubscribeRef.current = UiServiceClient.subscribeToPartialMessage(EmptyRequest.create({}), {
			onResponse: (protoMessage) => {
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
			},
			onError: (err) => console.error("PartialMessage error:", err),
			onComplete: () => {},
		})

		mcpMarketplaceUnsubscribeRef.current = McpServiceClient.subscribeToMcpMarketplaceCatalog(EmptyRequest.create({}), {
			onResponse: (catalog) => setMcpMarketplaceCatalog(catalog),
			onError: (err) => console.error("McpMarketplace error:", err),
			onComplete: () => {},
		})

		openRouterModelsUnsubscribeRef.current = ModelsServiceClient.subscribeToOpenRouterModels(EmptyRequest.create({}), {
			onResponse: (response) => {
				const models = fromProtobufModels(response.models)
				setOpenRouterModels({
					[openRouterDefaultModelId]: openRouterDefaultModelInfo,
					...models,
				})
			},
			onError: (err) => console.error("OpenRouterModels error:", err),
			onComplete: () => {},
		})

		liteLlmModelsUnsubscribeRef.current = ModelsServiceClient.subscribeToLiteLlmModels(EmptyRequest.create({}), {
			onResponse: (response) => setLiteLlmModels(fromProtobufModels(response.models)),
			onError: (err) => console.error("LiteLlmModels error:", err),
			onComplete: () => {},
		})

		// Initializations
		UiServiceClient.initializeWebview(EmptyRequest.create({})).catch(console.error)
		StateServiceClient.getAvailableTerminalProfiles(EmptyRequest.create({}))
			.then((response) => setAvailableTerminalProfiles(response.profiles))
			.catch(console.error)

		return () => {
			stateSubscriptionRef.current?.()
			mcpButtonUnsubscribeRef.current?.()
			historyButtonClickedSubscriptionRef.current?.()
			chatButtonUnsubscribeRef.current?.()
			accountButtonClickedSubscriptionRef.current?.()
			settingsButtonClickedSubscriptionRef.current?.()
			worktreesButtonClickedSubscriptionRef.current?.()
			partialMessageUnsubscribeRef.current?.()
			mcpMarketplaceUnsubscribeRef.current?.()
			openRouterModelsUnsubscribeRef.current?.()
			liteLlmModelsUnsubscribeRef.current?.()
			relinquishControlUnsubscribeRef.current?.()
			mcpServersSubscriptionRef.current?.()
		}
	}, [
		setState,
		setMcpServers,
		setMcpMarketplaceCatalog,
		setOpenRouterModels,
		setLiteLlmModels,
		setAvailableTerminalProfiles,
		navigateToMcp,
		navigateToHistory,
		navigateToChat,
		navigateToSettings,
		navigateToWorktrees,
		navigateToAccount,
		onRelinquishControl,
		setShowWelcome,
		setOnboardingModels,
		setDidHydrateState,
		showWelcome,
	])
}
