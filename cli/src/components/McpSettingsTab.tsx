import { Box, Text } from "ink"
import React from "react"
import { Controller } from "@/core/controller"

interface McpSettingsTabProps {
	controller?: Controller
}

export const McpSettingsTab: React.FC<McpSettingsTabProps> = ({ controller }) => {
	const mcpServers = controller?.mcpHub?.getServers() || []

	return (
		<Box flexDirection="column" paddingLeft={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					Configured MCP Servers
				</Text>
			</Box>

			{mcpServers.length === 0 ? (
				<Text color="gray italic">No MCP servers configured.</Text>
			) : (
				mcpServers.map((server) => (
					<Box flexDirection="column" key={server.name} marginBottom={1}>
						<Box>
							<Text color={server.status === "connected" ? "green" : "red"}>
								{server.status === "connected" ? "● " : "○ "}
							</Text>
							<Text bold>{server.name}</Text>
							<Text color="gray"> - {server.status === "connected" ? "Connected" : "Disconnected"}</Text>
						</Box>
						<Box marginLeft={2}>
							<Text color="gray" dimColor>
								{typeof server.config === "object" && server.config !== null && "command" in server.config
									? (server.config as { command: string }).command
									: "Custom server"}
							</Text>
						</Box>
					</Box>
				))
			)}
		</Box>
	)
}
