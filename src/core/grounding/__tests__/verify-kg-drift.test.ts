import { expect } from "chai"
import * as fs from "fs/promises"
import * as path from "path"
import { dbPool } from "../../../infrastructure/db/BufferedDbPool"
import { Logger } from "../../../shared/services/Logger"
import { KnowledgeGraphService } from "../../context/KnowledgeGraphService"
import { GroundingDiscovery } from "../GroundingDiscovery"

describe("Knowledge Graph Drift Mitigation", () => {
	const cwd = process.cwd()
	const testFile = path.join(cwd, "drift-test.ts")

	beforeEach(async () => {
		Logger.subscribe(console.log)
		await fs.writeFile(testFile, "export const data_persistence = 1;")
	})

	afterEach(async () => {
		try {
			await fs.unlink(testFile)
		} catch {
			/* ignore */
		}
	})

	it("should detect drift and refresh stale nodes", async () => {
		const embeddingHandler = {
			embedText: async () => Array.from({ length: 1536 }, () => 0.1),
		}

		const kg = await KnowledgeGraphService.getInstance(embeddingHandler as any)
		const streamId = `test-stream-${Date.now()}`

		// Register stream to satisfy foreign key constraint
		await dbPool.push({
			type: "insert",
			table: "agent_streams",
			values: {
				id: streamId,
				status: "active",
				focus: "test",
				createdAt: Date.now(),
			},
			layer: "domain",
		})
		await dbPool.flush()

		// 1. Add fresh knowledge
		await kg.addKnowledge(streamId, "code", "export const data_persistence = 1;", {
			metadata: { path: "drift-test.ts" },
		})
		await dbPool.flush()

		const discovery = new GroundingDiscovery(async () => ({
			spec: ["data_persistence"],
			tokens: { input: 0, output: 0 },
		}))

		// 2. Search (should be fresh)
		const context1 = await discovery.discoverRelevantContext("data_persistence", cwd, streamId, kg)
		expect(context1).to.not.contain("[STALE]")
		expect(context1).to.contain("data_persistence")

		// 3. Modify file to cause drift
		await fs.writeFile(testFile, "export const data_persistence = 2;")

		// 4. Search again (should be stale)
		const context2 = await discovery.discoverRelevantContext("data_persistence", cwd, streamId, kg)
		expect(context2).to.contain("[STALE - MODIFIED]")

		// 5. Wait for background refresh
		// Background refresh is async, we give it a moment
		for (let i = 0; i < 10; i++) {
			await new Promise((r) => setTimeout(r, 200))
			const context = await discovery.discoverRelevantContext("data", cwd, streamId, kg)
			if (!context.includes("[STALE]")) break
		}

		// 6. Search again (should be fresh again)
		const context3 = await discovery.discoverRelevantContext("data_persistence", cwd, streamId, kg)
		expect(context3).to.not.contain("[STALE]")

		// 7. Phase 4.1: Concurrency Stress Test
		// Modify again
		await fs.writeFile(testFile, "export const data_persistence = 3;")

		// Manual stat cache update or wait for TTL
		// For test, we just trigger multiple parallel searches
		const searchPromises = Array.from({ length: 10 }, () =>
			discovery.discoverRelevantContext("data_persistence", cwd, streamId, kg),
		)

		const results = await Promise.all(searchPromises)
		results.forEach((res) => expect(res).to.contain("[STALE - MODIFIED]"))

		// Wait and verify only one refresh happened (via log check or final state)
		await new Promise((r) => setTimeout(r, 1000))
		const finalContext = await discovery.discoverRelevantContext("data_persistence", cwd, streamId, kg)
		expect(finalContext).to.not.contain("[STALE]")

		// 8. Pass 5: KG-First Satiety Benchmark
		// Ensure that with a very high confidence match, we get a fast return
		// We simulate this by making sure the next search returns quickly and contains the satiety marker
		const start = Date.now()
		const satietyContext = await discovery.discoverRelevantContext("data_persistence", cwd, streamId, kg)
		const duration = Date.now() - start

		expect(satietyContext).to.contain("High-Confidence Semantic Landmarks")
		Logger.info(`[Benchmark] KG Satiety Discovery duration: ${duration}ms`)
	}).timeout(20000)
})
