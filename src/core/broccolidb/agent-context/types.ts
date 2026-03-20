import { BufferedDbPool } from "@/infrastructure/db/BufferedDbPool"
import { AiService } from "../embedding"
import { LRUCache } from "../lru-cache"
import { Workspace } from "../workspace"

export interface AgentProfile {
	agentId: string
	name: string
	role: string
	permissions: string[]
	memoryLayer?: string[]
	createdAt: number
	lastActive: number
}

export interface GraphEdge {
	targetId: string
	type: "supports" | "contradicts" | "blocks" | "depends_on" | "references"
	weight?: number // 0.0 to 1.0 relevance scalar
}

export interface KnowledgeBaseItem {
	itemId: string
	type: "fact" | "vector" | "rule" | "hypothesis" | "conclusion"
	content: string
	tags: string[]
	edges: GraphEdge[] // Outbound edges
	inboundEdges: GraphEdge[] // Reverse index: edges pointing AT this node
	embedding?: number[] // Vector embeddings
	confidence: number // 0.0–1.0 confidence score
	hubScore: number // Pre-calculated centrality
	expiresAt?: number | null
	metadata?: Record<string, any> | null
	createdAt: number
}

export interface TaskItem {
	taskId: string
	agentId: string
	status: "pending" | "active" | "completed" | "failed"
	description: string
	linkedKnowledgeIds?: string[]
	result?: any
	createdAt: number
	updatedAt: number
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
	edges: { sourceId: string; targetId: string; type: string; weight?: number }[]
}

export interface ContradictionReport {
	nodeId: string
	conflictingNodeId: string
	confidence: number
	evidencePath: string[]
}

export interface Pedigree {
	nodeId: string
	effectiveConfidence: number
	lineage: {
		nodeId: string
		type: string
		content: string
		timestamp: number
		confidence: number
	}[]
	supportingEvidenceIds: string[]
}

export interface ImpactReport {
	isValid: boolean
	contradictions: ContradictionReport[]
	suggestions: string[]
	soundnessDelta: number
}

export interface ServiceContext {
	db: BufferedDbPool
	aiService: AiService | null
	kbCache: LRUCache<string, KnowledgeBaseItem>
	workspace: Workspace
	userId: string
	push: (op: any, agentId?: string) => Promise<void>
	searchKnowledge: (query: string, limit?: number) => Promise<KnowledgeBaseItem[]>
}
export interface AgentBundle {
	profile: AgentProfile
	activeTasks: TaskItem[]
	recentKnowledge: KnowledgeBaseItem[]
}
