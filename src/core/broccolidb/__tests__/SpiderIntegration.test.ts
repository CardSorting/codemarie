import * as fs from "fs"
import should from "should"
import { BufferedDbPool } from "../../../infrastructure/db/BufferedDbPool.js"
import { setDbPath } from "../../../infrastructure/db/Config.js"
import { AgentContext } from "../agent-context.js"
import { Repository } from "../repository.js"
import { Workspace } from "../workspace.js"

describe("BroccoliDB-Spider Integration", () => {
	let db: BufferedDbPool
	let workspace: Workspace
	let context: AgentContext
	let repo: Repository
	const dbPath = "/tmp/spider-integration.db"

	before(async () => {
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		setDbPath(dbPath)
		db = new BufferedDbPool()
		workspace = new Workspace(db, "test-user", "test-ws")
		await workspace.init()

		context = new AgentContext(db, workspace, "test-user", { agentId: "test-agent", name: "Test Agent" } as any)

		repo = await workspace.createRepo("test-repo")
		repo.agentContext = context
	})

	after(async () => {
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
	})

	it("should enrich commit metadata with structural entropy", async () => {
		// Create files to establish a structure
		await repo.files().writeFile("main", "src/utils.ts", "export const foo = 1", "agent-1")
		await repo.files().writeFile("main", "src/main.ts", 'import { foo } from "./utils.js"', "agent-1")

		const head = await repo.resolveRef("main")
		const node = await repo.getNode(head)

		const metadata = node.metadata as { spider_entropy?: number; spider_violations?: unknown[] }
		should.exist(metadata?.spider_entropy)
		if (typeof metadata.spider_entropy === "number") {
			metadata.spider_entropy.should.be.a.Number()
		}
		should.exist(metadata?.spider_violations)
		Array.isArray(metadata.spider_violations).should.be.true()
	})

	it("should persist structural graphs to knowledge base", async () => {
		// Create a violation or enough complexity to trigger persistence
		await repo.files().writeFile("main", "src/domain/repo.ts", "export const repo = 1", "agent-1")
		await repo.files().writeFile("main", "src/plumbing/db.ts", 'import { repo } from "../domain/repo.js"', "agent-1")

		const head = await repo.resolveRef("main")
		const node = await repo.getNode(head)

		const metadata = node.metadata as { spider_graph_kb?: string }
		should.exist(metadata?.spider_graph_kb)

		// Wait for knowledge to appear (handles buffering/async)
		let kb: any = null
		for (let attempt = 0; attempt < 10; attempt++) {
			try {
				kb = await context.getKnowledge(metadata.spider_graph_kb as string)
				if (kb) break
			} catch (_e) {
				await new Promise((r) => setTimeout(r, 100))
				await db.flush()
			}
		}

		should.exist(kb)
		kb.type.should.equal("structural_snapshot")
		kb.content.should.containEql("graph TD")
	})
})
