import "../../../node_modules/@vscode/codicons/dist/codicon.css"
import "../../../node_modules/@vscode/codicons/dist/codicon.ttf"
import "../../src/index.css"

import type { Decorator } from "@storybook/react-vite"
import React from "react"
import { GlobalStateProvider } from "@/context/GlobalStateContext"
import { ModelStateProvider } from "@/context/ModelStateContext"
import { NavigationProvider } from "@/context/NavigationContext"
import { NotificationProvider } from "@/context/NotificationContext"
import { cn } from "@/lib/utils"
import { StorybookThemes } from "../../.storybook/themes"

// Component that handles theme switching
const ThemeHandler: React.FC<{ children: React.ReactNode; theme?: string }> = ({ children, theme }) => {
	React.useEffect(() => {
		const styles = theme?.includes("light") ? StorybookThemes.light : StorybookThemes.dark

		// Apply CSS variables to the document root
		const root = document.documentElement
		Object.entries(styles).forEach(([property, value]) => {
			root.style.setProperty(property, value)
		})

		document.body.style.backgroundColor = styles["--vscode-editor-background"]
		document.body.style.color = styles["--vscode-editor-foreground"]
		document.body.style.fontFamily = styles["--vscode-font-family"]
		document.body.style.fontSize = styles["--vscode-font-size"]

		return () => {
			// Cleanup on unmount
			Object.keys(styles).forEach((property) => {
				root.style.removeProperty(property)
			})
		}
	}, [theme])

	return <>{children}</>
}
function StorybookDecoratorProvider(className = "relative"): Decorator {
	return (story, parameters) => {
		return (
			<div className={className}>
				<GlobalStateProvider>
					<ModelStateProvider>
						<NotificationProvider>
							<NavigationProvider>
								<ThemeHandler theme={parameters?.globals?.theme}>{React.createElement(story)}</ThemeHandler>
							</NavigationProvider>
						</NotificationProvider>
					</ModelStateProvider>
				</GlobalStateProvider>
			</div>
		)
	}
}

export const createStorybookDecorator =
	(
		overrideStates?: any, // ExtensionState Partial
		classNames?: string,
	) =>
	(Story: any) => (
		<GlobalStateProvider initialState={overrideStates}>
			<ModelStateProvider>
				<NotificationProvider>
					<NavigationProvider>
						<div className={cn("max-w-lg mx-auto", classNames)}>
							<Story />
						</div>
					</NavigationProvider>
				</NotificationProvider>
			</ModelStateProvider>
		</GlobalStateProvider>
	)

export const StorybookWebview = StorybookDecoratorProvider()
