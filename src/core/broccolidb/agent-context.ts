import * as crypto from "node:crypto"
import { BufferedDbPool, type WriteOp } from "@/infrastructure/db/BufferedDbPool.js"
import { Logger } from "../../shared/services/Logger.js"
import { SpiderViolation } from "../policy/SpiderEngine.js"
import { AuditService } from "./agent-context/AuditService.js"
import { GraphService } from "./agent-context/GraphService.js"
import { ReasoningService } from "./agent-context/ReasoningService.js"
import { SpiderService } from "./agent-context/SpiderService.js"
import { BlastRadius } from "./agent-context/StructuralDiscoveryService.js"
import { TaskService } from "./agent-context/TaskService.js"

import type {
	AgentBundle,
	AgentProfile,
	ContradictionReport,
	GraphEdge,
	ImpactReport,
	KnowledgeBaseItem,
	Pedigree,
	ServiceContext,
	SubgraphResult,
	TaskContext,
	TaskItem,
	TraversalFilter,
} from "./agent-context/types.js"
import { AiService } from "./embedding.js"
import { AgentGitError } from "./errors.js"
import { LRUCache } from "./lru-cache.js"
import { cosineSimilarity } from "./math-utils.js"
import { Workspace } from "./workspace.js"

export type {
	AgentProfile,
	KnowledgeBaseItem,
	GraphEdge,
	TaskItem,
	TaskContext,
	TraversalFilter,
	ContradictionReport,
	Pedigree,
	ImpactReport,
	AgentBundle,
	SubgraphResult,
}

// Math utilities moved to math-utils.ts
// cosineSimilarity function is now imported from math-utils.ts

/**
 * AgentContext provides a unified entry point for agent-related operations.
 * It coordinates specialized services: Graph, Reasoning, Tasks, and Auditing.
 */
export class AgentContext {
	private db: BufferedDbPool
	private aiService: AiService | null
	private kbCache: LRUCache<string, KnowledgeBaseItem>
	private workspace: Workspace
	private localBuffer: WriteOp[] = []
	private ephemeralState = new Map<string, unknown>()
	private autoFlushLimit = 25
	readonly userId: string
	private _graphService?: GraphService
	private _reasoningService?: ReasoningService
	private _taskService?: TaskService
	private _auditService?: AuditService
	private _spiderService?: SpiderService
	private _serviceContext: ServiceContext

	// [Pass 6] Epistemic Coefficients
	private readonly epistemicConfig = {
		truthBoost: 500.0,
		contradictionPenalty: 1000.0,
		semanticCollisionPenalty: 800.0,
		collisionThreshold: 0.45, // Slightly higher to reduce false positives
		uncertaintyThreshold: 0.05, // 5% delta for abstention
		evidenceBonus: 100.0, // Bonus for having at least one valid support edge
	}

	constructor(workspace: Workspace, _depthLimit = 0, aiService?: AiService) {
		this.workspace = workspace
		this.db = workspace.getDb()
		this.userId = workspace.userId
		this.aiService = aiService || null
		this.kbCache = new LRUCache<string, KnowledgeBaseItem>(1000)

		this._serviceContext = {
			db: this.db,
			aiService: this.aiService,
			kbCache: this.kbCache,
			workspace: this.workspace,
			userId: this.userId,
			push: this._push.bind(this),
			searchKnowledge: (query: string, limit?: number) => this.searchKnowledge(query, undefined, limit),
		}
	}

	private get graphService(): GraphService {
		if (!this._graphService) this._graphService = new GraphService(this._serviceContext)
		return this._graphService
	}

	private get reasoningService(): ReasoningService {
		if (!this._reasoningService) this._reasoningService = new ReasoningService(this._serviceContext, this.graphService)
		return this._reasoningService
	}

	private get taskService(): TaskService {
		if (!this._taskService) this._taskService = new TaskService(this._serviceContext, this.graphService)
		return this._taskService
	}

	private get auditService(): AuditService {
		if (!this._auditService)
			this._auditService = new AuditService(this._serviceContext, this.graphService, this.reasoningService)
		return this._auditService
	}

	public get spiderService(): SpiderService {
		if (!this._spiderService) this._spiderService = new SpiderService(this._serviceContext)
		return this._spiderService
	}

	public get structuralDiscoveryService() {
		return this.spiderService.getDiscovery()
	}

	/**
	 * Natively verifies a set of knowledge IDs.
	 * Used for re-ranking search results by "Trust".
	 */
	public async verifyKnowledgeBatch(
		itemIds: string[],
	): Promise<Map<string, { isValid: boolean; recursiveConfidence: number; peakConfidence: number }>> {
		const results = new Map<string, { isValid: boolean; recursiveConfidence: number; peakConfidence: number }>()
		for (const id of itemIds) {
			const { isValid, recursiveConfidence, peakConfidence } = await this.reasoningService.verifySovereignty(id)
			results.set(id, { isValid, recursiveConfidence, peakConfidence })
		}
		return results
	}

	/**
	 * Fetches the most recent structural metadata from the repository nodes.
	 */
	public async getLatestStructuralMetadata(): Promise<{
		entropy: number
		violations: SpiderViolation[]
		graphKb?: string
	} | null> {
		const results = await this.workspace
			.getDb()
			.selectWhere("nodes", [{ column: "repoPath", value: this.workspace.workspacePath }], undefined, {
				orderBy: { column: "timestamp", direction: "desc" },
				limit: 1,
			})

		if (results.length === 0 || !results[0].metadata) return null
		const meta = JSON.parse(results[0].metadata) as {
			spider_entropy?: number
			spider_violations?: SpiderViolation[]
			spider_graph_kb?: string
		}
		return {
			entropy: meta.spider_entropy || 0,
			violations: meta.spider_violations || [],
			graphKb: meta.spider_graph_kb,
		}
	}

	/**
	 * Returns the architectural blast radius and importance summary for a file.
	 */
	public getStructuralImpact(filePath: string): { summary: string; blastRadius: BlastRadius } {
		const discovery = this.structuralDiscoveryService
		return {
			summary: discovery.getImportanceSummary(filePath),
			blastRadius: discovery.getBlastRadius(filePath),
		}
	}

	// ─── OPTIMIZATION WRAPPERS ───

	/**
	 * Batches operations locally before flushing to the database pool.
	 * "Typical Fix 1: Memory batching"
	 */
	private async _push(op: WriteOp, agentId?: string) {
		const where = op.where
		const firstWhereVal = Array.isArray(where) ? where[0]?.value : where?.value
		this.localBuffer.push({
			...op,
			agentId: agentId || op.values?.agentId || (typeof firstWhereVal === "string" ? firstWhereVal : undefined),
		})
		if (this.localBuffer.length >= this.autoFlushLimit) {
			await this.flush()
		}
	}

	/**
	 * Forces a write of all buffered operations to the DB.
	 * "Typical Fix 4: Snapshotting (local -> DB)"
	 */
	async flush(): Promise<void> {
		if (this.localBuffer.length === 0) return
		const ops = [...this.localBuffer]
		this.localBuffer = []

		// Efficiency: Use pushBatch to reduce lock acquisition overhead in BufferedDbPool
		await this.db.pushBatch(ops)
	}

	/**
	 * Stores temporary session state that never touches the DB.
	 * "Typical Fix 2: Ephemeral state"
	 */
	setEphemeral(key: string, value: unknown) {
		this.ephemeralState.set(key, value)
	}
	getEphemeral(key: string): unknown {
		return this.ephemeralState.get(key)
	}

	/**
	 * Typical Fix 3: Event logs instead of mutations.
	 * "Append events instead of rewriting records."
	 */
	async logEvent(type: string, data: unknown, agentId?: string): Promise<void> {
		await this._push(
			{
				type: "insert",
				table: "audit_events",
				values: {
					id: crypto.randomUUID(),
					userId: this.userId,
					agentId: agentId || null,
					type,
					data: JSON.stringify(data),
					createdAt: Date.now(),
				},
				layer: "infrastructure",
			},
			agentId,
		)
	}

	// ─── AGENTS (Delegated) ───
	async registerAgent(agentId: string, name: string, role: string, permissions: string[] = []) {
		return this.taskService.registerAgent(agentId, name, role, permissions)
	}
	async getAgent(agentId: string) {
		return this.taskService.getAgent(agentId)
	}
	async appendMemoryLayer(agentId: string, memory: string) {
		return this.taskService.appendMemoryLayer(agentId, memory)
	}

	async spawnTask(taskId: string, agentId: string, description: string, linkedKnowledgeIds?: string[]) {
		return this.taskService.spawnTask(taskId, agentId, description, linkedKnowledgeIds)
	}

	async updateTaskStatus(taskId: string, status: TaskItem["status"], result?: unknown) {
		return this.taskService.updateTaskStatus(taskId, status, result)
	}

	async getTask(taskId: string) {
		return this.taskService.getTask(taskId)
	}

	async getTaskContext(taskId: string) {
		return this.taskService.getTaskContext(taskId)
	}

	async listAgents(limit = 20): Promise<AgentProfile[]> {
		const rows = await this.db.selectWhere("agents", [{ column: "userId", value: this.userId }], undefined, {
			orderBy: { column: "lastActive", direction: "desc" },
			limit,
		})
		return rows.map(
			(r) =>
				({
					...r,
					agentId: r.id,
					permissions: JSON.parse(r.permissions || "[]"),
					memoryLayer: JSON.parse(r.memoryLayer || "[]"),
				}) as AgentProfile,
		)
	}

	// ─── KNOWLEDGE BASES (Delegated) ───
	async addKnowledge(kbId: string, type: KnowledgeBaseItem["type"], content: string, options?: Record<string, unknown>) {
		return this.graphService.addKnowledge(kbId, type, content, options)
	}
	async annotateKnowledge(targetId: string, agentId: string, annotation: string, metadata?: Record<string, unknown>) {
		return this.graphService.annotateKnowledge(targetId, agentId, annotation, metadata)
	}
	async updateKnowledge(kbId: string, patch: Partial<KnowledgeBaseItem>) {
		return this.graphService.updateKnowledge(kbId, patch)
	}
	async deleteKnowledge(kbId: string) {
		return this.graphService.deleteKnowledge(kbId)
	}
	async mergeKnowledge(sourceId: string, targetId: string) {
		return this.graphService.mergeKnowledge(sourceId, targetId)
	}
	async getKnowledge(itemId: string) {
		return this.graphService.getKnowledge(itemId)
	}

	async traverseGraph(startId: string, maxDepth = 2, filter?: TraversalFilter) {
		return this.graphService.traverseGraph(startId, maxDepth, filter)
	}

	// ─── REASONING & INTEL (Delegated) ───
	async detectContradictions(startIds: string | string[], depth?: number) {
		return this.reasoningService.detectContradictions(startIds, depth)
	}
	async getReasoningPedigree(nodeId: string, maxDepth?: number) {
		return this.reasoningService.getReasoningPedigree(nodeId, maxDepth)
	}
	async getNarrativePedigree(nodeId: string) {
		return this.reasoningService.getNarrativePedigree(nodeId)
	}
	async verifySovereignty(nodeId: string) {
		return this.reasoningService.verifySovereignty(nodeId)
	}
	async selfHealGraph() {
		return this.reasoningService.selfHealGraph(() => this.listAllKnowledge(1000))
	}

	/**
	 * Automatically discovers and adds relationships for a node based on semantic similarity.
	 * Uses Gemini to evaluate the specific logical link.
	 */
	async autoDiscoverRelationships(nodeId: string, limit = 5): Promise<{ discovered: number; suggestions: string[] }> {
		return this.reasoningService.autoDiscoverRelationships(nodeId, limit)
	}

	/**
	 * Calculates a heuristic 'Soundness Score' for a set of nodes.
	 * Based on confidence, contradiction density, and support strength.
	 */
	async getLogicalSoundness(nodeIds: string[]): Promise<number> {
		return this.reasoningService.getLogicalSoundness(nodeIds)
	}

	// ─── AUDIT (Delegated) ───
	async checkConstitutionalViolation(path: string, code: string, ruleContent: string) {
		return this.auditService.checkConstitutionalViolation(path, code, ruleContent)
	}
	async speculateImpact(content: string, _startId?: string): Promise<ImpactReport> {
		// The original speculateImpact had more logic, but the instruction implies delegating to a simpler predictEffect
		// If the original logic is needed, it should be moved into AuditService.predictEffect
		return this.auditService.predictEffect(content)
	}
	async addLogicalConstraint(
		pathPattern: string,
		knowledgeId: string,
		severity: "blocking" | "warning" = "blocking",
	): Promise<void> {
		return this.auditService.addLogicalConstraint(pathPattern, knowledgeId, severity)
	}
	async getLogicalConstraints() {
		return this.auditService.getLogicalConstraints()
	}

	/**
	 * Degree centrality: count of inbound + outbound edges.
	 * Higher score = more connected "hub" node.
	 */
	async getNodeCentrality(kbId: string): Promise<{ kbId: string; inbound: number; outbound: number; totalDegree: number }> {
		return this.graphService.getNodeCentrality(kbId)
	}

	/**
	 * Global hub detection: finds top N nodes with highest total degree across the graph.
	 * Optimized with pre-computed hubScore for O(1) query performance.
	 */
	async getGlobalCentrality(limit = 10): Promise<{ kbId: string; score: number }[]> {
		return this.graphService.getGlobalCentrality(limit)
	}

	/**
	 * Extract a self-contained subgraph from a root node, suitable for serialization / LLM context injection.
	 */
	async extractSubgraph(rootId: string, maxDepth = 2, filter?: TraversalFilter): Promise<SubgraphResult> {
		return this.graphService.extractSubgraph(rootId, maxDepth, filter)
	}

	getCacheStats() {
		return {
			hits: this.kbCache.hits,
			misses: this.kbCache.misses,
			size: this.kbCache.size,
		}
	}

	// ─── CONFIDENCE DECAY ───

	/**
	 * Batch decay: multiply confidence by `factor` on all nodes older than `olderThan` date.
	 * E.g., decayConfidence(0.9, new Date('2024-01-01')) reduces confidence by 10% for old nodes.
	 */
	async decayConfidence(factor: number, olderThan: Date): Promise<{ decayedCount: number }> {
		if (factor < 0 || factor > 1) throw new AgentGitError("Decay factor must be between 0.0 and 1.0", "INVALID_ARGUMENT")

		const threshold = olderThan.getTime()
		const rows = await this.db.selectWhere("knowledge", [
			{ column: "userId", value: this.userId },
			{ column: "createdAt", value: threshold, operator: "<" },
		])

		let decayedCount = 0
		for (const row of rows) {
			const currentConfidence = row.confidence ?? 1.0
			const newConfidence = Math.max(0, currentConfidence * factor)

			await this._push({
				type: "update",
				table: "knowledge",
				where: [{ column: "id", value: row.id }],
				values: { confidence: newConfidence },
				layer: "infrastructure",
			})
			decayedCount++
		}

		return { decayedCount }
	}

	// ─── BATCH RE-EMBEDDING ───

	/**
	 * Re-embed all knowledge nodes using the configured AiService.
	 * Useful for migration when upgrading embedding models.
	 */
	async reembedAll(): Promise<{ embeddedCount: number; skippedCount: number }> {
		if (!this.aiService?.isAvailable()) {
			throw new AgentGitError("AiService is not available (no API key configured)", "INVALID_ARGUMENT")
		}

		const rows = await this.db.selectWhere("knowledge", [{ column: "userId", value: this.userId }])
		let embeddedCount = 0
		let skippedCount = 0

		// Process in chunks to avoid overwhelming the API
		const BATCH_SIZE = 10

		for (let i = 0; i < rows.length; i += BATCH_SIZE) {
			const chunk = rows.slice(i, i + BATCH_SIZE)
			const texts = chunk.map((r) => r.content)
			const embeddings = await this.aiService.embedBatch(texts, "RETRIEVAL_DOCUMENT")

			for (let j = 0; j < chunk.length; j++) {
				const embedding = embeddings[j]
				if (embedding) {
					await this._push({
						type: "update",
						table: "knowledge",
						where: [{ column: "id", value: chunk[j]?.id ?? "" }],
						values: { embedding: JSON.stringify(embedding) },
						layer: "infrastructure",
					})
					embeddedCount++
				} else {
					skippedCount++
				}
			}
		}

		return { embeddedCount, skippedCount }
	}

	// ─── SEARCH (Enhanced with Cosine Similarity) ───

	/**
	 * Search knowledge graph nodes.
	 * Auto-embeds query if AiService is available and no queryEmbedding provided.
	 * When embeddings are present, ranks by cosine similarity. Otherwise falls back to substring matching.
	 * If augmentWithGraph is enabled, includes 1-hop neighbors of the top results.
	 */
	async searchKnowledge(
		query: string,
		tags?: string[],
		limit = 20,
		queryEmbedding?: number[],
		options: { augmentWithGraph?: boolean; skipVerification?: boolean } = {},
	): Promise<KnowledgeBaseItem[]> {
		// Search is complex and could live in GraphService or a specialized SearchService
		// For now, I'll keep it here as it touches multiple concerns (graph, embeddings, etc.)
		// but ultimately it should be modular too.
		return this._searchKnowledge(query, tags, limit, queryEmbedding, options)
	}

	private async _searchKnowledge(
		query: string,
		tags?: string[],
		limit = 20,
		queryEmbedding?: number[],
		options: { augmentWithGraph?: boolean; skipVerification?: boolean } = {},
	): Promise<KnowledgeBaseItem[]> {
		const conditions: any[] = [
			{ column: "userId", value: this.userId },
			{ column: "expiresAt", value: null },
		]

		if (tags && tags.length > 0) {
			for (const tag of tags) {
				conditions.push({ column: "tags", value: tag, operator: "JSON_CONTAINS" })
			}
		}

		// Only use SQL-level LIKE filter if we don't have embeddings for vector search,
		// otherwise we might filter out semantically relevant but keyword-dissimilar results.
		if (!queryEmbedding && !this.aiService?.isAvailable() && query?.trim()) {
			conditions.push({ column: "content", value: `%${query}%`, operator: "LIKE" })
		}

		const rows = await this.db.selectWhere("knowledge", conditions, undefined, {
			orderBy: { column: "confidence", direction: "desc" },
			limit: queryEmbedding ? 500 : 200, // Larger candidate pool for vector search
		})

		const candidates = rows.map(
			(r) =>
				({
					...r,
					itemId: r.id as string,
					tags: JSON.parse((r.tags as string) || "[]"),
					edges: JSON.parse((r.edges as string) || "[]"),
					inboundEdges: JSON.parse((r.inboundEdges as string) || "[]"),
					embedding: r.embedding ? JSON.parse(r.embedding as string) : undefined,
					metadata: JSON.parse((r.metadata as string) || "{}"),
				}) as KnowledgeBaseItem,
		)

		// Auto-embed query if service available and no explicit embedding provided
		if (!queryEmbedding && query.trim() && this.aiService?.isAvailable()) {
			queryEmbedding = (await this.aiService.embedText(query, "RETRIEVAL_QUERY")) || undefined
		}

		let results: KnowledgeBaseItem[] = []

		// If vector search is available, rank by cosine similarity
		if (queryEmbedding && queryEmbedding.length > 0) {
			const qEmb = queryEmbedding
			const scoredCandidates = candidates
				.filter((c) => !!c.embedding && c.embedding.length > 0)
				.map((c) => ({
					item: c,
					similarity: this.calculateSimilarity(qEmb, c.embedding as number[]),
				}))
				.sort((a, b) => b.similarity - a.similarity)

			// Include items without embeddings at the end (substring fallback)
			const withoutEmbeddings = candidates.filter((c) => !c.embedding || c.embedding.length === 0)

			// [Pass 4 Hardening] Verification-Aware Ranking (Vector Path)
			const candidateIds = scoredCandidates.map((s) => s.item.itemId).slice(0, 50)
			const verificationMap = options.skipVerification ? new Map() : await this.verifyKnowledgeBatch(candidateIds)

			const vectorResults = scoredCandidates
				.map((s) => {
					let score = s.similarity * 10.0 // Normalize vector similarity
					const verification = verificationMap.get(s.item.itemId)
					const isVerifiableType = s.item.type === "conclusion" || s.item.type === "hypothesis"

					if (!options.skipVerification && isVerifiableType && verification) {
						if (verification.isValid === true) {
							score += this.epistemicConfig.truthBoost * verification.recursiveConfidence

							// [Pass 6] Evidence Bonus: Favor supported nodes over assertions
							const supports = [...(s.item.edges || []), ...(s.item.inboundEdges || [])].some(
								(e) => e.type === "supports",
							)
							if (supports) {
								score += this.epistemicConfig.evidenceBonus
							}
						} else if (verification.isValid === false) {
							score -= this.epistemicConfig.contradictionPenalty
						}
					}

					// Symmetric Conflict Adjudication (Vector Path)
					const contradictions = [...(s.item.edges || []), ...(s.item.inboundEdges || [])].filter(
						(e) => e.type === "contradicts",
					)

					for (const edge of contradictions) {
						const otherId = edge.targetId === s.item.itemId ? (edge as any).sourceId : edge.targetId
						const other = verificationMap.get(otherId)
						if (other && other.isValid && other.recursiveConfidence >= (verification?.recursiveConfidence || 0)) {
							score -= this.epistemicConfig.contradictionPenalty
						}
					}

					return { item: s.item, searchScore: score }
				})
				.sort((a, b) => (b.searchScore ?? 0) - (a.searchScore ?? 0))

			// [Pass 5] Implicit Conflict Detection (Vector Path)
			const vCollisionCandidates = vectorResults.slice(0, 10)
			for (let i = 0; i < vCollisionCandidates.length; i++) {
				const a = vCollisionCandidates[i]
				if (a.item.type !== "conclusion" && a.item.type !== "hypothesis") continue
				const aKeywords = new Set(
					a.item.content
						.toLowerCase()
						.split(/\s+/)
						.filter((k: string) => k.length > 4),
				)
				if (aKeywords.size < 2) continue

				for (let j = 0; j < vCollisionCandidates.length; j++) {
					if (i === j) continue
					const b = vCollisionCandidates[j]
					const bWords = b.item.content
						.toLowerCase()
						.split(/\s+/)
						.filter((k: string) => k.length > 4)
					let overlap = 0
					for (const k of bWords) {
						if (aKeywords.has(k)) overlap++
					}
					if (
						overlap / Math.max(aKeywords.size, bWords.length) > this.epistemicConfig.collisionThreshold &&
						a.item.content !== b.item.content
					) {
						const vA = verificationMap.get(a.item.itemId)
						const vB = verificationMap.get(b.item.itemId)

						const hasSuppA = [...(a.item.edges || []), ...(a.item.inboundEdges || [])].some(
							(e) => e.type === "supports",
						)
						const hasSuppB = [...(b.item.edges || []), ...(b.item.inboundEdges || [])].some(
							(e) => e.type === "supports",
						)

						// Evidence-weighted confidence: rooted truth resists assertions
						const confA = (vA?.recursiveConfidence || a.item.confidence || 0) * (hasSuppA ? 1.5 : 1.0)
						const confB = (vB?.recursiveConfidence || b.item.confidence || 0) * (hasSuppB ? 1.5 : 1.0)

						if (confB > confA) a.searchScore -= this.epistemicConfig.semanticCollisionPenalty
					}
				}
			}

			const finalVectorResults = vectorResults
				.sort((a, b) => b.searchScore - a.searchScore)
				.map((v) => ({ ...v.item, searchScore: v.searchScore }))

			// [Pass 6] Abstention Logic (Vector Path)
			if (finalVectorResults.length >= 2) {
				const s1 = (finalVectorResults[0] as any).searchScore || 0
				const s2 = (finalVectorResults[1] as any).searchScore || 0
				const delta = Math.abs(s1 - s2)
				const range = Math.max(1, Math.abs(s1))
				if (delta / range < this.epistemicConfig.uncertaintyThreshold) {
					Logger.info(`[Adjudication] Result stability low (delta=${delta.toFixed(2)}). Marking as UNCERTAIN.`)
					finalVectorResults.forEach((r) => (r.metadata = { ...r.metadata, epistemicStatus: "uncertain" }))
				}
			}

			if (query?.trim()) {
				const qLower = query.toLowerCase()
				const filtered = withoutEmbeddings
					.filter((c) => c.content.toLowerCase().includes(qLower))
					.map((c) => ({ ...c, searchScore: 5.0 }))
				results = [...finalVectorResults, ...filtered]
			} else {
				results = [...finalVectorResults, ...withoutEmbeddings]
			}
		} else {
			// Fallback: keyword-based relevance ranking (BM25-lite)
			if (query?.trim()) {
				const qLower = query.toLowerCase()
				const keywords = qLower.split(/\s+/).filter((k) => k.length > 2)

				// [Pass 3 Hardening] Search Scalability: SQLite FTS5 integration
				// This replaces O(N) memory filtering with O(log N) native FTS search.
				const ftsResults = await this.db.executeQuery(
					`SELECT id FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT ?`,
					[keywords.join(" OR "), limit * 4],
				)

				const ftsIds = ftsResults.map((r: any) => r.id as string)
				Logger.info(`DEBUG [Search] keywords=[${keywords.join(",")}] ftsIdsCount=${ftsIds.length}`)

				const ftsRows = await this.db.selectWhere("knowledge", [{ column: "id", value: ftsIds }])
				Logger.info(`DEBUG [Search] ftsRowsCount=${ftsRows.length}`)

				const ftsCandidates = ftsRows.map((row: any) => ({
					itemId: row.id as string,
					content: row.content as string,
					type: row.type as any,
					tags: JSON.parse((row.tags as string) || "[]"),
					metadata: JSON.parse((row.metadata as string) || "{}"),
					confidence: (row.confidence as number) || 1.0,
					hubScore: (row.hubScore as number) || 0,
					edges: JSON.parse((row.edges as string) || "[]"),
					inboundEdges: JSON.parse((row.inboundEdges as string) || "[]"),
				}))

				// [Pass 4 Hardening] Verification-Aware Ranking
				// Top candidates undergo sovereignty verification to derive a "Trust Boost"
				const searchCandidates = ftsCandidates.slice(0, 50)
				const verificationMap = options.skipVerification
					? new Map()
					: await this.verifyKnowledgeBatch(searchCandidates.map((c) => c.itemId))

				// Merged BM25-lite + Trust logic for final ranking
				const k1 = 1.2
				const b = 0.75
				const avgdl =
					ftsCandidates.reduce((sum: number, c: any) => sum + c.content.length, 0) / (ftsCandidates.length || 1)

				const scored = ftsCandidates.map((c: any) => {
					const contentLower = c.content.toLowerCase()
					let score = 0
					if (contentLower.includes(qLower)) score += 5.0
					keywords.forEach((kw: string) => {
						const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
						const matches = contentLower.match(regex)
						const tf = matches ? matches.length : 0
						if (tf > 0) {
							const idf = Math.log((ftsCandidates.length - 0.5) / 0.5)
							const tfScore = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * c.content.length) / avgdl))
							score += idf * tfScore
						}
					})
					score += (c.hubScore || 0) * 0.1

					// Apply the "Intelligence Delta": Proof Verification Boost
					const verification = verificationMap.get(c.itemId)
					const isVerifiableType = c.type === "conclusion" || c.type === "hypothesis"

					if (!options.skipVerification && isVerifiableType && verification) {
						if (verification.isValid === true) {
							score += this.epistemicConfig.truthBoost * verification.recursiveConfidence

							const supports = [...(c.edges || []), ...(c.inboundEdges || [])].some(
								(e: any) => e.type === "supports",
							)
							if (supports) {
								score += this.epistemicConfig.evidenceBonus
							}
						} else if (verification.isValid === false) {
							score -= this.epistemicConfig.contradictionPenalty
						}
					}

					// Symmetric Conflict Adjudication (Keyword Path)
					const contradictions = [...(c.edges || []), ...(c.inboundEdges || [])].filter(
						(e: any) => e.type === "contradicts",
					)

					for (const edge of contradictions) {
						const otherId = edge.targetId === c.itemId ? (edge as any).sourceId : edge.targetId
						const other = verificationMap.get(otherId)
						if (other && other.isValid && other.recursiveConfidence >= (verification?.recursiveConfidence || 0)) {
							score -= this.epistemicConfig.contradictionPenalty
						}
					}

					return { item: c, searchScore: score }
				})
				const scoredResults = scored
					.filter((s: any) => s.searchScore > -50.0)
					.sort((a: any, b: any) => b.searchScore - a.searchScore)

				// Implicit Conflict Detection (Semantic Collision)
				const collisionCandidates = scoredResults.slice(0, 10)
				for (let i = 0; i < collisionCandidates.length; i++) {
					const a = collisionCandidates[i]
					if (a.item.type !== "conclusion" && a.item.type !== "hypothesis") continue

					const aWords = a.item.content
						.toLowerCase()
						.split(/\s+/)
						.filter((k: string) => k.length > 4)
					const aKeywords = new Set(aWords)
					if (aKeywords.size < 2) continue

					for (let j = 0; j < collisionCandidates.length; j++) {
						if (i === j) continue
						const b = collisionCandidates[j]
						const bWords = b.item.content
							.toLowerCase()
							.split(/\s+/)
							.filter((k: string) => k.length > 4)

						// Check overlap
						let overlap = 0
						for (const k of bWords) {
							if (aKeywords.has(k)) overlap++
						}

						const overlapRatio = overlap / Math.max(aKeywords.size, bWords.length)
						if (overlapRatio > this.epistemicConfig.collisionThreshold && a.item.content !== b.item.content) {
							// Semantic Collision!
							const vA = verificationMap.get(a.item.itemId)
							const vB = verificationMap.get(b.item.itemId)

							const hasSuppA = [...(a.item.edges || []), ...(a.item.inboundEdges || [])].some(
								(e: any) => e.type === "supports",
							)
							const hasSuppB = [...(b.item.edges || []), ...(b.item.inboundEdges || [])].some(
								(e: any) => e.type === "supports",
							)

							// Evidence-weighted confidence
							const confA = (vA?.recursiveConfidence || a.item.confidence || 0) * (hasSuppA ? 1.5 : 1.0)
							const confB = (vB?.recursiveConfidence || b.item.confidence || 0) * (hasSuppB ? 1.5 : 1.0)

							if (confB > confA) {
								a.searchScore -= this.epistemicConfig.semanticCollisionPenalty
							}
						}
					}
				}

				results = scoredResults
					.sort((a: any, b: any) => b.searchScore - a.searchScore)
					.map((s: any) => ({ ...s.item, searchScore: s.searchScore }) as KnowledgeBaseItem)
			} else {
				results = candidates
			}
		}

		const finalResults = results.slice(0, limit)

		// GRAPH AUGMENTATION: Include 1-hop neighbors if requested
		if (options.augmentWithGraph && finalResults.length > 0) {
			const neighborIds = new Set<string>()
			for (const item of finalResults) {
				for (const e of item.edges || []) {
					neighborIds.add(e.targetId)
				}
				for (const e of item.inboundEdges || []) {
					neighborIds.add(e.targetId)
				}
			}

			// Filter out IDs already in finalResults
			const existingIds = new Set(finalResults.map((r) => r.itemId))
			const idsToFetch = Array.from(neighborIds).filter((id) => !existingIds.has(id))

			if (idsToFetch.length > 0) {
				// Fetch neighbors (up to 20 to avoid bloating context too much)
				// Note: traverseGraph is called on a single root, this might need adjustment if multiple roots are desired for augmentation
				const neighborNodes = await this.traverseGraph(finalResults[0]?.itemId, 1, { direction: "both" })
				for (const node of neighborNodes) {
					if (!existingIds.has(node.itemId)) {
						finalResults.push(node)
						existingIds.add(node.itemId)
						if (finalResults.length >= limit + 20) break // Hard cap on augmentation
					}
				}
			}
		}

		for (const res of finalResults) {
			if (!this.kbCache.has(res.itemId)) {
				this.kbCache.set(res.itemId, res)
			}
		}

		return finalResults.slice(0, limit + 20) // Return results + neighbors
	}

	private calculateSimilarity(a: number[], b: number[]): number {
		return cosineSimilarity(a, b)
	}

	/**
	 * Fetches the "Shared Rulebook" for the swarm from the workspace.
	 */
	async getWorkspaceSharedMemory(): Promise<string[]> {
		const ws = await this.db.selectOne("workspaces", [{ column: "id", value: this.workspace.workspaceId }])
		if (!ws) return []
		return JSON.parse(ws.sharedMemoryLayer || "[]")
	}

	/**
	 * Appends a global rule or guideline to the swarm-wide shared memory layer.
	 */
	async appendSharedMemory(memory: string): Promise<void> {
		const ws = await this.db.selectOne("workspaces", [{ column: "id", value: this.workspace.workspaceId }])
		const current = JSON.parse(ws?.sharedMemoryLayer || "[]")
		current.push(memory)
		await this._push({
			type: "update",
			table: "workspaces",
			where: [{ column: "id", value: this.workspace.workspaceId }],
			values: { sharedMemoryLayer: JSON.stringify(current) },
			layer: "domain",
		})
	}

	/**
	 * Fetch holistic intelligence bundle allowing an agent an immediate,
	 * single-read capability to establish its cognitive state.
	 */
	async getAgentBundle(agentId: string): Promise<AgentBundle> {
		const profile = await this.getAgent(agentId)

		// Grab all active/pending tasks for this specific agent
		const tasksRows = await this.db.selectWhere("tasks", [
			{ column: "agentId", value: agentId },
			{ column: "status", value: ["pending", "active"] },
		])
		const activeTasks = tasksRows.map(
			(r) =>
				({
					...r,
					taskId: r.id,
					linkedKnowledgeIds: JSON.parse(r.linkedKnowledgeIds || "[]"),
					result: r.result ? JSON.parse(r.result) : null,
				}) as TaskItem,
		)

		// Pull domains/tags relevant to the agent's permissions or general system status
		const recentKBRows = await this.db.selectWhere(
			"knowledge",
			[
				{ column: "userId", value: this.userId },
				{ column: "expiresAt", value: null },
			],
			undefined,
			{
				orderBy: { column: "createdAt", direction: "desc" },
				limit: 10,
			},
		)

		const recentKnowledge = recentKBRows.map(
			(r) =>
				({
					...r,
					itemId: r.id,
					tags: JSON.parse(r.tags || "[]"),
					edges: JSON.parse(r.edges || "[]"),
					inboundEdges: JSON.parse(r.inboundEdges || "[]"),
					embedding: r.embedding ? JSON.parse(r.embedding) : undefined,
					metadata: JSON.parse(r.metadata || "{}"),
				}) as KnowledgeBaseItem,
		)

		return { profile, activeTasks, recentKnowledge }
	}

	async listAllKnowledge(limit = 100): Promise<KnowledgeBaseItem[]> {
		return this.graphService.listAllKnowledge(limit)
	}
}
