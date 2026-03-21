import { Box, Text } from "ink"
import React from "react"
import { HookInfo, WorkspaceHooks } from "./App"

interface HooksSettingsTabProps {
	globalHooks: HookInfo[]
	workspaceHooks: WorkspaceHooks[]
}

export const HooksSettingsTab: React.FC<HooksSettingsTabProps> = ({ globalHooks, workspaceHooks }) => {
	const hasHooks = globalHooks.length > 0 || workspaceHooks.some((ws) => ws.hooks.length > 0)

	if (!hasHooks) {
		return (
			<Box paddingLeft={1}>
				<Text color="gray italic">No hooks configured.</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column" paddingLeft={1}>
			{globalHooks.length > 0 && (
				<Box flexDirection="column" marginBottom={1}>
					<Text bold color="cyan">
						Global Hooks
					</Text>
					{globalHooks.map((hook) => (
						<Box key={hook.name}>
							<Text color={hook.enabled ? "green" : "red"}>{hook.enabled ? " [x] " : " [ ] "}</Text>
							<Text color={hook.enabled ? "white" : "gray"}>{hook.name}</Text>
						</Box>
					))}
				</Box>
			)}

			{workspaceHooks.map(
				(ws) =>
					ws.hooks.length > 0 && (
						<Box flexDirection="column" key={ws.workspaceName} marginBottom={1}>
							<Text bold color="cyan">
								{ws.workspaceName} Hooks
							</Text>
							{ws.hooks.map((hook) => (
								<Box key={hook.name}>
									<Text color={hook.enabled ? "green" : "red"}>{hook.enabled ? " [x] " : " [ ] "}</Text>
									<Text color={hook.enabled ? "white" : "gray"}>{hook.name}</Text>
								</Box>
							))}
						</Box>
					),
			)}
		</Box>
	)
}
