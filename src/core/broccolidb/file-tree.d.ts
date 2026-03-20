import type { Repository } from "./repository"
import admin from "firebase-admin"
export interface FileEntry {
	path: string
	content: string
	encoding: "utf-8" | "base64"
	size: number
	updatedAt: admin.firestore.Timestamp
	author: string
}
/**
 * FileTree provides file-level operations on a Repository branch.
 *
 * Each file is stored as a document in the repo's `files` subcollection.
 * The branch head's MemoryNode.tree maps filePath → fileDocId, creating an
 * immutable snapshot of the tree at each commit.
 */
export declare class FileTree {
	private db
	private repo
	private ignoreCache
	constructor(db: admin.firestore.Firestore, repo: Repository)
	private static CLAIM_TTL_MS
	private get filesCol()
	private getClaimsCol
	/** Deterministic document ID from file content and encoding (CAS) */
	private fileDocId
	private normalizePath
	/**
	 * Write or update a file on a branch. Creates a new commit with the updated tree.
	 */
	writeFile(
		branch: string,
		path: string,
		content: string,
		author: string,
		options?: {
			encoding?: "utf-8" | "base64"
			message?: string
			decisionIds?: string[] | undefined
		},
	): Promise<string>
	/**
	 * Recursively builds a hierarchical Merkle tree by path.
	 */
	private writeHierarchy
	/**
	 * Read a file from the current head of a branch.
	 */
	readFile(branch: string, path: string): Promise<FileEntry>
	/**
	 * Recursively traverses the Merkle tree to find a specific path's hash.
	 */
	private resolvePathToHash
	/**
	 * Read a file as it existed at a specific commit node.
	 */
	readFileAtNode(nodeId: string, path: string): Promise<FileEntry>
	/**
	 * Delete a file from a branch. Creates a new commit with the file removed from the tree.
	 */
	deleteFile(
		branch: string,
		path: string,
		author: string,
		options?: {
			message?: string
		},
	): Promise<string>
	/**
	 * List all files on a branch, optionally filtered by a directory prefix.
	 * Returns paths alongside their structural file sizes for LLM context management.
	 */
	listFiles(
		branch: string,
		prefix?: string,
	): Promise<
		{
			path: string
			size: number
		}[]
	>
	/**
	 * Register a sub-repository at a specific directory path.
	 * Mirroring `git submodule add`.
	 */
	addSubRepo(branch: string, path: string, subRepoId: string, author: string): Promise<string>
	/**
	 * List all sub-repositories registered in this file tree.
	 */
	listSubRepos(branch: string): Promise<Record<string, string>>
	/**
	 * Move or rename a file atomically.
	 */
	moveFile(
		branch: string,
		fromPath: string,
		toPath: string,
		author: string,
		options?: {
			message?: string
		},
	): Promise<string>
	/**
	 * Copy a file atomically using CAS pointers (zero storage overhead).
	 */
	copyFile(
		branch: string,
		fromPath: string,
		toPath: string,
		author: string,
		options?: {
			message?: string
		},
	): Promise<string>
	/**
	 * Returns a recursive, nested representation of the file tree.
	 * Useful for LLMs to understand directory structure.
	 */
	/**
	 * Lists entries in a specific directory using Merkle tree traversal.
	 * Perfect for lazy-loading UI components.
	 */
	listDirectory(
		branch: string,
		path?: string,
	): Promise<
		{
			name: string
			type: "blob" | "tree" | "subrepo"
			hash: string
		}[]
	>
	/**
	 * Returns a recursive, nested representation of the file tree.
	 * Now optimized for both flat and Merkle trees.
	 */
	getRecursiveTree(branch: string): Promise<any>
	private buildRecursiveHierarchy
	/**
	 * Internal claim validator. Throws FILE_LOCKED if another agent holds the claim.
	 */
	private checkClaim
	/**
	 * Claim a file for exclusive swarm editing. Prevents other agents from modifying it.
	 */
	claimFile(branch: string, path: string, author: string): Promise<void>
	/**
	 * Release a previously claimed file.
	 */
	releaseFile(branch: string, path: string, author: string): Promise<void>
	/**
	 * Internal helper to load and cache ignore rules per branch head.
	 */
	private getIgnoreRules
}
//# sourceMappingURL=file-tree.d.ts.map
