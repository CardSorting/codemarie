import type React from "react"
import { createContext, useCallback, useContext, useState } from "react"
import type { McpViewTab } from "../../../src/shared/mcp"

export type View = "chat" | "mcp" | "settings" | "history" | "account" | "worktrees"

export interface NavigationOptions {
	mcpTab?: McpViewTab
	settingsTargetSection?: string
	settingsInitialModelTab?: "recommended" | "free"
}

export interface NavigationContextType {
	activeView: View
	mcpTab?: McpViewTab
	settingsTargetSection?: string
	settingsInitialModelTab?: "recommended" | "free"
	navigateTo: (view: View, options?: NavigationOptions) => void
	navigateToMcp: (tab?: McpViewTab) => void
	navigateToSettings: (targetSection?: string) => void
	navigateToSettingsModelPicker: (opts: { targetSection?: string; initialModelTab?: "recommended" | "free" }) => void
	navigateToHistory: () => void
	navigateToAccount: () => void
	navigateToWorktrees: () => void
	navigateToChat: () => void
	hideSettings: () => void
	hideHistory: () => void
	hideAccount: () => void
	hideWorktrees: () => void
	closeMcpView: () => void
	setMcpTab: (tab: McpViewTab | undefined) => void
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined)

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [activeView, setActiveView] = useState<View>("chat")
	const [mcpTab, setMcpTab] = useState<McpViewTab | undefined>(undefined)
	const [settingsTargetSection, setSettingsTargetSection] = useState<string | undefined>(undefined)
	const [settingsInitialModelTab, setSettingsInitialModelTab] = useState<"recommended" | "free" | undefined>(undefined)

	const navigateTo = useCallback((view: View, options?: NavigationOptions) => {
		setActiveView(view)
		if (options?.mcpTab !== undefined || view !== "mcp") {
			setMcpTab(options?.mcpTab)
		}
		if (options?.settingsTargetSection !== undefined || view !== "settings") {
			setSettingsTargetSection(options?.settingsTargetSection)
		}
		if (options?.settingsInitialModelTab !== undefined || view !== "settings") {
			setSettingsInitialModelTab(options?.settingsInitialModelTab)
		}
	}, [])

	const navigateToMcp = useCallback((tab?: McpViewTab) => navigateTo("mcp", { mcpTab: tab }), [navigateTo])
	const navigateToSettings = useCallback(
		(targetSection?: string) => navigateTo("settings", { settingsTargetSection: targetSection }),
		[navigateTo],
	)
	const navigateToSettingsModelPicker = useCallback(
		(opts: { targetSection?: string; initialModelTab?: "recommended" | "free" }) => {
			navigateTo("settings", {
				settingsTargetSection: opts.targetSection,
				settingsInitialModelTab: opts.initialModelTab,
			})
		},
		[navigateTo],
	)
	const navigateToHistory = useCallback(() => navigateTo("history"), [navigateTo])
	const navigateToAccount = useCallback(() => navigateTo("account"), [navigateTo])
	const navigateToWorktrees = useCallback(() => navigateTo("worktrees"), [navigateTo])
	const navigateToChat = useCallback(() => navigateTo("chat"), [navigateTo])

	const hideSettings = useCallback(() => navigateTo("chat"), [navigateTo])
	const hideHistory = useCallback(() => navigateTo("chat"), [navigateTo])
	const hideAccount = useCallback(() => navigateTo("chat"), [navigateTo])
	const hideWorktrees = useCallback(() => navigateTo("chat"), [navigateTo])
	const closeMcpView = useCallback(() => navigateTo("chat"), [navigateTo])

	return (
		<NavigationContext.Provider
			value={{
				activeView,
				mcpTab,
				settingsTargetSection,
				settingsInitialModelTab,
				navigateTo,
				navigateToMcp,
				navigateToSettings,
				navigateToSettingsModelPicker,
				navigateToHistory,
				navigateToAccount,
				navigateToWorktrees,
				navigateToChat,
				hideSettings,
				hideHistory,
				hideAccount,
				hideWorktrees,
				closeMcpView,
				setMcpTab,
			}}>
			{children}
		</NavigationContext.Provider>
	)
}

export const useNavigation = () => {
	const context = useContext(NavigationContext)
	if (context === undefined) {
		throw new Error("useNavigation must be used within a NavigationProvider")
	}
	return context
}
