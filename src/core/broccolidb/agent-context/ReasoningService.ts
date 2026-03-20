import * as crypto from "node:crypto"
import { Logger } from "@/shared/services/Logger"
import { GraphService } from "./GraphService"
import type { ContradictionReport, KnowledgeBaseItem, Pedigree, ServiceContext } from "./types"

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
				for (const node of neighborhood) {
					if (visitedNodesInNeighborhood.has(node.itemId)) continue
					visitedNodesInNeighborhood.add(node.itemId)

					const contradictions = node.edges.filter((e) => e.type === "contradicts")
					for (const edge of contradictions) {
						try {
							const conflictingNode = await this.graph.getKnowledge(edge.targetId)
							if (node.confidence > 0.7 && conflictingNode.confidence > 0.7) {
								reports.push({
									nodeId: node.itemId,
									conflictingNodeId: conflictingNode.itemId,
									confidence: (node.confidence + conflictingNode.confidence) / 2,
									evidencePath: [node.itemId, conflictingNode.itemId],
								})
							}
						} catch (_e) {
							/* ignore missing */
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
			const nextLevel: KnowledgeBaseItem[] = []
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
					const targetId = edge.targetId
					supportingIds.push(targetId)
					try {
						const target = await this.graph.getKnowledge(targetId)
						effectiveConfidence *= target.confidence
						nextLevel.push(target)
					} catch (_e) {
						/* skip */
					}
				}
			}
			if (nextLevel.length === 0) break
			currentNodes = nextLevel
		}

		return {
			nodeId,
			effectiveConfidence: Math.max(0, Math.min(1, effectiveConfidence)),
			lineage,
			supportingEvidenceIds: Array.from(new Set(supportingIds)),
		}
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

	async verifySovereignty(nodeId: string): Promise<{ isValid: boolean; chain: string[]; brokenNode?: string }> {
		const visited = new Set<string>()
		const stack = [nodeId]
		const chain: string[] = []

		while (stack.length > 0) {
			const currentId = stack.pop()!
			if (visited.has(currentId)) continue
			visited.add(currentId)
			chain.push(currentId)

			const node = await this.graph.getKnowledge(currentId)

			if (node.type === "conclusion") {
				const metadata = node.metadata || {}
				const proofHash = metadata.proofHash
				if (!proofHash) return { isValid: false, chain, brokenNode: currentId }

				const treeHash = metadata.treeHash || ""
				const pedigreeHash = metadata.pedigreeHash || ""
				const expectedHash = crypto
					.createHash("sha256")
					.update(treeHash + pedigreeHash)
					.digest("hex")

				if (proofHash !== expectedHash) {
					return { isValid: false, chain, brokenNode: currentId }
				}
			}

			const evidenceEdges = (node.inboundEdges || []).filter((e) => e.type === "supports" || e.type === "depends_on")
			for (const edge of evidenceEdges) {
				stack.push(edge.targetId)
			}
		}

		return { isValid: true, chain }
	}

	async selfHealGraph(listAllFn: () => Promise<KnowledgeBaseItem[]>): Promise<{ prunedNodes: string[]; prunedEdges: number }> {
		const allKnowledge = await listAllFn()
		const nodesToPrune: string[] = []
		let edgesPruned = 0

		// Soundness Decay: Natural expiration of older reasoning to prioritize 'fresh' context
		const DECAY_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7 // 1 week
		const now = Date.now()

		for (const node of allKnowledge) {
			let shouldPrune = false
			let confidence = node.confidence

			// Apply decay to old nodes
			if (now - node.createdAt > DECAY_THRESHOLD_MS) {
				confidence *= 0.95 // 5% decay per check cycle after threshold
			}

			if (confidence < 0.2) shouldPrune = true

			const contradictions = node.inboundEdges.filter((e) => e.type === "contradicts")
			if (contradictions.length > 3) shouldPrune = true

			if (node.type === "conclusion") {
				const { isValid } = await this.verifySovereignty(node.itemId)
				if (!isValid) shouldPrune = true
			}

			if (shouldPrune) {
				nodesToPrune.push(node.itemId)
				edgesPruned += node.edges.length + node.inboundEdges.length
				await this.graph.deleteKnowledge(node.itemId)
			} else if (confidence !== node.confidence) {
				// Update decayed confidence
				await this.graph.updateKnowledge(node.itemId, { confidence })
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
