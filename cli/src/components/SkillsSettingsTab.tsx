import { Box, Text } from "ink"
import React from "react"
import { SkillInfo } from "./App"

interface SkillsSettingsTabProps {
	globalSkills: SkillInfo[]
	localSkills: SkillInfo[]
}

export const SkillsSettingsTab: React.FC<SkillsSettingsTabProps> = ({ globalSkills, localSkills }) => {
	const hasSkills = globalSkills.length > 0 || localSkills.length > 0

	if (!hasSkills) {
		return (
			<Box paddingLeft={1}>
				<Text color="gray italic">No skills configured.</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column" paddingLeft={1}>
			{globalSkills.length > 0 && (
				<Box flexDirection="column" marginBottom={1}>
					<Text bold color="cyan">
						Global Skills
					</Text>
					{globalSkills.map((skill) => (
						<Box flexDirection="column" key={skill.path}>
							<Box>
								<Text color={skill.enabled ? "green" : "red"}>{skill.enabled ? " [x] " : " [ ] "}</Text>
								<Text color={skill.enabled ? "white" : "gray"}>{skill.name}</Text>
							</Box>
							<Box marginLeft={5}>
								<Text color="gray" dimColor italic>
									{skill.description}
								</Text>
							</Box>
						</Box>
					))}
				</Box>
			)}

			{localSkills.length > 0 && (
				<Box flexDirection="column" marginBottom={1}>
					<Text bold color="cyan">
						Workspace Skills
					</Text>
					{localSkills.map((skill) => (
						<Box flexDirection="column" key={skill.path}>
							<Box>
								<Text color={skill.enabled ? "green" : "red"}>{skill.enabled ? " [x] " : " [ ] "}</Text>
								<Text color={skill.enabled ? "white" : "gray"}>{skill.name}</Text>
							</Box>
							<Box marginLeft={5}>
								<Text color="gray" dimColor italic>
									{skill.description}
								</Text>
							</Box>
						</Box>
					))}
				</Box>
			)}
		</Box>
	)
}
