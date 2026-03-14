export type AgentGitErrorCode =
	| "INVALID_USER_ID"
	| "INVALID_PROJECT_ID"
	| "INVALID_WORKSPACE_ID"
	| "REPO_EXISTS"
	| "REPO_NOT_FOUND"
	| "BRANCH_NOT_FOUND"
	| "REF_NOT_FOUND"
	| "NODE_NOT_FOUND"
	| "TREE_NOT_FOUND"
	| "FILE_NOT_FOUND"
	| "FILE_CORRUPT"
	| "IGNORED_PATH"
	| "INVALID_PATH"
	| "MERGE_CONFLICT"
	| "EMPTY_BRANCH"
	| "EMPTY_TREE"
	| "PROTECTED_BRANCH"
	| "STASH_NOT_FOUND"
	| "BISECT_INVALID_RANGE"
	| "NO_COMMON_ANCESTOR"
	| "INVALID_SQUASH_COUNT"
	| "NOT_ENOUGH_HISTORY"
	| "TIMEOUT"
	| "QUOTA_EXCEEDED"
	| "CONNECTION_FAILED"
	| "DB_NOT_READY"
	| "LOCK_TIMEOUT"
	| "FILE_LOCKED"
	| "WATCHER_ALREADY_RUNNING"
	| "INVALID_ARGUMENT"
	| "BUDGET_EXCEEDED"
export declare class AgentGitError extends Error {
	code: AgentGitErrorCode
	conflicts?: string[] | undefined
	constructor(message: string, code: AgentGitErrorCode, conflicts?: string[] | undefined)
}
//# sourceMappingURL=errors.d.ts.map
