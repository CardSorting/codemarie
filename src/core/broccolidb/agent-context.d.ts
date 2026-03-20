import admin from "firebase-admin"
import { Workspace } from "./workspace"
import { EmbeddingService } from "./embedding"
export interface AgentProfile {
	agentId: string
	name: string
	role: string
	permissions: string[]
	memoryLayer?: string[]
	createdAt: admin.firestore.Timestamp
	lastActive: admin.firestore.Timestamp
}
export interface GraphEdge {
	targetId: string
	type: "supports" | "contradicts" | "blocks" | "depends_on" | "references"
	weight?: number
}
export interface KnowledgeBaseItem {
	itemId: string
	type: "fact" | "vector" | "rule"
	content: string
	tags: string[]
	edges: GraphEdge[]
	inboundEdges: GraphEdge[]
	embedding?: number[]
	confidence: number
	hubScore: number
	expiresAt?: admin.firestore.Timestamp
	metadata?: Record<string, any>
	createdAt: admin.firestore.Timestamp
}
export interface AgentBundle {
	profile: AgentProfile
	taskContext?: TaskContext
	activeTasks: TaskItem[]
	recentKnowledge: KnowledgeBaseItem[]
}
export interface TaskItem {
	taskId: string
	agentId: string
	status: "pending" | "active" | "completed" | "failed"
	description: string
	complexity: number
	linkedKnowledgeIds?: string[]
	result?: any
	createdAt: admin.firestore.Timestamp
	updatedAt: admin.firestore.Timestamp
}
export interface TaskContext {
	task: TaskItem
	resolvedGraph: KnowledgeBaseItem[]
}
export interface TraversalFilter {
	edgeTypes?: GraphEdge["type"][]
	minWeight?: number
	direction?: "outbound" | "inbound" | "both"
}
export interface SubgraphResult {
	nodes: KnowledgeBaseItem[]
	edges: {
		sourceId: string
		targetId: string
		type: string
		weight?: number
	}[]
}
/**
 * AgentContext provides access to the user-specific subcollections:
 * - agents/{agentId}
 * - knowledge_bases/{kbId}
 * - tasks/{taskId}
 */
export declare class AgentContext {
	private db
	private embeddingService
	private kbCache
	private workspace
	readonly userId: string
	constructor(workspace: Workspace, embeddingService?: EmbeddingService)
	/** Base path for the user silo */
	get basePath(): string
	private get agentsCol()
	registerAgent(agentId: string, name: string, role: string, permissions?: string[]): Promise<void>
	getAgent(agentId: string): Promise<AgentProfile>
	appendMemoryLayer(agentId: string, memory: string): Promise<void>
	private get kbCol()
	addKnowledge(
		kbId: string,
		type: "fact" | "vector" | "rule",
		content: string,
		options?: {
			tags?: string[]
			edges?: GraphEdge[]
			embedding?: number[]
			confidence?: number
			expiresAt?: admin.firestore.Timestamp
			metadata?: Record<string, any>
		},
	): Promise<string>
	/**
	 * Partial update of a knowledge node. Reconciles bidirectional edge index.
	 */
	updateKnowledge(
		kbId: string,
		patch: {
			content?: string
			tags?: string[]
			edges?: GraphEdge[]
			embedding?: number[]
			confidence?: number
			metadata?: Record<string, any>
		},
	): Promise<void>
	/**
	 * Delete a knowledge node and clean up all bidirectional edge references.
	 */
	deleteKnowledge(kbId: string): Promise<void>
	/**
	 * Merge two knowledge nodes. Folds source into target:
	 * - Unions tags
	 * - Concatenates content with separator
	 * - Re-points all edges from source to target
	 * - Deletes source
	 */
	mergeKnowledge(sourceId: string, targetId: string): Promise<void>
	getKnowledge(kbId: string): Promise<KnowledgeBaseItem>
	getCacheStats(): {
		hits: number
		misses: number
		size: number
	}
	/**
	 * Write reverse index entries: for each outbound edge A→B, add an inboundEdge on B pointing back to A.
	 */
	private _syncOutboundEdges
	/**
	 * Remove reverse index entries when outbound edges are deleted or changed.
	 */
	private _removeOutboundEdges
	/**
	 * Deep multi-hop graph traversal with directional and filter support.
	 * Optimized with batched reads to minimize Firestore round-trips.
	 */
	traverseGraph(startId: string, maxDepth?: number, filter?: TraversalFilter): Promise<KnowledgeBaseItem[]>
	/**
	 * Degree centrality: count of inbound + outbound edges.
	 * Higher score = more connected "hub" node.
	 */
	getNodeCentrality(kbId: string): Promise<{
		kbId: string
		inbound: number
		outbound: number
		totalDegree: number
	}>
	/**
	 * Global hub detection: finds top N nodes with highest total degree across the graph.
	 * Optimized with pre-computed hubScore for O(1) query performance.
	 */
	getGlobalCentrality(limit?: number): Promise<
		{
			kbId: string
			score: number
		}[]
	>
	/**
	 * Extract a self-contained subgraph from a root node, suitable for serialization / LLM context injection.
	 */
	extractSubgraph(rootId: string, maxDepth?: number, filter?: TraversalFilter): Promise<SubgraphResult>
	/**
	 * Batch decay: multiply confidence by `factor` on all nodes older than `olderThan` date.
	 * E.g., decayConfidence(0.9, new Date('2024-01-01')) reduces confidence by 10% for old nodes.
	 */
	decayConfidence(
		factor: number,
		olderThan: Date,
	): Promise<{
		decayedCount: number
	}>
	/**
	 * Re-embed all knowledge nodes using the configured EmbeddingService.
	 * Useful for migration when upgrading embedding models.
	 */
	reembedAll(): Promise<{
		embeddedCount: number
		skippedCount: number
	}>
	/**
	 * Search knowledge graph nodes.
	 * Auto-embeds query if EmbeddingService is available and no queryEmbedding provided.
	 * When embeddings are present, ranks by cosine similarity. Otherwise falls back to substring matching.
	 * If augmentWithGraph is enabled, includes 1-hop neighbors of the top results.
	 */
	searchKnowledge(
		query: string,
		tags?: string[],
		limit?: number,
		queryEmbedding?: number[],
		options?: {
			augmentWithGraph?: boolean
		},
	): Promise<KnowledgeBaseItem[]>
	/**
	 * Fetches the "Shared Rulebook" for the swarm from the workspace.
	 */
	getWorkspaceSharedMemory(): Promise<string[]>
	/**
	 * Appends a global rule or guideline to the swarm-wide shared memory layer.
	 */
	appendSharedMemory(memory: string): Promise<void>
	/**
	 * Fetch holistic intelligence bundle allowing an agent an immediate,
	 * single-read capability to establish its cognitive state.
	 */
	getAgentBundle(agentId: string): Promise<AgentBundle>
	queryKnowledge(type: "fact" | "vector" | "rule", limit?: number): Promise<KnowledgeBaseItem[]>
	/**
	 * Pre-fetches a task and automatically traverses the knowledge graph
	 * starting from the task's explicitly linked knowledge requirements.
	 */
	getTaskContext(taskId: string): Promise<TaskContext>
	private get tasksCol()
	spawnTask(
		taskId: string,
		agentId: string,
		description: string,
		complexity?: number,
		linkedKnowledgeIds?: string[],
	): Promise<void>
	updateTaskStatus(taskId: string, status: "pending" | "active" | "completed" | "failed", result?: any): Promise<void>
	getTask(taskId: string): Promise<TaskItem>
}
//# sourceMappingURL=agent-context.d.ts.map
