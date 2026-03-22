import { Logger } from "@/shared/services/Logger"
import { SpiderEngine, SpiderViolation } from "../../policy/SpiderEngine.js"
import { Repository } from "../repository.js"
import { StructuralDiscoveryService } from "./StructuralDiscoveryService.js"
import type { ServiceContext } from "./types.js"

export class SpiderService {
	private engine: SpiderEngine
	private discovery: StructuralDiscoveryService

	constructor(private ctx: ServiceContext) {
		this.engine = new SpiderEngine(ctx.workspace.workspacePath)
		this.discovery = new StructuralDiscoveryService(() => this.engine)
	}

	/**
	 * Runs a full structural audit on the given files.
	 * Returns entropy score and any critical violations.
	 */
	async auditStructure(files: { filePath: string; content: string }[]): Promise<{
		entropy: number
		violations: SpiderViolation[]
		mermaid: string
	}> {
		try {
			this.discovery.clearCache()
			this.engine.buildGraph(files)
			const entropyReport = this.engine.computeEntropy()
			const entropy = entropyReport.score
			const violations = this.engine.getViolations()
			const mermaid = this.engine.toMermaid()

			return { entropy, violations, mermaid }
		} catch (e) {
			Logger.error("[SpiderService] Audit failed:", e)
			return { entropy: 1.0, violations: [], mermaid: "" }
		}
	}

	/**
	 * Bootstraps the structural graph from the latest repository head.
	 */
	async bootstrapGraph(): Promise<void> {
		try {
			const repoPath = this.ctx.workspace.workspacePath
			const db = this.ctx.workspace.getDb()

			// Get default branch or main
			const repoDoc = await db.selectOne("repositories", [{ column: "repoPath", value: repoPath }])
			const branchName = repoDoc?.defaultBranch || "main"

			const repo = new Repository(db, repoPath)
			const files = await repo.files().listFiles(branchName)

			const auditFiles: { filePath: string; content: string }[] = []
			for (const f of files) {
				try {
					const content = await repo.files().readFile(branchName, f.path, { skipIgnore: true })
					auditFiles.push({ filePath: f.path, content: content.content })
				} catch {
					/* skip */
				}
			}

			this.discovery.clearCache()
			this.engine.buildGraph(auditFiles)
			Logger.info(`[SpiderService] Graph bootstrapped with ${auditFiles.length} files on branch ${branchName}.`)
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e)
			Logger.error(`[SpiderService] Bootstrap failed: ${msg}`)
		}
	}

	/**
	 * Returns the internal engine instance for advanced analysis.
	 */
	getEngine(): SpiderEngine {
		return this.engine
	}

	/**
	 * Returns the discovery service instance.
	 */
	getDiscovery(): StructuralDiscoveryService {
		return this.discovery
	}

	/**
	 * Persists structural health as knowledge in the graph.
	 */
	async persistStructuralKnowledge(entropy: number, mermaid: string, metadata?: Record<string, unknown>): Promise<string> {
		const kbId = `spider-snapshot-${Date.now()}`
		await this.ctx.push({
			type: "insert",
			table: "knowledge",
			values: {
				id: kbId,
				userId: this.ctx.userId,
				type: "structural_snapshot",
				content: mermaid,
				tags: JSON.stringify(["spider", "architecture", "visualization"]),
				confidence: Math.max(0, 1.0 - entropy),
				hubScore: 0,
				metadata: JSON.stringify({ ...metadata, entropy }),
				createdAt: Date.now(),
			},
			layer: "domain",
		})
		return kbId
	}
}
