import { type ReactNode } from "react"
import { GlobalStateProvider } from "../context/GlobalStateContext"
import { ModelStateProvider } from "../context/ModelStateContext"
import { NavigationProvider } from "../context/NavigationContext"
import { NotificationProvider } from "../context/NotificationContext"

interface TestProvidersProps {
	children: ReactNode
	initialState?: any
}

export const TestProviders = ({ children, initialState }: TestProvidersProps) => {
	return (
		<GlobalStateProvider initialState={initialState}>
			<ModelStateProvider>
				<NavigationProvider>
					<NotificationProvider>{children}</NotificationProvider>
				</NavigationProvider>
			</ModelStateProvider>
		</GlobalStateProvider>
	)
}

// Shorthand for tests that were using ExtensionStateContextProvider
export const ExtensionStateContextProvider = TestProviders
