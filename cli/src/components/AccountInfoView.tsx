/**
 * Account info view component
 * Shows current provider, and for Codemarie provider: credit balance and organization name
 */

import { Box, Text } from "ink"
import React, { useEffect, useState } from "react"
import type { Controller } from "@/core/controller"
import { StateManager } from "@/core/storage/StateManager"
import { useAccount } from "../hooks/useAccount"
import { LoadingSpinner } from "./Spinner"

interface AccountInfoViewProps {
	controller: Controller
}

/**
 * Capitalize provider name for display
 */
function capitalize(str: string): string {
	return str
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
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

export const AccountInfoView: React.FC<AccountInfoViewProps> = React.memo(({ controller }) => {
	const { email, balance, organization, isLoading } = useAccount(controller)
	const [provider, setProvider] = useState<string | null>(null)

	useEffect(() => {
		// Get current provider from state
		const stateManager = StateManager.get()
		const mode = (stateManager.getGlobalSettingsKey("mode") as string) || "act"
		const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const currentProvider = stateManager.getGlobalSettingsKey(providerKey) as string
		setProvider(currentProvider || "codemarie")
	}, [])

	if (isLoading) {
		return (
			<Box>
				<LoadingSpinner />
				<Text color="gray"> Loading account info...</Text>
			</Box>
		)
	}

	// If not using Codemarie provider, just show the provider name
	if (provider !== "codemarie") {
		return (
			<Box>
				<Text color="gray">Provider: </Text>
				<Text color="cyan">{capitalize(provider || "Not configured")}</Text>
			</Box>
		)
	}

	// Codemarie provider but not logged in
	if (!email) {
		return (
			<Box>
				<Text color="gray">Provider: </Text>
				<Text color="cyan">Codemarie</Text>
				<Text color="gray"> • </Text>
				<Text color="yellow">Not logged in (run 'codemarie auth' to sign in)</Text>
			</Box>
		)
	}

	// Codemarie provider - show full account info
	return (
		<Box flexDirection="column">
			<Box>
				<Text color="gray">Provider: </Text>
				<Text color="cyan">Codemarie</Text>
				<Box>
					<Text color="gray"> • </Text>
					<Text color="white">{email}</Text>
				</Box>
			</Box>
			<Box>
				{organization ? (
					<Box>
						<Text color="gray">Organization: </Text>
						<Text color="magenta">{organization.name}</Text>
					</Box>
				) : (
					<Box>
						<Text color="gray">Account: </Text>
						<Text color="white">Personal</Text>
					</Box>
				)}
				<Text color="gray"> • Credits: </Text>
				<Text color="green">{formatBalance(balance)}</Text>
			</Box>
		</Box>
	)
})
