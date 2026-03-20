import { type ReactNode } from "react"
import { CustomPostHogProvider } from "./CustomPostHogProvider"
import { AuthProvider } from "./context/AuthContext"
import { GlobalStateProvider } from "./context/GlobalStateContext"
import { ModelStateProvider } from "./context/ModelStateContext"
import { NavigationProvider } from "./context/NavigationContext"
import { NotificationProvider } from "./context/NotificationContext"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<GlobalStateProvider>
			<ModelStateProvider>
				<AuthProvider>
					<NavigationProvider>
						<NotificationProvider>
							<CustomPostHogProvider>{children}</CustomPostHogProvider>
						</NotificationProvider>
					</NavigationProvider>
				</AuthProvider>
			</ModelStateProvider>
		</GlobalStateProvider>
	)
}
