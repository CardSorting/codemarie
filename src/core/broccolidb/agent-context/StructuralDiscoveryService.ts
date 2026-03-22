import * as path from "path"
import type { SpiderEngine } from "../../policy/SpiderEngine.js"

export interface BlastRadius {
	affectedNodes: string[]
	centralityScore: number
	criticalDependents: string[]
}

/**
 * StructuralDiscoveryService: Provides high-level architectural insights
 * based on the Spider structural graph.
 */
export class StructuralDiscoveryService {
	private cache: Map<string, BlastRadius> = new Map()

	constructor(private getEngine: () => SpiderEngine) {}

	/**
	 * Clears the analysis cache.
	 */
	public clearCache() {
		this.cache.clear()
	}

	/**
	 * Identifies all nodes that depend (directly or indirectly) on the given file.
	 */
	public getBlastRadius(filePath: string): BlastRadius {
		const engine = this.getEngine()
		const absolutePath = path.resolve(engine.cwd, filePath)
		const relativePath = path.relative(engine.cwd, absolutePath).replace(/\\/g, "/")

		const cached = this.cache.get(relativePath)
		if (cached) {
			return cached
		}

		const targetNode =
			engine.nodes.get(relativePath) || engine.nodes.get(`${relativePath}.ts`) || engine.nodes.get(`${relativePath}.tsx`)
		if (!targetNode) {
			return { affectedNodes: [], centralityScore: 0, criticalDependents: [] }
		}

		const dependents: Set<string> = new Set()

		// Map of target -> sources (inverse of imports)
		const inverseGraph: Map<string, string[]> = new Map()
		for (const node of engine.nodes.values()) {
			for (const imp of node.imports) {
				const resolved = engine.resolveImportToNodeId(node.id, imp)
				if (resolved) {
					const existing = inverseGraph.get(resolved) || []
					existing.push(node.id)
					inverseGraph.set(resolved, existing)
				}
			}
		}

		const visited = new Set<string>()
		const toVisit = [targetNode.id]
		while (toVisit.length > 0) {
			const current = toVisit.pop()
			if (!current || visited.has(current)) continue
			visited.add(current)

			const sources = inverseGraph.get(current) || []
			for (const s of sources) {
				dependents.add(s)
				toVisit.push(s)
			}
		}

		const affectedNodes = Array.from(dependents)
		const criticalDependents = affectedNodes.filter((id) => {
			const n = engine.nodes.get(id)
			return n && (n.layer === "core" || n.layer === "ui")
		})

		const result = {
			affectedNodes,
			centralityScore: affectedNodes.length / Math.max(1, engine.nodes.size),
			criticalDependents,
		}

		this.cache.set(relativePath, result)
		return result
	}

	/**
	 * Summarizes the architectural importance of a file.
	 */
	public getImportanceSummary(filePath: string): string {
		const radius = this.getBlastRadius(filePath)
		if (radius.centralityScore > 0.2) {
			return `🔥 CRITICAL COMPONENT: This file is a central hub. ${radius.affectedNodes.length} other components depend on it. Changes here have a HIGH BLAST RADIUS.`
		}
		if (radius.affectedNodes.length > 0) {
			return `📍 MODERATE IMPORTANCE: ${radius.affectedNodes.length} components depend on this file.`
		}
		return `🍃 PERIPHERAL: No incoming dependencies detected. Low risk for side effects.`
	}
}
