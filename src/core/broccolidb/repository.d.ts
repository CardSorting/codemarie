import { Connection } from "./connection"
import { FileTree } from "./file-tree"
import type { FileEntry } from "./file-tree"
import { LRUCache } from "./lru-cache"
import admin from "firebase-admin"
export interface Usage {
	promptTokens: number
	completionTokens: number
	totalTokens: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
	totalCost?: number
	timeToFirstTokenMs?: number
	durationMs?: number
	provider?: string
	modelId?: string
	pricingTier?: "tier-high" | "tier-medium" | "tier-low" | "default"
}
export interface MemoryNode {
	id: string
	parentId: string | null
	data: any
	message: string
	timestamp: admin.firestore.Timestamp
	author: string
	type: "snapshot" | "summary" | "diff"
	tree?: Record<string, string> | undefined
	changes?: Record<string, string> | undefined
	usage?: Usage | undefined
	metadata?:
		| {
				treeHash?: string
				isHierarchical?: boolean
				taskId?: string
				decisionIds?: string[]
				environment?: any
				[key: string]: any
		  }
		| undefined
}
export interface Branch {
	name: string
	head: string
	createdAt: admin.firestore.Timestamp
}
export interface DiffResult {
	added: string[]
	removed: string[]
	modified: string[]
	unchanged: string[]
}
export interface StatusResult {
	branch: string
	headNodeId: string | null
	headMessage: string | null
	headAuthor: string | null
	fileCount: number
	files: string[]
	commitCount: number
}
export interface BlameEntry {
	path: string
	lastAuthor: string
	lastMessage: string
	lastNodeId: string
	lastTimestamp: admin.firestore.Timestamp
}
export interface StashEntry {
	id: string
	branch: string
	label: string
}
export interface RefLogEntry {
	id: string
	ref: string
	oldHead: string | null
	newHead: string
	author: string
	message: string
	timestamp: admin.firestore.Timestamp
	operation: "commit" | "reset" | "merge" | "rebase" | "cherry-pick" | "revert" | "stash-pop"
}
export interface LogOptions {
	author?: string
	messageRegex?: string
	since?: Date
	until?: Date
	limit?: number
	taskId?: string
}
export interface ConflictResult {
	hasConflicts: boolean
	conflicts: string[]
	mergedTree: Record<string, string>
}
export interface TreeEntry {
	type: "blob" | "tree" | "subrepo"
	hash: string
}
export interface TreeSnapshot {
	id: string
	entries: Record<string, TreeEntry>
}
export interface PatchData {
	baseNodeId: string
	targetNodeId: string
	nodes: MemoryNode[]
	files: Record<string, any>
}
export declare class Repository {
	private db
	private basePath
	private taskId?
	private nodeCache
	private refCache
	private fileCache
	private rawTreeCache
	constructor(dbOrConnection: admin.firestore.Firestore | Connection, basePathOrRepoId: string)
	private get branchesCol()
	private get nodesCol()
	private get tagsCol()
	private get filesCol()
	private get globalFilesCol()
	private get treesCol()
	private get stashesCol()
	private get refLogCol()
	getGlobalFilesCol(): admin.firestore.CollectionReference<admin.firestore.DocumentData, admin.firestore.DocumentData>
	files(): FileTree
	getBasePath(): string
	getDb(): admin.firestore.Firestore
	getTreesCol(): admin.firestore.CollectionReference<admin.firestore.DocumentData, admin.firestore.DocumentData>
	getFileCache(): LRUCache<string, FileEntry>
	setTaskId(taskId: string): void
	private recordRefLog
	resolveRef(ref: string): Promise<string>
	private getNode
	/**
	 * Bulk fetch nodes in a single round-trip.
	 */
	bulkGetNodes(nodeIds: string[]): Promise<MemoryNode[]>
	createBranch(
		name: string,
		fromBranchOrNode?: string,
		options?: {
			isEphemeral?: boolean
		},
	): Promise<void>
	listBranches(options?: { limit?: number; startAfter?: string }): Promise<string[]>
	deleteBranch(name: string): Promise<void>
	commit(
		branchName: string,
		data: any,
		author: string,
		message?: string,
		options?: {
			type?: "snapshot" | "summary" | "diff"
			usage?: Usage
			metadata?: Record<string, any>
			decisionIds?: string[]
		},
	): Promise<string>
	/**
	 * Offloads side-effects from the hot-path so commit returns near-instantly.
	 * Catches all errors internally so the backend doesn't crash on unhandled rejections.
	 */
	private enqueuePostCommitWork
	/**
	 * Internal logic for committing within an existing transaction.
	 * This allows external components (like FileTree) to batch file writes and commits together.
	 */
	commitInTransaction(
		transaction: admin.firestore.Transaction,
		branchName: string,
		nodeId: string,
		data: any,
		author: string,
		message?: string,
		options?: {
			type?: "snapshot" | "summary" | "diff"
			usage?: Usage
			metadata?: Record<string, any>
			decisionIds?: string[]
		},
	): Promise<void>
	/**
	 * Generates a new node ID without committing.
	 */
	generateNodeId(): string
	checkout(branchOrRef: string): Promise<MemoryNode | null>
	private treeCache
	/**
	 * Exposes tree cache statistics for observability
	 */
	getTreeCacheStats(): {
		size: number
		hits: number
		misses: number
	}
	/**
	 * Force clear the tree cache
	 */
	clearTreeCache(): void
	/**
	 * Deterministic hash for a tree snapshot.
	 */
	private treeHash
	/**
	 * Writes a tree snapshot to the CAS trees collection.
	 */
	writeTree(transaction: admin.firestore.Transaction, entries: Record<string, TreeEntry>): Promise<string>
	/**
	 * Writes a tree snapshot to the CAS trees collection outside of a transaction.
	 * Useful for operations that don't need transactional integrity for tree writes.
	 */
	writeTreeIsolated(entries: Record<string, TreeEntry>): Promise<string>
	/**
	 * Reads a tree snapshot by hash.
	 */
	readTree(hash: string): Promise<TreeSnapshot>
	/**
	 * Non-transactional tree resolver for traversal.
	 */
	getTree(hash: string): Promise<Record<string, TreeEntry>>
	/**
	 * Recursively resolves the full tree for a diff-based node.
	 * Now updated to support Hierarchical Merkle Trees.
	 */
	resolveTree(node: MemoryNode): Promise<Record<string, string>>
	private flattenTree
	tag(tagName: string, branchOrNode: string): Promise<void>
	listTags(options?: { limit?: number; startAfter?: string }): Promise<string[]>
	history(branchOrNode: string, limit?: number): Promise<MemoryNode[]>
	merge(sourceBranch: string, targetBranch: string, author: string): Promise<string | null>
	/**
	 * Speculative Merge Simulation: Forecasts conflicts and blast radius without writing a commit.
	 * Perfect for "What-If" analysis in agentic swarms.
	 */
	simulateMerge(
		sourceRef: string,
		targetRef: string,
	): Promise<
		ConflictResult & {
			lcaId: string | null
			affectedPaths: string[]
		}
	>
	/**
	 * Recursively identifies paths that differ between two tree hashes.
	 */
	private calculateAffectedPaths
	/**
	 * Performs a hierarchical three-way merge using Merkle hashes.
	 * Drastically faster for large trees as it skips unchanged sub-directories with O(1) comparison.
	 */
	mergeTrees(
		transaction: admin.firestore.Transaction,
		baseHash: string | null,
		sourceHash: string | null,
		targetHash: string | null,
	): Promise<{
		hash: string
		conflicts: string[]
	}>
	private calculateMerge
	summarize(branchName: string, summaryData: any, author: string, message?: string): Promise<string>
	diff(refA: string, refB: string): Promise<DiffResult>
	stash(branch: string, label?: string): Promise<string>
	stashPop(stashId: string, branch: string, author: string): Promise<string>
	listStashes(): Promise<StashEntry[]>
	reset(
		branch: string,
		targetRef: string,
		author: string,
		options?: {
			mode?: "hard" | "soft"
			usage?: Usage
			metadata?: Record<string, any>
		},
	): Promise<void>
	revert(branch: string, nodeIdToRevert: string, author: string): Promise<string>
	/**
	 * Performs an Enterprise-Grade Mark-and-Sweep Garbage Collection.
	 * 1. Vaporizes expired ephemeral Ghost Branches.
	 * 2. Prunes unreachable Nodes (Commit History).
	 * 3. Prunes unreachable Tree snapshots (Merkle Structure).
	 */
	gc(): Promise<{
		prunedNodes: number
		prunedTrees: number
		vaporizedBranches: number
	}>
	private markReachable
	private markTreeReachable
	cherryPick(nodeId: string, targetBranch: string, author: string): Promise<string>
	status(branch: string): Promise<StatusResult>
	blame(branch: string, filePath: string): Promise<BlameEntry>
	/**
	 * Rebase: Replay commits from 'branch' onto 'ontoRef'.
	 * Zero gates. Agent does it, we mirror.
	 */
	rebase(branch: string, ontoRef: string, author: string): Promise<string>
	/**
	 * Squash the last N commits of a branch into one.
	 */
	squash(branch: string, count: number, author: string, message: string): Promise<string>
	getRefLog(
		branch: string,
		options?: {
			limit?: number
		},
	): Promise<RefLogEntry[]>
	log(branch: string, options?: LogOptions): Promise<MemoryNode[]>
	private findLCA
	private hooks
	registerHook(event: "pre-commit" | "post-commit" | "post-merge", callback: (data: any) => Promise<void>): void
	private triggerHook
	/**
	 * Bisect: Automated binary search through history to find a "bad" commit.
	 * testFn should return true if commit is "good", false if "bad".
	 */
	bisect(badRef: string, goodRef: string, testFn: (node: MemoryNode) => Promise<boolean>): Promise<MemoryNode>
	/**
	 * Create a portable patch between two refs.
	 */
	createPatch(fromRef: string, toRef: string): Promise<PatchData>
	/**
	 * Apply a portable patch to a branch.
	 */
	applyPatch(branch: string, patch: PatchData, author: string): Promise<string>
	/**
	 * Semantic Context Routing
	 * Analyzes history to find files frequently co-modified with the target file.
	 */
	getContextGraph(
		branch: string,
		filePath: string,
		limit?: number,
	): Promise<
		{
			path: string
			weight: number
		}[]
	>
	/**
	 * Chronological Time Travel
	 * Uses the reflog to safely rollback the branch to its exact state before the given timestamp.
	 */
	timeTravel(branch: string, targetTime: Date, author: string): Promise<string>
	/**
	 * Generates a high-level, RAG-ready structural changelog between two references.
	 */
	generateChangelog(baseRef: string, headRef: string): Promise<string>
	/**
	 * Agentic Self-Healing: Finds the last previously known state of a deleted/corrupted file and restores it.
	 */
	recoverFile(branch: string, filePath: string, author: string): Promise<string>
	/**
	 * Identifies "Spaghetti Files" or architectural choke points.
	 * Ranks files based on Churn (how often modified) and Contention (how many agents modified it).
	 */
	detectChokepoints(
		branch: string,
		limit?: number,
	): Promise<
		{
			path: string
			score: number
			churn: number
			authors: number
		}[]
	>
	/**
	 * Recursive Semantic Impact Analysis.
	 * Walks the structural commit history to find secondary and tertiary dependencies.
	 */
	calculateBlastRadius(
		branch: string,
		filePath: string,
		maxDepth?: number,
	): Promise<
		{
			path: string
			depth: number
		}[]
	>
}
//# sourceMappingURL=repository.d.ts.map
