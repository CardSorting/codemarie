import { type WriteOp } from "../../../infrastructure/db/BufferedDbPool.js"
import { AgentGitError } from "../errors.js"
import type { GraphEdge, KnowledgeBaseItem, ServiceContext, TraversalFilter } from "./types.js"

/**
 * GraphService manages the BroccoliDB knowledge graph, including traversal,
 * edge synchronization, and centrality calculations.
 */
export class GraphService {
	constructor(private ctx: ServiceContext) {}

	async mergeKnowledge(sourceId: string, targetId: string): Promise<void> {
		const source = await this.getKnowledge(sourceId)
		const target = await this.getKnowledge(targetId)

		const mergedTags = Array.from(new Set([...(target.tags || []), ...(source.tags || [])]))
		const mergedContent = `${target.content}\n---\n${source.content}`

		const mergedEdges = [...(target.edges || [])]
		for (const e of source.edges || []) {
			if (e.targetId !== targetId && !mergedEdges.some((m) => m.targetId === e.targetId && m.type === e.type)) {
				mergedEdges.push(e)
			}
		}
		const cleanedEdges = mergedEdges.filter((e) => e.targetId !== sourceId)
		const mergedConfidence = ((target.confidence ?? 0.5) + (source.confidence ?? 0.5)) / 2

		if (source.inboundEdges && source.inboundEdges.length > 0) {
			for (const inEdge of source.inboundEdges) {
				if (inEdge.targetId === targetId) continue
				try {
					const referrer = await this.getKnowledge(inEdge.targetId)
					if (referrer) {
						const updatedEdges = (referrer.edges || []).map((e: GraphEdge) =>
							e.targetId === sourceId ? { ...e, targetId } : e,
						)
						await this.updateKnowledge(inEdge.targetId, { edges: updatedEdges })
					}
				} catch (_e) {
					/* skip */
				}
			}
		}

		await this.updateKnowledge(targetId, {
			content: mergedContent,
			tags: mergedTags,
			edges: cleanedEdges,
			confidence: mergedConfidence,
			metadata: {
				...(target.metadata as Record<string, unknown>),
				...(source.metadata as Record<string, unknown>),
				mergedFrom: sourceId,
			},
		})

		await this.deleteKnowledge(sourceId)
	}

	async addKnowledge(
		kbId: string,
		type: KnowledgeBaseItem["type"],
		content: string,
		options: {
			tags?: string[]
			edges?: GraphEdge[]
			embedding?: number[]
			confidence?: number
			expiresAt?: number
			metadata?: Record<string, unknown>
		} = {},
	): Promise<string> {
		const results = await this.addKnowledgeBatch([{ kbId, type, content, options }])
		return results[0] ?? ""
	}

	async addKnowledgeBatch(
		items: {
			kbId: string
			type: KnowledgeBaseItem["type"]
			content: string
			options?: {
				tags?: string[]
				edges?: GraphEdge[]
				embedding?: number[]
				confidence?: number
				expiresAt?: number
				metadata?: Record<string, unknown>
			}
		}[],
	): Promise<string[]> {
		if (items.length === 0) return []

		const generatedIds = items.map((it) => (it.kbId === "auto" ? crypto.randomUUID() : it.kbId))
		const needsEmbeddingIndices: number[] = []
		const textsToEmbed: string[] = []

		for (let i = 0; i < items.length; i++) {
			const it = items[i]
			if (!it) continue
			if (!it.options?.embedding && this.ctx.aiService?.isAvailable() && it.content.trim()) {
				needsEmbeddingIndices.push(i)
				textsToEmbed.push(it.content)
			}
		}

		if (textsToEmbed.length > 0 && this.ctx.aiService) {
			const embeddings = await this.ctx.aiService.embedBatch(textsToEmbed, "RETRIEVAL_DOCUMENT")
			for (let i = 0; i < needsEmbeddingIndices.length; i++) {
				const originalIdx = needsEmbeddingIndices[i]
				const emb = embeddings[i]
				if (originalIdx !== undefined && emb && items[originalIdx]) {
					items[originalIdx].options = { ...items[originalIdx].options, embedding: emb }
				}
			}
		}

		const results: string[] = []
		for (let i = 0; i < items.length; i++) {
			const it = items[i]
			const itemId = generatedIds[i]
			if (!it || !itemId) continue

			const node: KnowledgeBaseItem = {
				itemId,
				type: it.type,
				content: it.content,
				tags: it.options?.tags ?? [],
				edges: it.options?.edges ?? [],
				embedding: it.options?.embedding,
				confidence: it.options?.confidence ?? 0.8,
				metadata: it.options?.metadata ?? null,
				createdAt: Date.now(),
			}

			await this.ctx.push({
				type: "insert",
				table: "knowledge",
				values: {
					id: node.itemId,
					userId: this.ctx.userId,
					type: node.type,
					content: node.content,
					tags: JSON.stringify(node.tags),
					embedding: node.embedding ? JSON.stringify(node.embedding) : null,
					confidence: node.confidence,
					metadata: node.metadata ? JSON.stringify(node.metadata) : null,
					createdAt: node.createdAt,
					expiresAt: it.options?.expiresAt ?? null,
				},
				layer: "domain",
			} as WriteOp)

			if (node.edges && node.edges.length > 0) {
				await this._syncOutboundEdges(node.itemId, node.edges)
			}

			this.ctx.kbCache.set(node.itemId, node)
			results.push(node.itemId)
		}

		return results
	}

	async updateKnowledge(kbId: string, updates: Partial<KnowledgeBaseItem>): Promise<void> {
		const existing = await this.getKnowledge(kbId)
		const updated = { ...existing, ...updates }

		const dbUpdates: Record<string, unknown> = {}
		if (updates.content !== undefined) dbUpdates.content = updates.content
		if (updates.tags !== undefined) dbUpdates.tags = JSON.stringify(updates.tags)
		if (updates.edges !== undefined) dbUpdates.edges = JSON.stringify(updates.edges)
		if (updates.confidence !== undefined) dbUpdates.confidence = updates.confidence
		if (updates.metadata !== undefined) dbUpdates.metadata = JSON.stringify(updates.metadata)
		if (updates.hubScore !== undefined) dbUpdates.hubScore = updates.hubScore

		await this.ctx.push({
			type: "update",
			table: "knowledge",
			values: dbUpdates,
			where: [
				{ column: "id", value: kbId },
				{ column: "userId", value: this.ctx.userId },
			],
			layer: "domain",
		} as WriteOp)

		if (updates.edges) {
			await this._syncOutboundEdges(kbId, updates.edges)
		}

		this.ctx.kbCache.set(kbId, updated)
	}

	async deleteKnowledge(kbId: string): Promise<void> {
		await this.ctx.push({
			type: "delete",
			table: "knowledge",
			where: [
				{ column: "id", value: kbId },
				{ column: "userId", value: this.ctx.userId },
			],
			layer: "domain",
		} as WriteOp)

		// Delete references
		await this.ctx.push({
			type: "delete",
			table: "knowledge_edges",
			where: [{ column: "sourceId", value: kbId }],
			layer: "domain",
		} as WriteOp)
		await this.ctx.push({
			type: "delete",
			table: "knowledge_edges",
			where: [{ column: "targetId", value: kbId }],
			layer: "domain",
		} as WriteOp)

		this.ctx.kbCache.delete(kbId)
	}

	async getKnowledge(kbId: string): Promise<KnowledgeBaseItem> {
		const cached = this.ctx.kbCache.get(kbId)
		if (cached) return cached

		const rows = await this.ctx.db.selectWhere("knowledge", [
			{ column: "id", value: kbId },
			{ column: "userId", value: this.ctx.userId },
		])

		if (rows.length === 0) {
			throw new AgentGitError(`Knowledge item ${kbId} not found`, "NODE_NOT_FOUND")
		}

		const row = rows[0]
		if (!row) throw new AgentGitError(`Knowledge item ${kbId} not found`, "NODE_NOT_FOUND")

		const outboundRows = await this.ctx.db.selectWhere("knowledge_edges", [{ column: "sourceId", value: kbId }])
		const inboundRows = await this.ctx.db.selectWhere("knowledge_edges", [{ column: "targetId", value: kbId }])

		const node: KnowledgeBaseItem = {
			itemId: row.id as string,
			type: row.type as KnowledgeBaseItem["type"],
			content: row.content as string,
			tags: JSON.parse((row.tags as string) || "[]"),
			edges: outboundRows.map((r) => ({
				targetId: r.targetId as string,
				type: r.type as GraphEdge["type"],
				weight: r.weight as number,
			})),
			inboundEdges: inboundRows.map((r) => ({
				targetId: r.sourceId as string,
				type: r.type as GraphEdge["type"],
				weight: r.weight as number,
			})),
			embedding: row.embedding ? JSON.parse(row.embedding as string) : undefined,
			confidence: row.confidence as number,
			hubScore: row.hubScore as number,
			metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
			createdAt: Number(row.createdAt),
		}

		this.ctx.kbCache.set(kbId, node)
		return node
	}

	async getKnowledgeBatch(ids: string[]): Promise<KnowledgeBaseItem[]> {
		const results: KnowledgeBaseItem[] = []
		const toFetch: string[] = []

		for (const id of ids) {
			const cached = this.ctx.kbCache.get(id)
			if (cached) results.push(cached)
			else toFetch.push(id)
		}

		if (toFetch.length > 0) {
			const rows = await this.ctx.db.selectWhere("knowledge", [
				{ column: "id", value: toFetch, operator: "IN" },
				{ column: "userId", value: this.ctx.userId },
			])

			for (const row of rows) {
				const kbId = row.id as string
				const outboundRows = await this.ctx.db.selectWhere("knowledge_edges", [{ column: "sourceId", value: kbId }])
				const inboundRows = await this.ctx.db.selectWhere("knowledge_edges", [{ column: "targetId", value: kbId }])

				const node: KnowledgeBaseItem = {
					itemId: kbId,
					type: row.type as KnowledgeBaseItem["type"],
					content: row.content as string,
					tags: JSON.parse((row.tags as string) || "[]"),
					edges: outboundRows.map((r) => ({
						targetId: r.targetId as string,
						type: r.type as GraphEdge["type"],
						weight: r.weight as number,
					})),
					inboundEdges: inboundRows.map((r) => ({
						targetId: r.sourceId as string,
						type: r.type as GraphEdge["type"],
						weight: r.weight as number,
					})),
					embedding: row.embedding ? JSON.parse(row.embedding as string) : undefined,
					confidence: row.confidence as number,
					hubScore: row.hubScore as number,
					metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
					createdAt: Number(row.createdAt),
				}
				this.ctx.kbCache.set(kbId, node)
				results.push(node)
			}
		}

		return results
	}

	async traverseGraph(startId: string, maxDepth = 2, filter?: TraversalFilter): Promise<KnowledgeBaseItem[]> {
		const visited = new Set<string>()
		const results: KnowledgeBaseItem[] = []
		let currentLevelIds = [startId]

		for (let depth = 0; depth <= maxDepth; depth++) {
			if (currentLevelIds.length === 0) break
			const nextLevelIds = new Set<string>()
			const idsToFetch = currentLevelIds.filter((id) => !visited.has(id))

			const nodes = await this.getKnowledgeBatch(idsToFetch)
			for (const node of nodes) {
				visited.add(node.itemId)
				results.push(node)

				if (depth < maxDepth) {
					let edgesToFollow: GraphEdge[] = []
					const direction = filter?.direction ?? "outbound"
					if (direction === "outbound" || direction === "both") edgesToFollow.push(...(node.edges || []))
					if (direction === "inbound" || direction === "both") edgesToFollow.push(...(node.inboundEdges || []))

					if (filter?.edgeTypes) {
						edgesToFollow = edgesToFollow.filter((e) => filter.edgeTypes?.includes(e.type))
					}
					if (filter?.minWeight !== undefined) {
						edgesToFollow = edgesToFollow.filter((e) => (e.weight ?? 1.0) >= (filter.minWeight ?? 0))
					}

					for (const e of edgesToFollow) {
						if (!visited.has(e.targetId)) nextLevelIds.add(e.targetId)
					}
				}
			}
			currentLevelIds = Array.from(nextLevelIds)
		}
		return results
	}

	async getNodeCentrality(kbId: string): Promise<{ kbId: string; inbound: number; outbound: number; totalDegree: number }> {
		const node = await this.getKnowledge(kbId)
		const inbound = (node.inboundEdges || []).length
		const outbound = (node.edges || []).length
		return { kbId, inbound, outbound, totalDegree: inbound + outbound }
	}

	async getGlobalCentrality(limit = 10): Promise<{ kbId: string; score: number }[]> {
		const rows = await this.ctx.db.selectWhere("knowledge", [{ column: "userId", value: this.ctx.userId }], undefined, {
			orderBy: { column: "hubScore", direction: "desc" },
			limit,
		})
		return rows.map((r) => ({
			kbId: r.id as string,
			score: (r.hubScore as number) || 0,
		}))
	}

	async extractSubgraph(
		rootId: string,
		maxDepth = 2,
		filter?: TraversalFilter,
	): Promise<{ nodes: KnowledgeBaseItem[]; edges: { sourceId: string; targetId: string; type: string; weight?: number }[] }> {
		const nodes = await this.traverseGraph(rootId, maxDepth, filter)
		const nodeIds = new Set(nodes.map((n) => n.itemId))
		const edges: { sourceId: string; targetId: string; type: string; weight?: number }[] = []

		for (const node of nodes) {
			for (const e of node.edges || []) {
				if (nodeIds.has(e.targetId)) {
					edges.push({ sourceId: node.itemId, targetId: e.targetId, type: e.type, weight: e.weight })
				}
			}
		}
		return { nodes, edges }
	}

	private async _syncOutboundEdges(sourceId: string, edges: GraphEdge[]): Promise<void> {
		for (const edge of edges) {
			await this.ctx.push({
				type: "upsert",
				table: "knowledge_edges",
				values: {
					sourceId,
					targetId: edge.targetId,
					type: edge.type,
					weight: edge.weight ?? 1.0,
				},
				where: [
					{ column: "sourceId", value: sourceId },
					{ column: "targetId", value: edge.targetId },
				],
				layer: "domain",
			} as WriteOp)
		}
	}
}
