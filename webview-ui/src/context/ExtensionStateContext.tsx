import type { ExtensionState } from "@shared/ExtensionMessage"
import type { TerminalProfile } from "@shared/proto/codemarie/state"
import type { ModelInfo } from "../../../src/shared/api"
import type { McpMarketplaceCatalog, McpServer, McpViewTab } from "../../../src/shared/mcp"

import { useGlobalState } from "./GlobalStateContext"
import { useModels } from "./ModelStateContext"
import { type NavigationOptions, useNavigation, type View } from "./NavigationContext"
import { useNotifications } from "./NotificationContext"

export type { View, NavigationOptions }

export interface ExtensionStateContextType extends ExtensionState {
	didHydrateState: boolean
	showWelcome: boolean
	openRouterModels: Record<string, ModelInfo>
	openAiModels: string[]
	mcpServers: McpServer[]
	mcpMarketplaceCatalog: McpMarketplaceCatalog
	totalTasksSize: number | null
	lastDismissedCliBannerVersion: number
	dismissedBanners?: Array<{ bannerId: string; dismissedAt: number }>
	availableTerminalProfiles: TerminalProfile[]

	// View state
	activeView: View
	mcpTab?: McpViewTab
	settingsTargetSection?: string
	settingsInitialModelTab?: "recommended" | "free"
	showAnnouncement: boolean
	expandTaskHeader: boolean
	notifications: Array<{ id: string; type: "info" | "warning" | "error"; message: string }>
	addNotification: (type: "info" | "warning" | "error", message: string) => void
	dismissNotification: (id: string) => void

	// Setters
	setShowAnnouncement: (value: boolean) => void
	setShouldShowAnnouncement: (value: boolean) => void
	setMcpServers: (value: McpServer[]) => void

	updateRulesToggles: (key: keyof ExtensionState, toggles: Record<string, boolean>) => void
	setGlobalCodemarieRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalCodemarieRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalCursorRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalWindsurfRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalAgentsRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalWorkflowToggles: (toggles: Record<string, boolean>) => void
	setGlobalWorkflowToggles: (toggles: Record<string, boolean>) => void
	setGlobalSkillsToggles: (toggles: Record<string, boolean>) => void
	setLocalSkillsToggles: (toggles: Record<string, boolean>) => void
	setRemoteRulesToggles: (toggles: Record<string, boolean>) => void
	setRemoteWorkflowToggles: (toggles: Record<string, boolean>) => void
	setMcpMarketplaceCatalog: (value: McpMarketplaceCatalog) => void
	setTotalTasksSize: (value: number | null) => void
	setExpandTaskHeader: (value: boolean) => void
	setShowWelcome: (value: boolean) => void

	// Refresh functions
	refreshOpenRouterModels: () => void

	// Navigation functions
	navigateTo: (view: View, options?: NavigationOptions) => void
	navigateToMcp: (tab?: McpViewTab) => void
	navigateToSettings: (targetSection?: string) => void
	navigateToSettingsModelPicker: (opts: { targetSection?: string; initialModelTab?: "recommended" | "free" }) => void
	navigateToHistory: () => void
	navigateToAccount: () => void
	navigateToWorktrees: () => void
	navigateToChat: () => void

	// Hide functions
	hideSettings: () => void
	hideHistory: () => void
	hideAccount: () => void
	hideWorktrees: () => void
	hideAnnouncement: () => void
	closeMcpView: () => void

	// Event callbacks
	onRelinquishControl: (callback: () => void) => () => void
}

/**
 * useExtensionState is now a SHIM that aggregates state from multiple specialized contexts.
 * This allows for incremental migration of components while keeping the application functional.
 * For new components, please use the specialized hooks directly:
 * - useGlobalState()
 * - useNavigation()
 * - useAuth()
 * - useModels()
 * - useNotifications()
 */
export const useExtensionState = (): ExtensionStateContextType => {
	const globalState = useGlobalState()
	const navigation = useNavigation()

	const models = useModels()
	const notifications = useNotifications()

	return {
		// Global State
		...globalState,
		setShouldShowAnnouncement: (value: boolean) =>
			globalState.setState((prev) => ({ ...prev, shouldShowAnnouncement: value })),
		setMcpServers: (value: McpServer[]) => globalState.setMcpServers(value),
		setMcpMarketplaceCatalog: (value: McpMarketplaceCatalog) => globalState.setMcpMarketplaceCatalog(value),
		setTotalTasksSize: (value: number | null) => globalState.setTotalTasksSize(value),
		setExpandTaskHeader: (value: boolean) => globalState.setExpandTaskHeader(value),
		setShowWelcome: (value: boolean) => globalState.setShowWelcome(value),

		// Navigation
		...navigation,
		showAnnouncement: globalState.shouldShowAnnouncement, // Mapping for compatibility
		setShowAnnouncement: (value: boolean) => globalState.setState((prev) => ({ ...prev, shouldShowAnnouncement: value })),
		hideAnnouncement: () => globalState.setState((prev) => ({ ...prev, shouldShowAnnouncement: false })),

		// Models
		...models,

		// Notifications
		...notifications,

		// Rules Toggles Helpers
		setGlobalCodemarieRulesToggles: (toggles) => globalState.updateRulesToggles("globalCodemarieRulesToggles", toggles),
		setLocalCodemarieRulesToggles: (toggles) => globalState.updateRulesToggles("localCodemarieRulesToggles", toggles),
		setLocalCursorRulesToggles: (toggles) => globalState.updateRulesToggles("localCursorRulesToggles", toggles),
		setLocalWindsurfRulesToggles: (toggles) => globalState.updateRulesToggles("localWindsurfRulesToggles", toggles),
		setLocalAgentsRulesToggles: (toggles) => globalState.updateRulesToggles("localAgentsRulesToggles", toggles),
		setLocalWorkflowToggles: (toggles) => globalState.updateRulesToggles("localWorkflowToggles", toggles),
		setGlobalWorkflowToggles: (toggles) => globalState.updateRulesToggles("globalWorkflowToggles", toggles),
		setGlobalSkillsToggles: (toggles) => globalState.updateRulesToggles("globalSkillsToggles", toggles),
		setLocalSkillsToggles: (toggles) => globalState.updateRulesToggles("localSkillsToggles", toggles),
		setRemoteRulesToggles: (toggles) => globalState.updateRulesToggles("remoteRulesToggles", toggles),
		setRemoteWorkflowToggles: (toggles) => globalState.updateRulesToggles("remoteWorkflowToggles", toggles),
	}
}
