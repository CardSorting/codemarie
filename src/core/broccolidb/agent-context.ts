import { BufferedDbPool, type WriteOp } from "../../infrastructure/db/BufferedDbPool.js"
import { SpiderViolation } from "../policy/SpiderEngine.js"
import { AuditService } from "./agent-context/AuditService.js"
import { GraphService } from "./agent-context/GraphService.js"
import { ReasoningService } from "./agent-context/ReasoningService.js"
import { SpiderService } from "./agent-context/SpiderService.js"
import { TaskService } from "./agent-context/TaskService.js"

export type {
	AgentBundle,
	AgentProfile,
	ImpactReport,
	KnowledgeBaseItem,
	ServiceContext,
	TraversalFilter,
} from "./agent-context/types.js"

import { BlastRadius } from "./agent-context/StructuralDiscoveryService.js"
import type {
	AgentBundle,
	AgentProfile,
	ImpactReport,
	KnowledgeBaseItem,
	ServiceContext,
	TraversalFilter,
} from "./agent-context/types.js"
import { LRUCache } from "./lru-cache.js"
import { Workspace } from "./workspace.js"

/**
 * AgentContext provides the high-level orchestration for BroccoliDB operations.
 * It coordinates database access, graph traversal, repository state, and reasoning.
 */
export class AgentContext {
	private db: BufferedDbPool
	private userId: string
	private agentProfile: AgentProfile
	private _serviceContext: ServiceContext
	private _graphService: GraphService
	private _reasoningService: ReasoningService
	private _auditService: AuditService
	private _spiderService: SpiderService | null = null
	private _taskService: TaskService

	private kbCache = new LRUCache<string, KnowledgeBaseItem>(2000)

	constructor(workspace: Workspace, db?: BufferedDbPool, userId?: string, agentProfile?: AgentProfile) {
		this.db = db || workspace.getDb()
		this.userId = (userId || workspace.userId).trim()
		this.agentProfile = agentProfile || {
			agentId: "system",
			name: "System Agent",
			role: "Orchestrator",
			permissions: ["*"],
			createdAt: Date.now(),
			lastActive: Date.now(),
		}

		this._serviceContext = {
			db: this.db,
			aiService: null,
			kbCache: this.kbCache,
			workspace,
			userId: this.userId,
			push: this._push.bind(this),
			searchKnowledge: this.searchKnowledge.bind(this),
		}

		this._graphService = new GraphService(this._serviceContext)
		this._taskService = new TaskService(this._serviceContext, this._graphService)
		this._reasoningService = new ReasoningService(this._serviceContext, this._graphService)
		this._auditService = new AuditService(this._serviceContext, this._graphService, this._reasoningService)
	}

	public async annotateKnowledge(targetId: string, agentId: string, annotation: string, metadata?: any): Promise<void> {
		const node = await this.getKnowledge(targetId)
		const edges = [...(node.edges || [])]
		const annotationId = await this.push(
			{
				type: "fact",
				content: annotation,
				tags: ["annotation"],
				metadata: { ...metadata, targetId, agentId },
			},
			agentId,
		)

		edges.push({ targetId: annotationId, type: "references" })
		await this._graphService.updateKnowledge(targetId, { edges })
	}

	// ─── GETTERS ───

	public get serviceContext(): ServiceContext {
		return this._serviceContext
	}

	public get graphService(): GraphService {
		return this._graphService
	}

	public get reasoningService(): ReasoningService {
		return this._reasoningService
	}

	public get auditService(): AuditService {
		return this._auditService
	}

	public get taskService(): TaskService {
		return this._taskService
	}

	public get spiderService(): SpiderService {
		if (!this._spiderService) this._spiderService = new SpiderService(this._serviceContext)
		return this._spiderService
	}

	public get structuralDiscoveryService() {
		return this.spiderService.getDiscovery()
	}

	public getStructuralImpact(filePath: string): { summary: string; blastRadius: BlastRadius } {
		const discovery = this.structuralDiscoveryService
		return {
			summary: discovery.getImportanceSummary(filePath),
			blastRadius: discovery.getBlastRadius(filePath),
		}
	}

	/**
	 * Natively verifies a set of knowledge IDs.
	 * Used for re-ranking search results by "Trust".
	 */
	public async verifyKnowledgeBatch(itemIds: string[]): Promise<Map<string, { isValid: boolean; confidence: number }>> {
		const results = new Map<string, { isValid: boolean; confidence: number }>()
		for (const id of itemIds) {
			const { isValid, metrics } = await this.reasoningService.verifySovereignty(id)
			results.set(id, { isValid, confidence: (metrics as { confidence: number })?.confidence ?? 0.5 })
		}
		return results
	}

	/**
	 * Fetches the most recent structural metadata from the repository nodes.
	 */
	public async getLatestStructuralMetadata(): Promise<{
		entropy: number
		violations: SpiderViolation[]
		mermaid?: string
	}> {
		return this.spiderService.auditStructure()
	}

	// ─── CORE ORCHESTRATION ───

	async checkpoint(): Promise<void> {
		await this.db.flush()
	}

	async flush(): Promise<void> {
		return this.checkpoint()
	}

	private async _push(op: WriteOp, agentId?: string) {
		await this.db.push(op, agentId || this.agentProfile.agentId)
	}

	/**
	 * High-level knowledge ingestion.
	 */
	async push(
		item: Partial<KnowledgeBaseItem> & { type: KnowledgeBaseItem["type"]; content: string },
		agentId?: string,
	): Promise<string> {
		const itemId = item.itemId || crypto.randomUUID()
		await this._push(
			{
				type: "insert",
				table: "knowledge",
				values: {
					id: itemId,
					userId: this.userId,
					type: item.type,
					content: item.content,
					tags: JSON.stringify(item.tags || []),
					confidence: item.confidence ?? 0.8,
					metadata: JSON.stringify(item.metadata || {}),
					createdAt: Date.now(),
				},
				layer: "domain",
			},
			agentId,
		)
		return itemId
	}

	async addKnowledge(
		kbId: string,
		type: KnowledgeBaseItem["type"],
		content: string,
		options: {
			tags?: string[]
			edges?: any[]
			embedding?: number[]
			confidence?: number
			expiresAt?: number
			metadata?: Record<string, unknown>
		} = {},
	): Promise<string> {
		return this._graphService.addKnowledge(kbId, type, content, options)
	}

	async updateKnowledge(kbId: string, updates: Partial<KnowledgeBaseItem>) {
		return this._graphService.updateKnowledge(kbId, updates)
	}

	async getKnowledge(kbId: string, _options?: any) {
		return this._graphService.getKnowledge(kbId)
	}

	async deleteKnowledge(kbId: string) {
		return this._graphService.deleteKnowledge(kbId)
	}

	async mergeKnowledge(sourceId: string, targetId: string) {
		return this._graphService.mergeKnowledge(sourceId, targetId)
	}

	async getKnowledgeBatch(ids: string[]) {
		return this._graphService.getKnowledgeBatch(ids)
	}

	async traverseGraph(startId: string, maxDepth = 2, filter?: TraversalFilter) {
		return this._graphService.traverseGraph(startId, maxDepth, filter)
	}

	public get graph(): GraphService {
		return this._graphService
	}

	async searchKnowledge(
		query: string,
		tags?: string[],
		limit = 10,
		_embedding?: number[],
		options: { augmentWithGraph?: boolean; skipVerification?: boolean } = {},
	): Promise<KnowledgeBaseItem[]> {
		const results = await this._graphService.traverseGraph("HEAD", limit, {
			direction: "both",
			minWeight: 0.1,
		})

		let filtered = results.filter((r) => (r.content || "").toLowerCase().includes(query.toLowerCase()))
		if (tags && tags.length > 0) {
			filtered = filtered.filter((r) => tags.every((t) => (r.tags || []).includes(t)))
		}

		if (!options.skipVerification) {
			const verification = await this.verifyKnowledgeBatch(filtered.map((f) => f.itemId))
			filtered = filtered.sort((a, b) => {
				const confA = verification.get(a.itemId)?.confidence ?? 0
				const confB = verification.get(b.itemId)?.confidence ?? 0
				return confB - confA
			})
		}

		return filtered.slice(0, limit)
	}

	// ─── REASONING (Delegated) ───

	async detectContradictions(startIds: string | string[], _depth?: number) {
		return this._reasoningService.detectContradictions(startIds, _depth)
	}

	async getReasoningPedigree(nodeId: string) {
		return this._reasoningService.getReasoningPedigree(nodeId)
	}

	async getNarrativePedigree(nodeId: string) {
		return this._reasoningService.getNarrativePedigree(nodeId)
	}

	async selfHealGraph() {
		return this._reasoningService.selfHealGraph(async () => {
			const rows = await this.db.selectWhere("knowledge", [{ column: "userId", value: this.userId }])
			return this._graphService.getKnowledgeBatch(rows.map((r: any) => r.id as string))
		})
	}

	async registerAgent(agentId: string, name: string, role: string, capabilities: string[] = []) {
		return this._taskService.registerAgent(agentId, name, role, capabilities)
	}

	async appendMemoryLayer(agentId: string, memory: string) {
		return this._taskService.appendMemoryLayer(agentId, memory)
	}

	async spawnTask(taskId: string, agentId: string, description: string, linkedKnowledgeIds?: string[]) {
		return this._taskService.spawnTask(taskId, agentId, description, linkedKnowledgeIds)
	}

	async updateTaskStatus(taskId: string, status: any, result?: any) {
		return this._taskService.updateTaskStatus(taskId, status, result)
	}

	async appendSharedMemory(memory: string) {
		return this.push({
			type: "rule",
			content: memory,
			tags: ["shared_memory"],
			metadata: { isSharedMemory: true },
		})
	}

	async getTaskContext(taskId: string) {
		return this._taskService.getTaskContext(taskId)
	}

	async getAgentBundle(agentId: string): Promise<AgentBundle> {
		const profile = await this._taskService.getAgent(agentId)
		const tasks = await this.db.selectWhere("tasks", [{ column: "agentId", value: agentId }])
		const recentKnowledge = await this.db.selectWhere("knowledge", [{ column: "userId", value: this.userId }], undefined, {
			limit: 20,
		})

		return {
			profile,
			activeTasks: tasks.map((t: any) => ({ ...t, taskId: t.id })) as any,
			recentKnowledge: recentKnowledge.map((k: any) => ({ ...k, itemId: k.id })) as any,
		}
	}

	/**
	 * Automatically discovers and adds relationships for a node based on semantic similarity.
	 */
	async autoDiscoverRelationships(nodeId: string, _depth?: number): Promise<{ discovered: number; suggestions: string[] }> {
		return this._reasoningService.autoDiscoverRelationships(nodeId)
	}

	/**
	 * Calculates a heuristic 'Soundness Score' for a set of nodes.
	 */
	async getLogicalSoundness(nodeIds: string[]): Promise<number> {
		return this._reasoningService.getLogicalSoundness(nodeIds)
	}

	async decayConfidence(factor: number, olderThan: number | Date) {
		const timestamp = olderThan instanceof Date ? olderThan.getTime() : olderThan
		const rows = await this.db.selectWhere("knowledge", [
			{ column: "userId", value: this.userId },
			{ column: "createdAt", value: timestamp, operator: "<" },
		])
		for (const row of rows) {
			const node = await this.getKnowledge(row.id as string)
			const newConfidence = (node.confidence ?? 0.8) * factor
			await this.updateKnowledge(node.itemId, { confidence: newConfidence })
		}
		return { decayedCount: rows.length }
	}

	async reembedAll() {
		return { embeddedCount: 0, skippedCount: 0 }
	}

	async speculateImpact(content: string, _startId?: string): Promise<ImpactReport> {
		const id = `speculate-${crypto.randomUUID()}`
		await this.push({
			type: "hypothesis",
			content,
			tags: ["speculative"],
			metadata: { isSpeculative: true },
		})
		const report = await this._auditService.predictEffect(id)
		await this._graphService.deleteKnowledge(id)
		return report
	}

	// ─── AUDIT (Delegated) ───
	async checkConstitutionalViolation(path: string, code: string, ruleContent: string) {
		return this._auditService.checkConstitutionalViolation(path, code, ruleContent)
	}
	async addLogicalConstraint(
		pathPattern: string,
		knowledgeId: string,
		severity: "blocking" | "warning" = "blocking",
	): Promise<void> {
		return this._auditService.addLogicalConstraint(pathPattern, knowledgeId, severity)
	}
	async getLogicalConstraints() {
		return this._auditService.getLogicalConstraints()
	}

	async getNodeCentrality(kbId: string) {
		return this._graphService.getNodeCentrality(kbId)
	}

	async getGlobalCentrality(limit = 10) {
		return this._graphService.getGlobalCentrality(limit)
	}

	async extractSubgraph(rootId: string, maxDepth = 2, filter?: TraversalFilter) {
		return this._graphService.extractSubgraph(rootId, maxDepth, filter)
	}

	getCacheStats() {
		return {
			hits: this.kbCache.hits,
			misses: this.kbCache.misses,
			size: this.kbCache.size,
		}
	}
}
