import { type ReactNode } from "react"
import { CustomPostHogProvider } from "./CustomPostHogProvider"
import { GlobalStateProvider } from "./context/GlobalStateContext"
import { ModelStateProvider } from "./context/ModelStateContext"
import { NavigationProvider } from "./context/NavigationContext"
import { NotificationProvider } from "./context/NotificationContext"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<GlobalStateProvider>
			<ModelStateProvider>
				<NavigationProvider>
					<NotificationProvider>
						<CustomPostHogProvider>{children}</CustomPostHogProvider>
					</NotificationProvider>
				</NavigationProvider>
			</ModelStateProvider>
		</GlobalStateProvider>
	)
}
