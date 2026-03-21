import { execSync } from "child_process"
import { useCallback, useEffect, useState } from "react"

export interface GitDiffStats {
	files: number
	additions: number
	deletions: number
}

export function useGitStats(workspacePath: string) {
	const [gitBranch, setGitBranch] = useState<string | null>(null)
	const [gitDiffStats, setGitDiffStats] = useState<GitDiffStats | null>(null)

	const getGitBranch = useCallback(() => {
		try {
			return execSync("git rev-parse --abbrev-ref HEAD", {
				cwd: workspacePath,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			}).trim()
		} catch {
			return null
		}
	}, [workspacePath])

	const getGitDiffStats = useCallback(() => {
		try {
			const output = execSync("git diff --shortstat", {
				cwd: workspacePath,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			}).trim()

			if (!output) return null

			const filesMatch = output.match(/(\d+) file/)
			const addMatch = output.match(/(\d+) insertion/)
			const delMatch = output.match(/(\d+) deletion/)

			return {
				files: filesMatch ? Number.parseInt(filesMatch[1], 10) : 0,
				additions: addMatch ? Number.parseInt(addMatch[1], 10) : 0,
				deletions: delMatch ? Number.parseInt(delMatch[1], 10) : 0,
			}
		} catch {
			return null
		}
	}, [workspacePath])

	useEffect(() => {
		setGitBranch(getGitBranch())
		setGitDiffStats(getGitDiffStats())
	}, [workspacePath, getGitBranch, getGitDiffStats])

	return {
		gitBranch,
		gitDiffStats,
		refresh: () => {
			setGitBranch(getGitBranch())
			setGitDiffStats(getGitDiffStats())
		},
	}
}
