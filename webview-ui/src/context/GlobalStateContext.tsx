import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { DEFAULT_PLATFORM, type ExtensionState } from "@shared/ExtensionMessage"
import { DEFAULT_FOCUS_CHAIN_SETTINGS } from "@shared/FocusChainSettings"
import { DEFAULT_MCP_DISPLAY_MODE } from "@shared/McpDisplayMode"
import { OnboardingModelGroup, type TerminalProfile } from "@shared/proto/codemarie/state"
import type React from "react"
import { createContext, useCallback, useContext, useRef, useState } from "react"
import { Environment } from "../../../src/shared/config-types"
import type { McpMarketplaceCatalog, McpServer } from "../../../src/shared/mcp"

export interface GlobalStateContextType extends ExtensionState {
	mcpServers: McpServer[]
	mcpMarketplaceCatalog: McpMarketplaceCatalog
	totalTasksSize: number | null
	availableTerminalProfiles: TerminalProfile[]
	expandTaskHeader: boolean
	didHydrateState: boolean
	showWelcome: boolean
	onboardingModels: OnboardingModelGroup | undefined

	// Setters and Actions
	setState: React.Dispatch<React.SetStateAction<ExtensionState>>
	setMcpServers: React.Dispatch<React.SetStateAction<McpServer[]>>
	setMcpMarketplaceCatalog: React.Dispatch<React.SetStateAction<McpMarketplaceCatalog>>
	setTotalTasksSize: React.Dispatch<React.SetStateAction<number | null>>
	setAvailableTerminalProfiles: React.Dispatch<React.SetStateAction<TerminalProfile[]>>
	setExpandTaskHeader: React.Dispatch<React.SetStateAction<boolean>>
	setDidHydrateState: React.Dispatch<React.SetStateAction<boolean>>
	setShowWelcome: React.Dispatch<React.SetStateAction<boolean>>
	setOnboardingModels: React.Dispatch<React.SetStateAction<OnboardingModelGroup | undefined>>

	updateRulesToggles: (key: keyof ExtensionState, toggles: Record<string, boolean>) => void
	onRelinquishControl: (callback: () => void) => () => void
	triggerRelinquishControl: () => void
}

const GlobalStateContext = createContext<GlobalStateContextType | undefined>(undefined)

export const GlobalStateProvider: React.FC<{
	children: React.ReactNode
	initialState?: Partial<ExtensionState>
}> = ({ children, initialState }) => {
	const [state, setState] = useState<ExtensionState>({
		version: "",
		codemarieMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		autoApprovalSettings: DEFAULT_AUTO_APPROVAL_SETTINGS,
		browserSettings: DEFAULT_BROWSER_SETTINGS,
		focusChainSettings: DEFAULT_FOCUS_CHAIN_SETTINGS,
		preferredLanguage: "English",
		mode: "act",
		platform: DEFAULT_PLATFORM,
		environment: Environment.production,
		telemetrySetting: "unset",
		distinctId: "",
		planActSeparateModelsSetting: true,
		enableCheckpointsSetting: true,
		mcpDisplayMode: DEFAULT_MCP_DISPLAY_MODE,
		globalCodemarieRulesToggles: {},
		localCodemarieRulesToggles: {},
		localCursorRulesToggles: {},
		localWindsurfRulesToggles: {},
		localAgentsRulesToggles: {},
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		shellIntegrationTimeout: 4000,
		terminalReuseEnabled: true,
		vscodeTerminalExecutionMode: "vscodeTerminal",
		terminalOutputLineLimit: 500,
		maxConsecutiveMistakes: 3,
		defaultTerminalProfile: "default",
		isNewUser: false,
		welcomeViewCompleted: false,
		onboardingModels: undefined,
		mcpResponsesCollapsed: false,
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		customPrompt: undefined,
		useAutoCondense: false,
		subagentsEnabled: false,
		codemarieWebToolsEnabled: { user: true, featureFlag: false },
		worktreesEnabled: { user: true, featureFlag: false },
		favoritedModelIds: [],
		lastDismissedInfoBannerVersion: 0,
		lastDismissedModelBannerVersion: 0,
		optOutOfRemoteConfig: false,
		remoteConfigSettings: {},
		backgroundCommandRunning: false,
		backgroundCommandTaskId: undefined,
		lastDismissedCliBannerVersion: 0,
		backgroundEditEnabled: false,
		doubleCheckCompletionEnabled: false,
		masEnabled: true,
		banners: [],
		globalSkillsToggles: {},
		localSkillsToggles: {},
		workspaceRoots: [],
		primaryRootIndex: 0,
		isMultiRootWorkspace: false,
		multiRootSetting: { user: false, featureFlag: false },
		hooksEnabled: false,
		nativeToolCallSetting: false,
		enableParallelToolCalling: false,
		...initialState,
	})

	const [mcpServers, setMcpServers] = useState<McpServer[]>([])
	const [mcpMarketplaceCatalog, setMcpMarketplaceCatalog] = useState<McpMarketplaceCatalog>({ items: [] })
	const [totalTasksSize, setTotalTasksSize] = useState<number | null>(null)
	const [availableTerminalProfiles, setAvailableTerminalProfiles] = useState<TerminalProfile[]>([])
	const [expandTaskHeader, setExpandTaskHeader] = useState(true)
	const [didHydrateState, setDidHydrateState] = useState(false)
	const [showWelcome, setShowWelcome] = useState(false)
	const [onboardingModels, setOnboardingModels] = useState<OnboardingModelGroup | undefined>(undefined)

	const relinquishControlCallbacks = useRef<Set<() => void>>(new Set())

	const updateRulesToggles = useCallback((key: keyof ExtensionState, toggles: Record<string, boolean>) => {
		setState((prevState) => ({
			...prevState,
			[key]: toggles,
		}))
	}, [])

	const onRelinquishControl = useCallback((callback: () => void) => {
		relinquishControlCallbacks.current.add(callback)
		return () => {
			relinquishControlCallbacks.current.delete(callback)
		}
	}, [])

	const triggerRelinquishControl = useCallback(() => {
		relinquishControlCallbacks.current.forEach((cb) => {
			cb()
		})
	}, [])

	return (
		<GlobalStateContext.Provider
			value={{
				...state,
				mcpServers,
				mcpMarketplaceCatalog,
				totalTasksSize,
				availableTerminalProfiles,
				expandTaskHeader,
				didHydrateState,
				showWelcome,
				onboardingModels,
				setState,
				setMcpServers,
				setMcpMarketplaceCatalog,
				setTotalTasksSize,
				setAvailableTerminalProfiles,
				setExpandTaskHeader,
				setDidHydrateState,
				setShowWelcome,
				setOnboardingModels,
				updateRulesToggles,
				onRelinquishControl,
				triggerRelinquishControl,
			}}>
			{children}
		</GlobalStateContext.Provider>
	)
}

export const useGlobalState = () => {
	const context = useContext(GlobalStateContext)
	if (context === undefined) {
		throw new Error("useGlobalState must be used within a GlobalStateProvider")
	}
	return context
}
