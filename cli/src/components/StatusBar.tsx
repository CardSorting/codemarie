/**
 * Status bar component
 * Shows git branch, model, context window usage, token count, and cost
 */

import { Box, Text } from "ink"
import React, { useEffect, useMemo, useState } from "react"
import type { GitDiffStats } from "../hooks/useGitStats"
import { getGitBranch } from "../utils/git"

interface StatusBarProps {
	modelId: string
	tokensIn?: number
	tokensOut?: number
	totalCost?: number
	contextWindowSize?: number
	cwd?: string
	gitBranch?: string | null
	gitDiffStats?: GitDiffStats | null
}

/**
 * Get directory basename
 */
function getDirName(cwd?: string): string {
	const path = cwd || process.cwd()
	return path.split("/").pop() || path
}

/**
 * Format number with commas
 */
function formatNumber(num: number): string {
	return num.toLocaleString()
}

/**
 * Create a progress bar for context window usage
 */
function createContextBar(used: number, total: number, width = 8): string {
	const ratio = Math.min(used / total, 1)
	const filled = Math.round(ratio * width)
	const empty = width - filled
	return "█".repeat(filled) + "░".repeat(empty)
}

export const StatusBar: React.FC<StatusBarProps> = ({
	modelId,
	tokensIn = 0,
	tokensOut = 0,
	totalCost = 0,
	contextWindowSize = 200000, // Default Claude context window
	cwd,
	gitBranch,
	gitDiffStats,
}) => {
	const [localBranch, setLocalBranch] = useState<string | null>(null)
	const dirName = useMemo(() => getDirName(cwd), [cwd])

	const branch = gitBranch !== undefined ? gitBranch : localBranch

	useEffect(() => {
		if (gitBranch === undefined) {
			setLocalBranch(getGitBranch(cwd))
		}
	}, [cwd, gitBranch])

	const totalTokens = useMemo(() => tokensIn + tokensOut, [tokensIn, tokensOut])
	const contextBar = useMemo(() => createContextBar(totalTokens, contextWindowSize), [totalTokens, contextWindowSize])

	// Format model ID for display (shorten if needed)
	const displayModel = modelId.length > 20 ? `${modelId.substring(0, 17)}...` : modelId

	return (
		<Box flexDirection="column">
			<Box gap={1}>
				{/* Directory and branch */}
				<Box>
					<Text color="gray">{dirName}</Text>
					{branch && (
						<Text color="gray">
							{" "}
							(<Text color="cyan">{branch}</Text>)
						</Text>
					)}
					{gitDiffStats && (
						<Text>
							{gitDiffStats.additions > 0 && <Text color="green"> +{gitDiffStats.additions}</Text>}
							{gitDiffStats.deletions > 0 && <Text color="red"> -{gitDiffStats.deletions}</Text>}
						</Text>
					)}
				</Box>
				<Text color="gray">|</Text>

				{/* Model and context bar */}
				<Text color="white">{displayModel}</Text>
				<Text color="blue">{contextBar}</Text>
				<Text color="gray">({formatNumber(totalTokens)})</Text>
				<Text color="gray">|</Text>

				{/* Cost */}
				<Text color="green">${totalCost.toFixed(4)}</Text>
			</Box>
		</Box>
	)
}
