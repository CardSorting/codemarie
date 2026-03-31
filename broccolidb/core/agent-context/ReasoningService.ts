import type { GraphService } from './GraphService.js';
import type { ContradictionReport, KnowledgeBaseItem, Pedigree, ServiceContext } from './types.js';

/**
 * ReasoningService provides high-level epistemic evaluation, contradiction detection,
 * and structural sovereignty verification for the BroccoliDB graph.
 */
export class ReasoningService {
  constructor(
    private ctx: ServiceContext,
    private graph: GraphService
  ) {}

  /**
   * Detects logical contradictions within the neighborhood of a set of nodes.
   */
  async detectContradictions(
    startIds: string | string[],
    depth = 3
  ): Promise<ContradictionReport[]> {
    const ids = Array.isArray(startIds) ? startIds : [startIds];
    const reports: ContradictionReport[] = [];
    const visited = new Set<string>();

    for (const startId of ids) {
      const neighborhood = await this.graph.traverseGraph(startId, depth, { direction: 'both' });
      for (const node of neighborhood) {
        if (visited.has(node.itemId)) continue;
        visited.add(node.itemId);

        const contradictions = (node.edges || []).filter((e) => e.type === 'contradicts');
        for (const edge of contradictions) {
          reports.push({
            nodeId: node.itemId,
            conflictingNodeId: edge.targetId,
            confidence: node.confidence ?? 0.5,
            evidencePath: [node.itemId, edge.targetId],
          });
        }
      }
    }
    return reports;
  }

  /**
   * Returns the reasoning lineage (pedigree) for a given node.
   */
  async getReasoningPedigree(nodeId: string, maxDepth = 5): Promise<Pedigree> {
    const node = await this.graph.getKnowledge(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const evidence: string[] = [];
    const lineage: Pedigree['lineage'] = [
      {
        nodeId,
        type: node.type,
        content: node.content,
        timestamp: node.createdAt ?? Date.now(),
        confidence: node.confidence ?? 0.5,
      },
    ];

    const traverse = async (id: string, depth: number) => {
      if (depth >= maxDepth) return;
      const n = await this.graph.getKnowledge(id);

      for (const edge of n.edges || []) {
        if (edge.type === 'supports') {
          evidence.push(edge.targetId);
          const targetNode = await this.graph.getKnowledge(edge.targetId);
          if (targetNode) {
            lineage.push({
              nodeId: targetNode.itemId,
              type: targetNode.type,
              content: targetNode.content,
              timestamp: targetNode.createdAt ?? Date.now(),
              confidence: targetNode.confidence ?? 0.5,
            });
            await traverse(edge.targetId, depth + 1);
          }
        }
      }
    };

    await traverse(nodeId, 0);

    return {
      nodeId,
      effectiveConfidence: node.confidence ?? 0.5,
      supportingEvidenceIds: evidence,
      lineage,
    };
  }

  /**
   * Returns a natural language narrative explaining the reasoning chain.
   */
  async getNarrativePedigree(nodeId: string): Promise<string> {
    if (!this.ctx.aiService?.isAvailable())
      return 'AI Service unavailable for narrative generation.';
    const pedigree = await this.getReasoningPedigree(nodeId);
    const item = await this.graph.getKnowledge(nodeId);

    return this.ctx.aiService.explainReasoningChain(
      item.content,
      pedigree.lineage.map((l) => ({
        content: l.content,
        type: l.type,
      }))
    );
  }

  /**
   * [Pillar 4] Calculates structural metrics for adaptive calibration.
   */
  async getGraphMetrics(): Promise<{
    totalNodes: number;
    rootNodes: number;
    leafNodes: number;
    avgConnectivity: number;
  }> {
    const nodes = await this.graph.traverseGraph('HEAD', 5);
    if (nodes.length === 0)
      return { totalNodes: 0, rootNodes: 0, leafNodes: 0, avgConnectivity: 0 };

    let roots = 0;
    let leaves = 0;
    let totalEdges = 0;

    for (const node of nodes) {
      if ((node.inboundEdges || []).length === 0) roots++;
      if ((node.edges || []).length === 0) leaves++;
      totalEdges += (node.edges || []).length;
    }

    return {
      totalNodes: nodes.length,
      rootNodes: roots,
      leafNodes: leaves,
      avgConnectivity: totalEdges / nodes.length,
    };
  }

  /**
   * [Pillar 1, 2, 3, 4] Verifies the structural and epistemic sovereignty of a node.
   * Incorporates git signals, evidence discounting, and adaptive calibration.
   */
  async verifySovereignty(
    nodeId: string
  ): Promise<{ isValid: boolean; metrics: Record<string, unknown> | null }> {
    const node = await this.graph.getKnowledge(nodeId).catch(() => null);
    if (!node) return { isValid: false, metrics: null };

    const repo = await this.ctx.workspace.getRepo('main');

    const meta = node.metadata as Record<string, unknown> | null;
    const commitId = (meta?.commitId as string) || (meta?.nodeId as string);
    const path = (node as unknown as { path?: string }).path || (meta?.path as string);

    let commitDistance = 1000;
    let churn = 0;
    let prior = 0.5;

    if (repo && commitId) {
      commitDistance = await repo.getCommitDistance(commitId);
      if (path) {
        churn = await repo.getFileChurn(path);
        prior = await repo.getNodePriors(path);
      }
    }

    const baseProb = node.confidence ?? prior;
    const ageDecay = Math.max(0.1, 1.0 - commitDistance / 100);

    // [Pillar 3] Evidence Discounting
    let discountingFactor = 1.0;
    const supports = (node.inboundEdges || []).filter((e) => e.type === 'supports');
    const uniqueCommits = new Set<string>();

    for (const edge of supports) {
      try {
        const evidence = await this.graph.getKnowledge(edge.targetId);
        const evMeta = evidence.metadata as Record<string, unknown> | null;
        const evCommit = (evMeta?.commitId as string) || (evMeta?.nodeId as string);

        if (evCommit && evCommit !== commitId) {
          uniqueCommits.add(evCommit);
        } else {
          discountingFactor *= 0.95;
        }
    } catch {
      // Ignore
    }
    }

    const reinforcement = Math.min(0.15, (uniqueCommits.size - 1) * 0.05);

    // [Pillar 4] Adaptive Calibration
    const graphMetrics = await this.getGraphMetrics();
    const adaptiveThreshold = graphMetrics.avgConnectivity > 1.5 ? 0.35 : 0.45;

    const finalProb = baseProb * ageDecay * discountingFactor + reinforcement;
    const isValid = finalProb > adaptiveThreshold;

    const centrality = await this.graph.getNodeCentrality(nodeId);

    return {
      isValid,
      metrics: {
        finalProb,
        baseProb,
        ageDecay,
        discountingFactor,
        reinforcement,
        adaptiveThreshold,
        totalDegree: centrality.totalDegree,
        commitDistance,
        churn,
        avgConnectivity: graphMetrics.avgConnectivity,
      },
    };
  }

  async selfHealGraph(
    listAllFn: () => Promise<KnowledgeBaseItem[]>
  ): Promise<{ prunedNodes: string[]; prunedEdges: number }> {
    const allKnowledge = await listAllFn();
    const nodesToPrune: string[] = [];
    const edgesPruned = 0;

    // Simple HITS-like importance (Hubs/Authorities)
    const scores = new Map<string, number>();
    for (const node of allKnowledge) scores.set(node.itemId, 1.0 / allKnowledge.length);

    for (let i = 0; i < 3; i++) {
      const nextScores = new Map<string, number>();
      for (const node of allKnowledge) {
        let s = (1 - 0.85) / allKnowledge.length;
        const inbound = node.inboundEdges || [];
        for (const edge of inbound) {
          s += 0.85 * (scores.get(edge.targetId) || 0) * ((edge.weight ?? 1.0) / 3.0);
        }
        nextScores.set(node.itemId, s);
      }
      for (const [id, score] of nextScores) {
        scores.set(id, score);
      }
    }

    for (const node of allKnowledge) {
      if (!nodesToPrune.includes(node.itemId)) {
        await this.graph.updateKnowledge(node.itemId, {
          hubScore: scores.get(node.itemId) || 0,
        });
      }
    }

    return { prunedNodes: nodesToPrune, prunedEdges: edgesPruned };
  }

  /**
   * Automatically discovers and adds relationships for a node based on semantic similarity.
   */
  async autoDiscoverRelationships(
    nodeId: string,
    limit = 5
  ): Promise<{ discovered: number; suggestions: string[] }> {
    const item = await this.graph.getKnowledge(nodeId);
    if (!this.ctx.aiService?.isAvailable()) return { discovered: 0, suggestions: [] };

    // Search for semantically similar nodes
    const candidates = await this.ctx.searchKnowledge(item.content, undefined, limit + 5);
    const existingEdgeTargets = new Set((item.edges || []).map((e) => e.targetId));

    let discoveredCount = 0;
    const suggestions: string[] = [];

    for (const candidate of candidates) {
      if (candidate.itemId === nodeId || existingEdgeTargets.has(candidate.itemId)) continue;
      if (discoveredCount >= limit) break;

      const relationship = await this.ctx.aiService.evaluateLogicRelationship(
        item.content,
        candidate.content
      );
      if (relationship !== 'neutral') {
        await this.graph.updateKnowledge(nodeId, {
          edges: [
            ...(item.edges || []),
            { targetId: candidate.itemId, type: relationship, weight: 0.8 },
          ],
        });
        discoveredCount++;
        suggestions.push(`Automated Link: ${nodeId} -> ${candidate.itemId} (${relationship})`);
      }
    }

    return { discovered: discoveredCount, suggestions };
  }

  /**
   * Calculates a heuristic 'Soundness Score' for a set of nodes.
   */
  async getLogicalSoundness(nodeIds: string[]): Promise<number> {
    if (nodeIds.length === 0) return 1.0;

    let totalConfidence = 0;
    let contradictionCount = 0;
    let supportCount = 0;

    const items = await this.graph.getKnowledgeBatch(nodeIds);
    if (items.length === 0) return 1.0;

    for (const item of items) {
      totalConfidence += item.confidence;
      contradictionCount += (item.edges || []).filter((e) => e.type === 'contradicts').length;
      supportCount += (item.edges || []).filter(
        (e) => e.type === 'supports' || e.type === 'depends_on'
      ).length;
    }

    const avgConfidence = totalConfidence / items.length;
    const conflictPenalty = Math.max(0, 1 - contradictionCount * 0.2);
    const supportBonus = Math.min(0.2, supportCount * 0.05);

    return Math.max(0, Math.min(1, avgConfidence * conflictPenalty + supportBonus));
  }
}
