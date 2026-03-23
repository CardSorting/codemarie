import * as crypto from "node:crypto"
import { Logger } from "@/shared/services/Logger"
import { GraphService } from "./GraphService.js"
import type { ContradictionReport, KnowledgeBaseItem, Pedigree, ServiceContext } from "./types.js"

export class ReasoningService {
	constructor(
		private ctx: ServiceContext,
		private graph: GraphService,
	) {}

	async detectContradictions(startIds: string | string[], depth = 3): Promise<ContradictionReport[]> {
		const ids = Array.isArray(startIds) ? startIds : [startIds]
		const reports: ContradictionReport[] = []
		const visitedNodesInNeighborhood = new Set<string>()

		for (const startId of ids) {
			const influence = await this.graph.traverseGraph(startId, depth, {
				edgeTypes: ["supports", "depends_on"],
				direction: "outbound",
			})
			const allRelatedIds = [startId, ...influence.map((n) => n.itemId)]

			for (const relatedId of allRelatedIds) {
				const neighborhood = await this.graph.traverseGraph(relatedId, 1, { direction: "both" })

				// Batch fetch all potential conflicting nodes in this neighborhood
				const conflictTargetIds = neighborhood.flatMap((node) =>
					node.edges.filter((e) => e.type === "contradicts").map((e) => e.targetId),
				)
				const conflictingNodesMap = new Map(
					(await this.graph.getKnowledgeBatch(conflictTargetIds)).map((n) => [n.itemId, n]),
				)

				for (const node of neighborhood) {
					if (visitedNodesInNeighborhood.has(node.itemId)) continue
					visitedNodesInNeighborhood.add(node.itemId)

					const contradictions = node.edges.filter((e) => e.type === "contradicts")
					for (const edge of contradictions) {
						const conflictingNode = conflictingNodesMap.get(edge.targetId)
						if (conflictingNode && node.confidence > 0.7 && conflictingNode.confidence > 0.7) {
							reports.push({
								nodeId: node.itemId,
								conflictingNodeId: conflictingNode.itemId,
								confidence: (node.confidence + conflictingNode.confidence) / 2,
								evidencePath: [node.itemId, conflictingNode.itemId],
							})
						}
					}
				}
			}
		}
		return reports
	}

	async getReasoningPedigree(nodeId: string, maxDepth = 5): Promise<Pedigree> {
		const item = await this.graph.getKnowledge(nodeId)
		const lineage: Pedigree["lineage"] = []
		const supportingIds: string[] = []
		let effectiveConfidence = item.confidence

		let currentNodes = [item]
		const visited = new Set<string>()

		for (let i = 0; i < maxDepth; i++) {
			const nextLevelIds: string[] = []
			for (const node of currentNodes) {
				if (visited.has(node.itemId)) continue
				visited.add(node.itemId)

				lineage.push({
					nodeId: node.itemId,
					type: node.type,
					content: node.content,
					timestamp: node.createdAt,
					confidence: node.confidence,
				})

				const supportingEdges = node.edges.filter((e) => e.type === "supports" || e.type === "depends_on")
				for (const edge of supportingEdges) {
					supportingIds.push(edge.targetId)
					nextLevelIds.push(edge.targetId)
				}
			}

			if (nextLevelIds.length === 0) break

			// Batch fetch next level
			const nextLevel = await this.graph.getKnowledgeBatch(nextLevelIds)
			for (const target of nextLevel) {
				effectiveConfidence *= target.confidence
			}
			currentNodes = nextLevel
		}

		return {
			nodeId,
			effectiveConfidence: Math.max(0, Math.min(1, effectiveConfidence)),
			lineage,
			supportingEvidenceIds: Array.from(new Set(supportingIds)),
		}
	}

	async getRecursiveConfidence(nodeId: string): Promise<number> {
		const pedigree = await this.getReasoningPedigree(nodeId)
		return pedigree.effectiveConfidence
	}

	async getNarrativePedigree(nodeId: string): Promise<string> {
		if (!this.ctx.aiService?.isAvailable()) return "AI Service unavailable for narrative generation."
		const pedigree = await this.getReasoningPedigree(nodeId)
		const item = await this.graph.getKnowledge(nodeId)

		return this.ctx.aiService.explainReasoningChain(
			item.content,
			pedigree.lineage.map((l) => ({
				content: l.content,
				type: l.type,
			})),
		)
	}

	async verifySovereignty(
		nodeId: string,
	): Promise<{ isValid: boolean; chain: string[]; recursiveConfidence: number; peakConfidence: number; brokenNode?: string }> {
		const visited = new Set<string>()
		const nodeScores = new Map<string, number>()
		const chain: string[] = []

		const computeConfidence = async (currentId: string): Promise<number> => {
			if (visited.has(currentId)) return nodeScores.get(currentId) || 0
			visited.add(currentId)
			chain.push(currentId)

			const node = await this.graph.getKnowledge(currentId)
			if (!node) return 0

			// 1. Structural Integrity Check (Proof Hash)
			if (node.type === "conclusion") {
				const metadata = node.metadata || {}
				const proofHash = metadata.proofHash
				if (!proofHash) return -1 // Flag as invalid

				const treeHash = metadata.treeHash || ""
				const pedigreeHash = metadata.pedigreeHash || ""
				const expectedHash = crypto
					.createHash("sha256")
					.update(treeHash + pedigreeHash)
					.digest("hex")

				if (proofHash !== expectedHash) return -1
			}

			// 2. Evidence Composition (Noisy-OR)
			// Base confidence is the node's intrinsic probability.
			const baseProb = node.confidence || 0.1

			const evidenceEdges = [...(node.edges || []), ...(node.inboundEdges || [])].filter(
				(e) => e.type === "supports" || e.type === "depends_on",
			)

			if (evidenceEdges.length === 0) {
				nodeScores.set(currentId, baseProb)
				return baseProb
			}

			// Accumulate evidence strength: P = 1 - (1-P_base) * PRODUCT(1 - P_ev_i * W_i)
			let invProb = 1 - baseProb
			for (const edge of evidenceEdges) {
				const targetId = edge.targetId === currentId ? (edge as any).sourceId : edge.targetId
				if (!targetId) continue

				const evProb = await computeConfidence(targetId)
				if (evProb === -1) return -1 // Propagate invalidity

				invProb *= 1 - evProb * (edge.weight || 1.0)
			}

			const finalProb = 1 - invProb
			nodeScores.set(currentId, finalProb)
			return finalProb
		}

		const resultProb = await computeConfidence(nodeId)
		if (resultProb === -1) {
			return { isValid: false, chain, recursiveConfidence: 0, peakConfidence: 0, brokenNode: nodeId }
		}

		// Calculate peak confidence across the visited chain
		let peak = 0
		for (const id of visited) {
			const node = await this.graph.getKnowledge(id)
			if (node && node.confidence > peak) peak = node.confidence
		}

		return {
			isValid: true,
			chain,
			recursiveConfidence: resultProb,
			peakConfidence: peak,
		}
	}

	async selfHealGraph(listAllFn: () => Promise<KnowledgeBaseItem[]>): Promise<{ prunedNodes: string[]; prunedEdges: number }> {
		const allKnowledge = await listAllFn()
		const nodesToPrune: string[] = []
		let edgesPruned = 0

		// Soundness Decay: Natural expiration of older reasoning to prioritize 'fresh' context
		const DECAY_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7 // 1 week
		const now = Date.now()

		// Pre-identify conclusions for potentially batched sovereignty checks later
		const conclusions = allKnowledge.filter((n) => n.type === "conclusion")

		for (const node of allKnowledge) {
			let shouldPrune = false
			let confidence = node.confidence

			// Apply decay to old nodes
			if (now - node.createdAt > DECAY_THRESHOLD_MS) {
				confidence *= 0.95 // 5% decay per check cycle after threshold
			}

			if (confidence < 0.2) shouldPrune = true

			const contradictions = (node.inboundEdges || []).filter((e) => e.type === "contradicts")
			if (contradictions.length > 3) shouldPrune = true

			if (shouldPrune) {
				nodesToPrune.push(node.itemId)
				edgesPruned += (node.edges || []).length + (node.inboundEdges || []).length
				await this.graph.deleteKnowledge(node.itemId)
			} else if (confidence !== node.confidence) {
				// Update decayed confidence
				await this.graph.updateKnowledge(node.itemId, { confidence })
			}
		}

		// Post-prune conclusions that lost their sovereignty
		// (We do this after initial pruning as some evidence might have been pruned)
		const remainingConclusions = await this.graph.getKnowledgeBatch(
			conclusions.map((c) => c.itemId).filter((id) => !nodesToPrune.includes(id)),
		)
		for (const node of remainingConclusions) {
			const { isValid } = await this.verifySovereignty(node.itemId)
			if (!isValid && !nodesToPrune.includes(node.itemId)) {
				nodesToPrune.push(node.itemId)
				edgesPruned += (node.edges || []).length + (node.inboundEdges || []).length
				await this.graph.deleteKnowledge(node.itemId)
			}
		}

		// [Pass 3 Hardening] Topological PageRank
		// Update hubScores based on actual centrality, not just raw counts
		if (allKnowledge.length > 0) {
			const scores = new Map<string, number>()
			allKnowledge.forEach((k) => scores.set(k.itemId, 1.0 / allKnowledge.length))

			// 3 iterations of power method (simplified PageRank)
			for (let i = 0; i < 3; i++) {
				const nextScores = new Map<string, number>()
				for (const node of allKnowledge) {
					const contribution = scores.get(node.itemId)! / (node.edges.length || 1)
					for (const edge of node.edges) {
						nextScores.set(edge.targetId, (nextScores.get(edge.targetId) || 0) + contribution)
					}
				}
				nextScores.forEach((v, k) => scores.set(k, v))
			}

			// Update hubScores in DB
			for (const [id, score] of scores) {
				await this.graph.updateKnowledge(id, { hubScore: Math.round(score * 1000) })
			}
		}

		return { prunedNodes: nodesToPrune, prunedEdges: edgesPruned }
	}

	/**
	 * Automatically discovers and adds relationships for a node based on semantic similarity.
	 * Uses Gemini to evaluate the specific logical link.
	 */
	async autoDiscoverRelationships(nodeId: string, limit = 5): Promise<{ discovered: number; suggestions: string[] }> {
		const item = await this.graph.getKnowledge(nodeId)
		if (!this.ctx.aiService?.isAvailable()) return { discovered: 0, suggestions: [] }

		const candidates = await this.ctx.searchKnowledge(item.content, limit + 5)
		const suggestions: string[] = []
		let discovered = 0

		const existingTargetIds = new Set(item.edges.map((e) => e.targetId))

		for (const cand of candidates) {
			if (cand.itemId === nodeId || existingTargetIds.has(cand.itemId)) continue

			try {
				const relationship = await this.ctx.aiService.evaluateLogicRelationship(item.content, cand.content)

				if (relationship === "supports" || relationship === "contradicts") {
					const newEdges = [...item.edges, { targetId: cand.itemId, type: relationship, weight: 0.8 }]
					await this.graph.updateKnowledge(nodeId, { edges: newEdges })

					suggestions.push(`Auto-linked ${nodeId} to ${cand.itemId} (${relationship})`)
					discovered++
				}

				if (discovered >= limit) break
			} catch (e) {
				Logger.warn(`[ReasoningService] Auto-discovery failed for ${cand.itemId}:`, (e as Error).message)
			}
		}

		return { discovered, suggestions }
	}

	/**
	 * Calculates a heuristic 'Soundness Score' for a set of nodes.
	 */
	async getLogicalSoundness(nodeIds: string[]): Promise<number> {
		if (nodeIds.length === 0) return 1.0

		let totalConfidence = 0
		let contradictionCount = 0
		let supportCount = 0

		const items = await Promise.all(nodeIds.map((id) => this.graph.getKnowledge(id).catch(() => null)))
		const validItems = items.filter((i) => i !== null) as KnowledgeBaseItem[]
		if (validItems.length === 0) return 1.0

		for (const item of validItems) {
			totalConfidence += item.confidence
			contradictionCount += item.edges.filter((e) => e.type === "contradicts").length
			supportCount += item.edges.filter((e) => e.type === "supports" || e.type === "depends_on").length
		}

		const avgConfidence = totalConfidence / validItems.length
		const conflictPenalty = Math.max(0, 1 - contradictionCount * 0.2)
		const supportBonus = Math.min(0.2, supportCount * 0.05)

		return Math.max(0, Math.min(1, avgConfidence * conflictPenalty + supportBonus))
	}
}
