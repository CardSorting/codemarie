import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { Box, Text } from "ink"
import React from "react"

interface AutoApproveSettingsTabProps {
	settings: AutoApprovalSettings
	onToggleAction: (key: string) => void
	onToggleNotification: () => void
}

export const AutoApproveSettingsTab: React.FC<AutoApproveSettingsTabProps> = ({ settings }) => {
	const { actions, enableNotifications } = settings

	const renderActionRow = (key: string, label: string, description: string, isSubItem = false) => {
		const enabled = (actions as any)[key] ?? false
		return (
			<Box flexDirection="column" key={key} marginLeft={isSubItem ? 2 : 0}>
				<Box>
					<Text color={enabled ? "green" : "red"}>{enabled ? " [x] " : " [ ] "}</Text>
					<Text color={enabled ? "white" : "gray"}>{label}</Text>
				</Box>
				<Box marginLeft={5}>
					<Text color="gray" dimColor italic>
						{description}
					</Text>
				</Box>
			</Box>
		)
	}

	return (
		<Box flexDirection="column" paddingLeft={1}>
			{renderActionRow("readFiles", "Read project files", "Read files in the working directory")}
			{actions.readFiles &&
				renderActionRow("readFilesExternally", "Read all files", "Read files outside working directory", true)}

			<Box marginTop={1}>{renderActionRow("editFiles", "Edit project files", "Edit files in the working directory")}</Box>
			{actions.editFiles &&
				renderActionRow("editFilesExternally", "Edit all files", "Edit files outside working directory", true)}

			<Box marginTop={1}>
				{renderActionRow("executeSafeCommands", "Execute safe commands", "Run low-risk terminal commands")}
			</Box>
			{actions.executeSafeCommands &&
				renderActionRow("executeAllCommands", "Execute all commands", "Run any terminal command", true)}

			<Box marginTop={1}>{renderActionRow("useBrowser", "Use the browser", "Browse and interact with web pages")}</Box>

			<Box marginTop={1}>{renderActionRow("useMcp", "Use MCP servers", "Use Model Context Protocol tools")}</Box>

			<Box
				borderBottom={false}
				borderLeft={false}
				borderRight={false}
				borderStyle="single"
				borderTop={true}
				marginTop={1}
				paddingTop={1}>
				<Box>
					<Text color={enableNotifications ? "green" : "red"}>{enableNotifications ? " [x] " : " [ ] "}</Text>
					<Text color={enableNotifications ? "white" : "gray"}>Enable notifications</Text>
				</Box>
				<Box marginLeft={5}>
					<Text color="gray" dimColor italic>
						System alerts when Codemarie needs your attention
					</Text>
				</Box>
			</Box>
		</Box>
	)
}
