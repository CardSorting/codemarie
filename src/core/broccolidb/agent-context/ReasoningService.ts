import { GraphService } from "./GraphService.js"
import type { ContradictionReport, KnowledgeBaseItem, Pedigree, ServiceContext } from "./types.js"

/**
 * ReasoningService provides high-level epistemic evaluation, contradiction detection,
 * and structural sovereignty verification for the BroccoliDB graph.
 */
export class ReasoningService {
	constructor(
		private ctx: ServiceContext,
		private graph: GraphService,
	) {}

	async detectContradictions(startIds: string | string[]): Promise<ContradictionReport[]> {
		const ids = Array.isArray(startIds) ? startIds : [startIds]
		const reports: ContradictionReport[] = []

		for (const id of ids) {
			const node = await this.graph.getKnowledge(id)
			if (!node || node.type !== "conclusion") continue

			const edges = node.edges || []
			for (const edge of edges) {
				if (edge.type === "contradicts") {
					reports.push({
						nodeId: id,
						conflictingNodeId: edge.targetId,
						confidence: node.confidence ?? 0.5,
						evidencePath: [id, edge.targetId],
					})
				}
			}
		}
		return reports
	}

	async getNarrativePedigree(nodeId: string): Promise<string> {
		const pedigree = await this.getReasoningPedigree(nodeId)
		if (!pedigree) return "No pedigree found."

		return `
Node: ${nodeId}
Effective Confidence: ${pedigree.effectiveConfidence}
Evidence: ${pedigree.supportingEvidenceIds.join(", ")}
`
	}

	async getReasoningPedigree(nodeId: string, maxDepth = 5): Promise<Pedigree> {
		const node = await this.graph.getKnowledge(nodeId)
		if (!node) throw new Error(`Node ${nodeId} not found`)

		const evidence: string[] = []
		const lineage: Pedigree["lineage"] = [
			{
				nodeId,
				type: node.type,
				content: node.content,
				timestamp: node.createdAt ?? Date.now(),
				confidence: node.confidence ?? 0.5,
			},
		]

		const traverse = async (id: string, depth: number) => {
			if (depth >= maxDepth) return
			const n = await this.graph.getKnowledge(id)
			if (!n) return

			for (const edge of n.edges || []) {
				if (edge.type === "supports") {
					evidence.push(edge.targetId)
					const targetNode = await this.graph.getKnowledge(edge.targetId)
					if (targetNode) {
						lineage.push({
							nodeId: edge.targetId,
							type: targetNode.type,
							content: targetNode.content,
							timestamp: targetNode.createdAt ?? Date.now(),
							confidence: targetNode.confidence ?? 0.5,
						})
						await traverse(edge.targetId, depth + 1)
					}
				}
			}
		}

		await traverse(nodeId, 0)

		return {
			nodeId,
			effectiveConfidence: node.confidence ?? 0.5,
			supportingEvidenceIds: evidence,
			lineage,
		}
	}

	async getLogicalSoundness(nodeIds: string[]): Promise<number> {
		if (nodeIds.length === 0) return 1.0
		let total = 0
		for (const id of nodeIds) {
			const { metrics } = await this.verifySovereignty(id)
			total += (metrics as { confidence: number })?.confidence ?? 0.5
		}
		return total / nodeIds.length
	}

	/**
	 * [Pillar 4] Calculates structural metrics for adaptive calibration.
	 */
	async getGraphMetrics(): Promise<{
		totalNodes: number
		rootNodes: number
		leafNodes: number
		avgConnectivity: number
	}> {
		const nodes = await this.graph.traverseGraph("HEAD", 5)
		if (nodes.length === 0) return { totalNodes: 0, rootNodes: 0, leafNodes: 0, avgConnectivity: 0 }

		let roots = 0
		let leaves = 0
		let totalEdges = 0

		for (const node of nodes) {
			const inbound = (node.inboundEdges || []).length
			const outbound = (node.edges || []).length
			if (inbound === 0) roots++
			if (outbound === 0) leaves++
			totalEdges += outbound
		}

		return {
			totalNodes: nodes.length,
			rootNodes: roots,
			leafNodes: leaves,
			avgConnectivity: totalEdges / nodes.length,
		}
	}

	async autoDiscoverRelationships(_nodeId: string): Promise<{ discovered: number; suggestions: string[] }> {
		return { discovered: 0, suggestions: [] }
	}

	/**
	 * Verifies the epistemic sovereignty of a node.
	 * Incorporates Pillars 1-4:
	 * 1. Commit-Distance Decay
	 * 2. Structural Priors
	 * 3. Evidence Discounting
	 * 4. Adaptive Calibration
	 */
	async verifySovereignty(nodeId: string): Promise<{ isValid: boolean; metrics: Record<string, unknown> | null }> {
		const node = await this.graph.getKnowledge(nodeId)
		if (!node) return { isValid: false, metrics: null }

		const repo = await this.ctx.workspace.getRepo("main")

		const meta = node.metadata as Record<string, unknown> | null
		const commitId = (meta?.commitId as string) || (meta?.nodeId as string)
		const path = (node as KnowledgeBaseItem & { path?: string }).path || (meta?.path as string)

		let commitDistance = 1000
		let churn = 0
		let prior = 0.5

		if (path) prior = await repo.getNodePriors(path)

		if (commitId) {
			commitDistance = await repo.getCommitDistance(commitId)
			if (path) churn = await repo.getFileChurn(path)
		}

		const baseProb = node.confidence ?? prior
		const ageDecay = Math.max(0.1, 1.0 - commitDistance / 100)

		// [Pillar 3] Evidence Discounting
		let discountingFactor = 1.0
		const supports = (node.inboundEdges || []).filter((e) => e.type === "supports")
		const uniqueCommits = new Set<string>()
		if (commitId) uniqueCommits.add(commitId)

		for (const edge of supports) {
			try {
				const evidence = await this.graph.getKnowledge(edge.targetId)
				const evidenceCommit = (evidence.metadata as Record<string, unknown> | null)?.commitId as string
				if (evidenceCommit && evidenceCommit !== commitId) {
					uniqueCommits.add(evidenceCommit)
				} else {
					discountingFactor *= 0.95
				}
			} catch (_e) {
				/* skip */
			}
		}

		const reinforcement = Math.min(0.15, (uniqueCommits.size - 1) * 0.05)

		// [Pillar 4] Adaptive Calibration
		const graphMetrics = await this.getGraphMetrics()
		const adaptiveThreshold = graphMetrics.avgConnectivity > 1.5 ? 0.35 : 0.45

		const finalProb = baseProb * ageDecay * discountingFactor + reinforcement
		const isValid = finalProb > adaptiveThreshold

		const centrality = await this.graph.getNodeCentrality(nodeId)

		return {
			isValid,
			metrics: {
				confidence: finalProb,
				threshold: adaptiveThreshold,
				inbound: centrality.inbound,
				outbound: centrality.outbound,
				totalDegree: centrality.totalDegree,
				commitDistance,
				churn,
				avgConnectivity: graphMetrics.avgConnectivity,
			},
		}
	}

	async selfHealGraph(listAllFn: () => Promise<KnowledgeBaseItem[]>): Promise<{ prunedNodes: string[]; prunedEdges: number }> {
		const allKnowledge = await listAllFn()
		const nodesToPrune: string[] = []
		let edgesPruned = 0

		const repo = await this.ctx.workspace.getRepo("main")

		for (const node of allKnowledge) {
			let shouldPrune = false
			let confidence = node.confidence ?? 0.5

			const meta = node.metadata as Record<string, unknown> | null
			const commitId = (meta?.commitId as string) || (meta?.nodeId as string)
			if (commitId) {
				const distance = await repo.getCommitDistance(commitId)
				if (distance > 50) {
					const decay = 0.98 ** (distance - 50)
					confidence *= decay
				}
			}

			if (confidence < 0.3) shouldPrune = true

			if (shouldPrune) {
				nodesToPrune.push(node.itemId)
				edgesPruned += (node.edges || []).length + (node.inboundEdges || []).length
				await this.graph.deleteKnowledge(node.itemId)
			}
		}

		const conclusions = allKnowledge.filter((n) => n.type === "conclusion")
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

		if (allKnowledge.length > 0) {
			const scores = new Map<string, number>()
			allKnowledge.forEach((k) => {
				scores.set(k.itemId, 1.0 / allKnowledge.length)
			})

			for (let i = 0; i < 3; i++) {
				const nextScores = new Map<string, number>()
				for (const node of allKnowledge) {
					let s = (1 - 0.85) / allKnowledge.length
					const inbound = node.inboundEdges || []
					for (const edge of inbound) {
						s += 0.85 * (scores.get(edge.targetId) || 0) * ((edge.weight ?? 1.0) / 3.0)
					}
					nextScores.set(node.itemId, s)
				}
				nextScores.forEach((score, id) => scores.set(id, score))
			}

			for (const node of allKnowledge) {
				if (!nodesToPrune.includes(node.itemId)) {
					await this.graph.updateKnowledge(node.itemId, {
						hubScore: scores.get(node.itemId) || 0,
					})
				}
			}
		}

		return { prunedNodes: nodesToPrune, prunedEdges: edgesPruned }
	}
}
