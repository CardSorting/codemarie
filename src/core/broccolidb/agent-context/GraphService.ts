import * as crypto from "node:crypto"
import { AgentGitError } from "@/core/broccolidb/errors.js"
import { BufferedDbPool } from "@/infrastructure/db/BufferedDbPool.js"
import type { GraphEdge, KnowledgeBaseItem, ServiceContext, TraversalFilter } from "./types.js"

export class GraphService {
	constructor(private ctx: ServiceContext) {}

	async mergeKnowledge(sourceId: string, targetId: string): Promise<void> {
		const source = await this.getKnowledge(sourceId)
		const target = await this.getKnowledge(targetId)

		const mergedTags = Array.from(new Set([...target.tags, ...source.tags]))
		const mergedContent = `${target.content}\n---\n${source.content}`

		const mergedEdges = [...target.edges]
		for (const e of source.edges) {
			if (e.targetId !== targetId && !mergedEdges.some((m) => m.targetId === e.targetId && m.type === e.type)) {
				mergedEdges.push(e)
			}
		}
		const cleanedEdges = mergedEdges.filter((e) => e.targetId !== sourceId)
		const mergedConfidence = (target.confidence + source.confidence) / 2

		if (source.inboundEdges && source.inboundEdges.length > 0) {
			for (const inEdge of source.inboundEdges) {
				if (inEdge.targetId === targetId) continue
				try {
					const referrer = await this.getKnowledge(inEdge.targetId)
					if (referrer) {
						const updatedEdges = referrer.edges.map((e) => (e.targetId === sourceId ? { ...e, targetId } : e))
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
			metadata: { ...target.metadata, ...source.metadata, mergedFrom: sourceId },
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
			metadata?: Record<string, any>
		} = {},
	): Promise<string> {
		const results = await this.addKnowledgeBatch([{ kbId, type, content, options }])
		return results[0]!
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
				metadata?: Record<string, any>
			}
		}[],
	): Promise<string[]> {
		if (items.length === 0) return []

		const generatedIds = items.map((it) => (it.kbId === "auto" ? crypto.randomUUID() : it.kbId))
		const needsEmbeddingIndices: number[] = []
		const textsToEmbed: string[] = []

		for (let i = 0; i < items.length; i++) {
			const it = items[i]!
			if (!it.options?.embedding && this.ctx.aiService?.isAvailable() && it.content.trim()) {
				needsEmbeddingIndices.push(i)
				textsToEmbed.push(it.content)
			}
		}

		if (textsToEmbed.length > 0) {
			const embeddings = await this.ctx.aiService!.embedBatch(textsToEmbed, "RETRIEVAL_DOCUMENT")
			for (let i = 0; i < needsEmbeddingIndices.length; i++) {
				const originalIdx = needsEmbeddingIndices[i]!
				if (embeddings[i]) {
					if (!items[originalIdx]!.options) items[originalIdx]!.options = {}
					items[originalIdx]!.options!.embedding = embeddings[i]!
				}
			}
		}

		for (let i = 0; i < items.length; i++) {
			const it = items[i]!
			const id = generatedIds[i]!
			const options = it.options || {}
			const edges = options.edges || []

			// [Pass 3/4 Hardening] Automated Proof Hashing for Evidence Traceability
			// Satisfies verifySovereignty requirements in ReasoningService
			let pedigreeHash: string | undefined
			let proofHash: string | undefined
			if (it.type === "conclusion" || it.type === "hypothesis") {
				// Pedigree is the hash of the content + its supporting evidence edges
				pedigreeHash = crypto
					.createHash("sha256")
					.update(
						it.content +
							edges
								.map((e) => e.targetId)
								.sort()
								.join(","),
					)
					.digest("hex")

				// Proof roots the pedigree in a specific world state (merkle tree hash)
				const treeHash = options.metadata?.treeHash || ""
				proofHash = crypto
					.createHash("sha256")
					.update(treeHash + pedigreeHash)
					.digest("hex")
			}

			await this.ctx.push({
				type: "insert",
				table: "knowledge",
				values: {
					id,
					userId: this.ctx.userId,
					type: it.type,
					content: it.content,
					tags: JSON.stringify(options.tags || []),
					edges: JSON.stringify(edges),
					inboundEdges: JSON.stringify((options as any).inboundEdges || []),
					embedding: options.embedding ? JSON.stringify(options.embedding) : null,
					confidence: options.confidence ?? 1.0,
					hubScore: edges.length,
					expiresAt: options.expiresAt || null,
					metadata: JSON.stringify({ ...options.metadata, pedigreeHash, proofHash }),
					createdAt: Date.now(),
				},
				layer: "domain",
			})

			for (const edge of edges) {
				await this.ctx.push({
					type: "insert",
					table: "knowledge_edges",
					values: {
						sourceId: id,
						targetId: edge.targetId,
						type: edge.type,
						weight: edge.weight ?? 1.0,
					},
					layer: "domain",
				})
			}
			await this._syncOutboundEdges(id, edges)
		}

		return generatedIds
	}

	/**
	 * Annotates an existing knowledge node with additional insights or constraints.
	 * Tier 4: Unified Cognitive Fabric - Allows agents to link reasoning across nodes.
	 */
	async annotateKnowledge(targetId: string, agentId: string, annotation: string, metadata?: any): Promise<void> {
		const existing = await this.getKnowledge(targetId)

		// Create a separate annotation node for graph traceability
		const annotationId = `ann-${crypto.randomUUID().slice(0, 8)}`
		await this.addKnowledge(annotationId, "thought" as any, annotation, {
			tags: ["annotation", agentId],
			edges: [{ targetId, type: "ANNOTATES" as any, weight: 1.0 }],
			metadata: { ...metadata, annotator: agentId, target: targetId },
		})

		// Also enrich the target node's metadata for high-throughput context retrieval
		const annotations = existing.metadata?.annotations || []
		annotations.push({
			agentId,
			text: annotation,
			ts: Date.now(),
		})

		await this.updateKnowledge(targetId, {
			metadata: { ...existing.metadata, annotations },
		})
	}

	async updateKnowledge(kbId: string, patch: Partial<KnowledgeBaseItem>): Promise<void> {
		const existing = await this.getKnowledge(kbId)
		const updatePayload: Record<string, any> = {}

		if (patch.content !== undefined) updatePayload.content = patch.content
		if (patch.tags !== undefined) updatePayload.tags = JSON.stringify(patch.tags)
		if (patch.embedding !== undefined) updatePayload.embedding = JSON.stringify(patch.embedding)
		if (patch.confidence !== undefined) updatePayload.confidence = patch.confidence
		if (patch.metadata !== undefined) updatePayload.metadata = JSON.stringify({ ...existing.metadata, ...patch.metadata })

		if (patch.edges !== undefined) {
			await this._removeOutboundEdges(kbId, existing.edges || [])
			await this.ctx.push({
				type: "delete",
				table: "knowledge_edges",
				where: [{ column: "sourceId", value: kbId }],
				layer: "domain",
			})

			for (const edge of patch.edges) {
				await this.ctx.push({
					type: "insert",
					table: "knowledge_edges",
					values: {
						sourceId: kbId,
						targetId: edge.targetId,
						type: edge.type,
						weight: edge.weight ?? 1.0,
					},
					layer: "domain",
				})
			}
			await this._syncOutboundEdges(kbId, patch.edges)
		}

		await this.ctx.push({
			type: "update",
			table: "knowledge",
			where: [{ column: "id", value: kbId }],
			values: updatePayload,
			layer: "domain",
		})

		if (this.ctx.kbCache.has(kbId)) {
			const cached = this.ctx.kbCache.get(kbId)!
			this.ctx.kbCache.set(kbId, { ...cached, ...patch })
		}
	}

	async deleteKnowledge(kbId: string): Promise<void> {
		const item = await this.getKnowledge(kbId)
		await this._removeOutboundEdges(kbId, item.edges || [])

		if (item.inboundEdges && item.inboundEdges.length > 0) {
			for (const inEdge of item.inboundEdges) {
				try {
					const source = await this.getKnowledge(inEdge.targetId)
					if (source) {
						const cleanedEdges = (source.edges || []).filter((e) => e.targetId !== kbId)
						await this.updateKnowledge(inEdge.targetId, { edges: cleanedEdges })
					}
				} catch (_e) {
					/* skip */
				}
			}
		}

		await this.ctx.push({
			type: "delete",
			table: "knowledge_edges",
			where: [{ column: "sourceId", value: kbId }],
			layer: "domain",
		})
		await this.ctx.push({
			type: "delete",
			table: "knowledge_edges",
			where: [{ column: "targetId", value: kbId }],
			layer: "domain",
		})

		await this.ctx.push({
			type: "delete",
			table: "knowledge",
			where: [{ column: "id", value: kbId }],
			layer: "domain",
		})
		this.ctx.kbCache.delete(kbId)
	}

	async getKnowledge(itemId: string): Promise<KnowledgeBaseItem> {
		const results = await this.getKnowledgeBatch([itemId])
		if (results.length === 0) {
			throw new AgentGitError(`Knowledge item ${itemId} not found`, "FILE_NOT_FOUND")
		}
		return results[0]!
	}

	async getKnowledgeBatch(itemIds: string[]): Promise<KnowledgeBaseItem[]> {
		if (itemIds.length === 0) return []

		const results: KnowledgeBaseItem[] = []
		const missingIds: string[] = []

		for (const id of itemIds) {
			const cached = this.ctx.kbCache.get(id)
			if (cached) results.push(cached)
			else missingIds.push(id)
		}

		if (missingIds.length > 0) {
			const rows = await this.ctx.db.selectWhere("knowledge", [{ column: "id", value: missingIds }])
			if (rows.length > 0) {
				const foundIds = rows.map((r) => r.id as string)

				// Batch fetch all edges for found nodes
				const [outboundRows, inboundRows] = await Promise.all([
					this.ctx.db.selectWhere("knowledge_edges", [{ column: "sourceId", value: foundIds }]),
					this.ctx.db.selectWhere("knowledge_edges", [{ column: "targetId", value: foundIds }]),
				])

				const outboundMap = new Map<string, GraphEdge[]>()
				const inboundMap = new Map<string, GraphEdge[]>()

				for (const r of outboundRows) {
					const edges = outboundMap.get(r.sourceId as string) || []
					edges.push({ targetId: r.targetId as string, type: r.type as any, weight: r.weight as number })
					outboundMap.set(r.sourceId as string, edges)
				}
				for (const r of inboundRows) {
					const edges = inboundMap.get(r.targetId as string) || []
					edges.push({ targetId: r.sourceId as string, type: r.type as any, weight: r.weight as number })
					inboundMap.set(r.targetId as string, edges)
				}

				for (const row of rows) {
					const itemId = row.id as string
					const nodeData: KnowledgeBaseItem = {
						itemId,
						type: row.type as any,
						content: row.content as string,
						tags: JSON.parse((row.tags as string) || "[]"),
						edges: outboundMap.get(itemId) || [],
						inboundEdges: inboundMap.get(itemId) || [],
						embedding: row.embedding ? JSON.parse(row.embedding as string) : undefined,
						confidence: row.confidence as number,
						hubScore: row.hubScore as number,
						expiresAt: row.expiresAt as number | null,
						metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
						createdAt: Number(row.createdAt),
					}
					this.ctx.kbCache.set(itemId, nodeData)
					results.push(nodeData)
				}
			}
		}

		return results
	}

	async traverseGraph(startId: string, maxDepth = 2, filter?: TraversalFilter): Promise<KnowledgeBaseItem[]> {
		const visited = new Set<string>()
		const results: KnowledgeBaseItem[] = []
		const direction = filter?.direction || "outbound"

		let currentLevelIds = [startId]
		for (let depth = 0; depth <= maxDepth; depth++) {
			const nextLevelIds = new Set<string>()
			const idsToFetch = currentLevelIds.filter((id) => !visited.has(id))
			if (idsToFetch.length === 0) break

			const cachedNodes = new Map<string, KnowledgeBaseItem>()
			const missingIds: string[] = []
			for (const id of idsToFetch) {
				const cached = this.ctx.kbCache.get(id)
				if (cached) cachedNodes.set(id, cached)
				else missingIds.push(id)
			}

			if (missingIds.length > 0) {
				const rows = await this.ctx.db.selectWhere("knowledge", [{ column: "id", value: missingIds }])
				for (const row of rows) {
					const outboundRows = await this.ctx.db.selectWhere("knowledge_edges", [{ column: "sourceId", value: row.id }])
					const inboundRows = await this.ctx.db.selectWhere("knowledge_edges", [{ column: "targetId", value: row.id }])

					const nodeData: KnowledgeBaseItem = {
						itemId: row.id,
						type: row.type as any,
						content: row.content,
						tags: JSON.parse(row.tags || "[]"),
						edges: outboundRows.map((r) => ({ targetId: r.targetId, type: r.type as any, weight: r.weight })),
						inboundEdges: inboundRows.map((r) => ({ targetId: r.sourceId, type: r.type as any, weight: r.weight })),
						embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
						confidence: row.confidence,
						hubScore: row.hubScore,
						expiresAt: row.expiresAt as number | null,
						metadata: row.metadata ? JSON.parse(row.metadata) : null,
						createdAt: Number(row.createdAt),
					}
					this.ctx.kbCache.set(row.id, nodeData)
					cachedNodes.set(row.id, nodeData)
				}
			}

			for (const id of idsToFetch) {
				const data = cachedNodes.get(id)
				if (!data) continue

				visited.add(data.itemId)
				results.push(data)

				if (depth < maxDepth) {
					let edgesToFollow: GraphEdge[] = []
					if (direction === "outbound" || direction === "both") edgesToFollow.push(...(data.edges || []))
					if (direction === "inbound" || direction === "both") edgesToFollow.push(...(data.inboundEdges || []))

					if (filter?.edgeTypes && filter.edgeTypes.length > 0) {
						edgesToFollow = edgesToFollow.filter((e) => filter.edgeTypes?.includes(e.type))
					}
					if (filter?.minWeight !== undefined) {
						edgesToFollow = edgesToFollow.filter((e) => (e.weight ?? 1.0) >= filter.minWeight!)
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

	private async _syncOutboundEdges(_sourceId: string, edges: GraphEdge[]): Promise<void> {
		if (edges.length === 0) return
		for (const edge of edges) {
			try {
				await this.ctx.push({
					type: "update",
					table: "knowledge",
					where: [{ column: "id", value: edge.targetId }],
					values: {
						hubScore: BufferedDbPool.increment(1) as any,
					},
					layer: "domain",
				})
			} catch (_e) {
				/* ignore */
			}
		}
	}

	private async _removeOutboundEdges(_sourceId: string, edges: GraphEdge[]): Promise<void> {
		if (edges.length === 0) return
		for (const edge of edges) {
			try {
				await this.ctx.push({
					type: "update",
					table: "knowledge",
					where: [{ column: "id", value: edge.targetId }],
					values: {
						hubScore: BufferedDbPool.increment(-1) as any,
					},
					layer: "domain",
				})
			} catch (_e) {
				/* ignore */
			}
		}
	}

	/**
	 * Degree centrality: count of inbound + outbound edges.
	 */
	async getNodeCentrality(kbId: string): Promise<{ kbId: string; inbound: number; outbound: number; totalDegree: number }> {
		const node = await this.getKnowledge(kbId)
		const inbound = (node.inboundEdges || []).length
		const outbound = (node.edges || []).length
		return { kbId, inbound, outbound, totalDegree: inbound + outbound }
	}

	/**
	 * Global hub detection: finds top N nodes with highest total degree across the graph.
	 */
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

	/**
	 * Extract a self-contained subgraph from a root node.
	 */
	async extractSubgraph(
		rootId: string,
		maxDepth = 2,
		filter?: TraversalFilter,
	): Promise<{ nodes: KnowledgeBaseItem[]; edges: any[] }> {
		const nodes = await this.traverseGraph(rootId, maxDepth, filter)
		const nodeIds = new Set(nodes.map((n) => n.itemId))
		const edges: any[] = []

		for (const node of nodes) {
			for (const e of node.edges || []) {
				if (nodeIds.has(e.targetId)) {
					edges.push({ sourceId: node.itemId, targetId: e.targetId, type: e.type, weight: e.weight ?? 1.0 })
				}
			}
		}

		return { nodes, edges }
	}

	async listAllKnowledge(limit = 100): Promise<KnowledgeBaseItem[]> {
		const rows = await this.ctx.db.selectWhere("knowledge", [{ column: "userId", value: this.ctx.userId }], undefined, {
			orderBy: { column: "createdAt", direction: "desc" },
			limit,
		})
		return rows.map(
			(r) =>
				({
					...r,
					itemId: r.id,
					tags: JSON.parse(r.tags || "[]"),
					edges: JSON.parse(r.edges || "[]"),
					inboundEdges: JSON.parse(r.inboundEdges || "[]"),
					embedding: r.embedding ? JSON.parse(r.embedding) : undefined,
					metadata: JSON.parse(r.metadata || "{}"),
					createdAt: Number(r.createdAt),
				}) as any,
		)
	}
}
