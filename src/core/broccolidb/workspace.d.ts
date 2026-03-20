import { Connection } from "./connection"
import { Repository } from "./repository"
import * as admin from "firebase-admin"
export interface WorkspaceInfo {
	userId: string
	workspaceId: string
	createdAt: admin.firestore.Timestamp
	sharedMemoryLayer?: string[]
}
/**
 * Workspace scopes AgentGit operations to a specific user silo.
 * Repositories are stored at users/{userId}/repositories/...
 */
export declare class Workspace {
	private taskId?
	private db
	readonly userId: string
	readonly workspaceId: string
	sharedMemoryLayer: string[]
	constructor(connection: Connection, userId: string, workspaceId: string, taskId?: string | undefined)
	/** Base Firestore path for this specific workspace metadata */
	get workspacePath(): string
	/** Base path for the user silo where repositories live */
	get userBasePath(): string
	private get reposCol()
	private get workspaceRef()
	private get userRef()
	/**
	 * Initialize the workspace in Firestore, creating user and workspace docs if they
	 * don't exist.
	 */
	init(): Promise<void>
	/**
	 * Create a new repository in this user's silo and return a Repository handle.
	 */
	createRepo(repoId: string, defaultBranch?: string): Promise<Repository>
	/**
	 * Get an existing repository handle.
	 */
	getRepo(repoId: string): Promise<Repository>
	/**
	 * List all repositories in this workspace (filtered by workspaceId).
	 */
	/**
	 * List repositories in this workspace with pagination.
	 */
	listRepos(options?: { limit?: number; startAfter?: string }): Promise<string[]>
	/**
	 * Delete a repository and all its subcollections (branches, nodes, tags, files).
	 * WARNING: This is destructive.
	 */
	deleteRepo(repoId: string): Promise<void>
	/**
	 * Fork: Deep-copy an existing repo into a new repo within this workspace.
	 * The agent gets full, immediate access — no approval flow.
	 */
	fork(sourceRepoId: string, newRepoId: string): Promise<Repository>
	/**
	 * Clone: Copy a repository from a remote workspace into this workspace.
	 */
	clone(remoteWs: Workspace, remoteRepoId: string, localRepoId: string): Promise<Repository>
	/**
	 * Push: Sync local branch to remote repository.
	 */
	push(localRepoId: string, branch: string, remoteWs: Workspace, remoteRepoId: string): Promise<void>
	private _collectMerkleAssets
	private _syncCollection
	/**
	 * Pull: Sync remote branch to local repository.
	 */
	pull(localRepoId: string, branch: string, remoteWs: Workspace, remoteRepoId: string): Promise<void>
	private forkFromRemote
}
//# sourceMappingURL=workspace.d.ts.map
