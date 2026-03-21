import { Box, Text } from "ink"
import React from "react"
import { Controller } from "@/core/controller"
import { COLORS } from "../constants/colors"
import { useAccount } from "../hooks/useAccount"
import { LoadingSpinner } from "./Spinner"

interface AccountSettingsTabProps {
	controller?: Controller
}

/**
 * Format balance as currency (balance is in microcredits)
 */
function formatBalance(balance: number | null): string {
	if (balance === null || balance === undefined) {
		return "..."
	}
	return `$${(balance / 1000000).toFixed(2)}`
}

export const AccountSettingsTab: React.FC<AccountSettingsTabProps> = ({ controller }) => {
	const { email, balance, organization, organizations, isLoading, isWaitingForAuth } = useAccount(controller)

	if (isLoading || isWaitingForAuth) {
		return (
			<Box flexDirection="column" paddingLeft={1}>
				<Box>
					<LoadingSpinner />
					<Text color="gray"> {isWaitingForAuth ? "Waiting for authentication..." : "Loading account info..."}</Text>
				</Box>
			</Box>
		)
	}

	if (!email) {
		return (
			<Box flexDirection="column" paddingLeft={1}>
				<Text color="gray">Not signed in to Codemarie.</Text>
				<Box marginTop={1}>
					<Text color={COLORS.primaryBlue}>[Enter] </Text>
					<Text>Sign in with Codemarie</Text>
				</Box>
			</Box>
		)
	}

	return (
		<Box flexDirection="column" paddingLeft={1}>
			<Box marginBottom={1}>
				<Text bold color={COLORS.primaryBlue}>
					Account Details
				</Text>
			</Box>

			<Box>
				<Box width={15}>
					<Text color="gray">Email: </Text>
				</Box>
				<Text>{email}</Text>
			</Box>

			<Box>
				<Box width={15}>
					<Text color="gray">Credits: </Text>
				</Box>
				<Text color="green">{formatBalance(balance)}</Text>
			</Box>

			<Box>
				<Box width={15}>
					<Text color="gray">Organization: </Text>
				</Box>
				<Text color="magenta">{organization?.name || "Personal"}</Text>
			</Box>

			{organizations && organizations.length > 1 && (
				<Box flexDirection="column" marginTop={1}>
					<Text color="gray italic">Press [Enter] on Organization to switch</Text>
				</Box>
			)}

			<Box marginTop={2}>
				<Text color="red">Sign out</Text>
				<Text color="gray"> (Press [Enter] on 'Sign out' to logout)</Text>
			</Box>
		</Box>
	)
}
