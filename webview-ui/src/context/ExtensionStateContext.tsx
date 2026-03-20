import type { ExtensionState } from "@shared/ExtensionMessage"
import type { UserInfo, UserOrganization } from "@shared/proto/codemarie/account"
import type { OnboardingModelGroup, TerminalProfile } from "@shared/proto/codemarie/state"
import type { ModelInfo } from "../../../src/shared/api"
import type { McpMarketplaceCatalog, McpServer, McpViewTab } from "../../../src/shared/mcp"
import { type CodemarieUser, useAuth } from "./AuthContext"
import { useGlobalState } from "./GlobalStateContext"
import { useModels } from "./ModelStateContext"
import { type NavigationOptions, useNavigation, type View } from "./NavigationContext"
import { useNotifications } from "./NotificationContext"

export type { View, NavigationOptions, CodemarieUser }

export interface ExtensionStateContextType extends ExtensionState {
	didHydrateState: boolean
	showWelcome: boolean
	onboardingModels: OnboardingModelGroup | undefined
	codemarieModels: Record<string, ModelInfo> | null
	openRouterModels: Record<string, ModelInfo>
	vercelAiGatewayModels: Record<string, ModelInfo>
	hicapModels: Record<string, ModelInfo>
	liteLlmModels: Record<string, ModelInfo>
	openAiModels: string[]
	requestyModels: Record<string, ModelInfo>
	groqModels: Record<string, ModelInfo>
	basetenModels: Record<string, ModelInfo>
	huggingFaceModels: Record<string, ModelInfo>
	mcpServers: McpServer[]
	mcpMarketplaceCatalog: McpMarketplaceCatalog
	totalTasksSize: number | null
	lastDismissedCliBannerVersion: number
	dismissedBanners?: Array<{ bannerId: string; dismissedAt: number }>
	availableTerminalProfiles: TerminalProfile[]

	// Auth state
	codemarieUser: CodemarieUser | null
	organizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
	isLoginLoading: boolean

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
	setRequestyModels: (value: Record<string, ModelInfo>) => void
	setGroqModels: (value: Record<string, ModelInfo>) => void
	setBasetenModels: (value: Record<string, ModelInfo>) => void
	setHuggingFaceModels: (value: Record<string, ModelInfo>) => void
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
	setOnboardingModels: (value: OnboardingModelGroup | undefined) => void

	// Refresh functions
	refreshCodemarieModels: () => void
	refreshOpenRouterModels: () => void
	refreshVercelAiGatewayModels: () => void
	refreshHicapModels: () => void
	refreshLiteLlmModels: () => Promise<void>
	setUserInfo: (userInfo?: UserInfo) => void

	// Auth functions
	handleSignIn: () => void
	handleSignOut: () => Promise<void>

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
	const auth = useAuth()
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
		setOnboardingModels: (value: OnboardingModelGroup | undefined) => globalState.setOnboardingModels(value),
		setUserInfo: (userInfo?: UserInfo) => globalState.setState((prev) => ({ ...prev, userInfo })),

		// Navigation
		...navigation,
		showAnnouncement: globalState.shouldShowAnnouncement, // Mapping for compatibility
		setShowAnnouncement: (value: boolean) => globalState.setState((prev) => ({ ...prev, shouldShowAnnouncement: value })),
		hideAnnouncement: () => globalState.setState((prev) => ({ ...prev, shouldShowAnnouncement: false })),

		// Auth
		codemarieUser: auth.user,
		organizations: auth.userOrganizations,
		activeOrganization: auth.activeOrganization,
		isLoginLoading: auth.isLoginLoading,
		handleSignIn: auth.handleSignIn,
		handleSignOut: auth.handleSignOut,

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
