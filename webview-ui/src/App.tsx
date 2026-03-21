import type { Boolean, EmptyRequest } from "@shared/proto/codemarie/common"
import { useCallback, useEffect } from "react"
import AccountView from "./components/account/AccountView"
import ChatView from "./components/chat/ChatView"
import { ErrorBoundary } from "./components/common/ErrorBoundary"
import { NotificationCenter } from "./components/common/NotificationCenter"
import HistoryView from "./components/history/HistoryView"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import OnboardingView from "./components/onboarding/OnboardingView"
import SettingsView from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import WorktreesView from "./components/worktrees/WorktreesView"
import { useAuth } from "./context/AuthContext"
import { useGlobalState } from "./context/GlobalStateContext"
import { useNavigation } from "./context/NavigationContext"
import { Providers } from "./Providers"
import { SystemServiceClient } from "./services/protobus-client"

const AppContent = () => {
	const { didHydrateState, showWelcome, shouldShowAnnouncement, onboardingModels, setState } = useGlobalState()

	const {
		activeView,
		mcpTab,
		settingsTargetSection,
		navigateToHistory,
		hideSettings,
		hideHistory,
		hideAccount,
		hideWorktrees,
		closeMcpView,
	} = useNavigation()

	useAuth()

	const showAnnouncement = shouldShowAnnouncement
	const setShouldShowAnnouncement = useCallback(
		(value: boolean) => setState((prev) => ({ ...prev, shouldShowAnnouncement: value })),
		[setState],
	)
	const hideAnnouncement = () => setState((prev) => ({ ...prev, shouldShowAnnouncement: false }))

	useEffect(() => {
		if (shouldShowAnnouncement) {
			// Use the Protobus client instead of direct WebviewMessage
			SystemServiceClient.onDidShowAnnouncement({} as EmptyRequest)
				.then((response: Boolean) => {
					setShouldShowAnnouncement(response.value)
				})
				.catch((error) => {
					console.error("Failed to acknowledge announcement:", error)
				})
		}
	}, [shouldShowAnnouncement, setShouldShowAnnouncement])

	if (!didHydrateState) {
		return null
	}

	if (showWelcome) {
		return (
			<ErrorBoundary>
				{onboardingModels ? <OnboardingView onboardingModels={onboardingModels} /> : <WelcomeView />}
			</ErrorBoundary>
		)
	}

	return (
		<ErrorBoundary>
			<div className="flex h-screen w-full flex-col">
				<NotificationCenter />
				{activeView === "settings" && <SettingsView onDone={hideSettings} targetSection={settingsTargetSection} />}
				{activeView === "history" && <HistoryView onDone={hideHistory} />}
				{activeView === "mcp" && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
				{activeView === "account" && <AccountView onDone={hideAccount} />}
				{activeView === "worktrees" && <WorktreesView onDone={hideWorktrees} />}
				{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
				<ChatView
					hideAnnouncement={hideAnnouncement}
					isHidden={activeView !== "chat"}
					showAnnouncement={showAnnouncement}
					showHistoryView={navigateToHistory}
				/>
			</div>
		</ErrorBoundary>
	)
}

const App = () => {
	return (
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
