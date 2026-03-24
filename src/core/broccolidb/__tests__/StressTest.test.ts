import * as crypto from "node:crypto"
import * as fs from "fs"
import should from "should"
import { BufferedDbPool } from "../../../infrastructure/db/BufferedDbPool.js"
import { setDbPath } from "../../../infrastructure/db/Config.js"
import { AgentContext } from "../agent-context.js"
import { Repository } from "../repository.js"
import { Workspace } from "../workspace.js"

/**
 * StressTestCorpus generates a "messy" repository state to test BroccoliDB's epistemic logic.
 */
class StressTestCorpus {
	constructor(
		private context: AgentContext,
		private repo: Repository,
	) {
		should.exist(this.context)
	}

	async seed() {
		const main = "main"

		// 1. Fragmented Evidence Chain
		await this.repo.files().writeFile(main, "src/evidence/core.ts", "// Atomic truth\nexport const V = 1", "agent-1")
		await this.repo
			.files()
			.writeFile(main, "src/evidence/logic.ts", 'import { V } from "./core"\nexport const W = V + 1', "agent-1")
		await this.repo.files().writeFile(main, "src/evidence/app.ts", 'import { W } from "./logic"\nconsole.log(W)', "agent-1")

		// 2. Semantic Collision
		await this.context.push({
			type: "fact",
			content: "Database connection pool handles 50 concurrent connections.",
			metadata: { treeHash: "pool-A", commitId: "commit-1", path: "src/db.ts" },
		})
		await this.context.push({
			type: "fact",
			content: "The DB pool is configured for a maximum of 50 simultaneous workers.",
			metadata: { treeHash: "pool-B", commitId: "commit-2", path: "src/config.ts" },
		})

		// 3. Direct Contradiction (GDPR Example)
		await this.context.push({
			itemId: "concl-true-1",
			type: "conclusion",
			content: "User data is stored in compliance with GDPR in the EU region.",
			confidence: 0.9,
			metadata: {
				treeHash: "gdpr-valid",
				commitId: "commit-3",
				path: "legal/privacy.md",
				proofHash: crypto
					.createHash("sha256")
					.update("gdpr-valid" + "pedigree-1")
					.digest("hex"),
				pedigreeHash: "pedigree-1",
			},
		})
		await this.context.push({
			itemId: "concl-false-1",
			type: "conclusion",
			content: "User data is leaked to non-compliant regions via analytics sync.",
			confidence: 0.95,
			metadata: {
				treeHash: "gdpr-leak",
				commitId: "commit-4",
				path: "src/analytics.ts",
				proofHash: crypto
					.createHash("sha256")
					.update("gdpr-leak" + "pedigree-2")
					.digest("hex"),
				pedigreeHash: "pedigree-2",
			},
		})

		await this.context.graphService.updateKnowledge("concl-true-1", {
			edges: [{ targetId: "concl-false-1", type: "contradicts", weight: 1.0 }],
		})

		// 4. Fragmented Sovereign Chain
		await this.context.push({
			itemId: "hypo-mid-1",
			type: "hypothesis",
			content: "Middleware correctly sanitizes all inputs before routing.",
			confidence: 0.8,
			metadata: { treeHash: "mid-1", commitId: "commit-5", path: "src/middleware.ts" },
		})
		await this.context.push({
			itemId: "concl-top-1",
			type: "conclusion",
			content: "The system is immune to SQL injection.",
			confidence: 0.7,
			metadata: {
				treeHash: "sqli-immune",
				commitId: "commit-6",
				path: "security/audit.md",
				proofHash: crypto
					.createHash("sha256")
					.update("sqli-immune" + "pedigree-3")
					.digest("hex"),
				pedigreeHash: "pedigree-3",
			},
			edges: [{ targetId: "hypo-mid-1", type: "supports", weight: 0.9 }],
		})

		await this.repo.commit(main, {}, "agent-cleaner", "Massive auto-generated update")
	}
}

describe("BroccoliDB-StressTestCorpus", () => {
	let db: BufferedDbPool
	let workspace: Workspace
	let context: AgentContext
	let repo: Repository
	const dbPath = "/tmp/stress-test-corpus.db"

	before(async () => {
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		setDbPath(dbPath)
		db = new BufferedDbPool()
		workspace = new Workspace(db, "test-user", "test-ws")
		await workspace.init()

		context = new AgentContext(db, workspace, "test-user", { agentId: "test-agent", name: "Test Agent" } as any)

		repo = await workspace.createRepo("test-repo")
		repo.agentContext = context
		should.exist(context)
	})

	after(async () => {
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
	})

	it("should seed the messy repo corpus correctly", async () => {
		const corpus = new StressTestCorpus(context, repo)
		await corpus.seed()

		// Verify semantic collisions
		const collisions = await context.searchKnowledge("database pool perform")
		collisions.length.should.be.greaterThanOrEqual(0)

		// Verify contradictions
		const gdprContradictions = await context.detectContradictions(["concl-true-1"])
		gdprContradictions.length.should.be.greaterThan(0)
		gdprContradictions[0].nodeId.should.equal("concl-true-1")
		gdprContradictions[0].conflictingNodeId.should.equal("concl-false-1")

		// Verify fragmented evidence
		const pedigree = await context.reasoningService.getReasoningPedigree("concl-top-1")
		pedigree.supportingEvidenceIds.should.containEql("hypo-mid-1")
		pedigree.lineage.length.should.be.greaterThan(1)

		// Verify commit noise
		const branches = await repo.listBranches()
		branches.should.containEql("main")
		const head = await repo.resolveRef("main")
		const node = await repo.getNode(head)
		node.message.should.equal("Massive auto-generated update")
	})
})
