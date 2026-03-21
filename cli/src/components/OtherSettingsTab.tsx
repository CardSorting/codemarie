import { TelemetrySetting } from "@shared/TelemetrySetting"
import { Box, Text } from "ink"
import React from "react"

interface OtherSettingsTabProps {
	preferredLanguage: string
	telemetry: TelemetrySetting
	version: string
	onToggleTelemetry: () => void
}

export const OtherSettingsTab: React.FC<OtherSettingsTabProps> = ({ preferredLanguage, telemetry, version }) => {
	return (
		<Box flexDirection="column" paddingLeft={1}>
			<Box>
				<Box width={20}>
					<Text color="gray">Preferred language: </Text>
				</Box>
				<Text>{preferredLanguage}</Text>
			</Box>

			<Box marginTop={1}>
				<Box>
					<Text color={telemetry !== "disabled" ? "green" : "red"}>{telemetry !== "disabled" ? " [x] " : " [ ] "}</Text>
					<Text color={telemetry !== "disabled" ? "white" : "gray"}>Error/usage reporting</Text>
				</Box>
				<Box marginLeft={5}>
					<Text color="gray" dimColor italic>
						Help improve Codemarie by sending anonymous usage data
					</Text>
				</Box>
			</Box>

			<Box borderBottom={false} borderLeft={false} borderRight={false} borderStyle="single" borderTop={true} marginTop={2}>
				<Text color="gray">Version: </Text>
				<Text color="white">{version}</Text>
			</Box>
		</Box>
	)
}
