import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { performance } from "node:perf_hooks"
// @ts-expect-error
import { AgentContext } from "../src/core/broccolidb/agent-context"
// @ts-expect-error
import { Workspace } from "../src/core/broccolidb/workspace"
// @ts-expect-error
import { BufferedDbPool } from "../src/infrastructure/db/BufferedDbPool"
// @ts-expect-error
import { setDbPath } from "../src/infrastructure/db/Config"

const DB_PATH = path.resolve(process.cwd(), "benchmark_tmp.db")

// Mock AiService for benchmarking search without API calls
class MockAiService {
	isAvailable() {
		return true
	}
	async embedText(text: string): Promise<number[]> {
		const hash = crypto.createHash("sha256").update(text).digest()
		const vec: number[] = []
		for (let i = 0; i < 768; i++) {
			vec.push((hash[i % 32]! / 255) * 2 - 1)
		}
		return vec
	}
	async embedBatch(texts: string[]): Promise<number[][]> {
		return Promise.all(texts.map((t) => this.embedText(t)))
	}
	getDimensions() {
		return 768
	}
}

async function runBenchmark() {
	console.log("🚀 Starting Internal Performance Benchmark...")

	if (fs.existsSync(DB_PATH)) {
		try {
			fs.unlinkSync(DB_PATH)
			fs.unlinkSync(`${DB_PATH}-wal`)
			fs.unlinkSync(`${DB_PATH}-shm`)
		} catch (e) {}
	}
	setDbPath(DB_PATH)

	const pool = new BufferedDbPool()
	const workspace = new Workspace("bench-user", "bench-ws", "/tmp/bench-repo")
	// @ts-expect-error
	workspace.getDb = () => pool
	const aiService = new MockAiService()
	const context = new AgentContext(workspace, 0, aiService as any)

	const iterations = 2000

	// 1. Benchmark BufferedDbPool Throughput
	console.log("\n📊 [BufferedDbPool] Throughput Test...")

	const startTimePush = performance.now()
	for (let i = 0; i < iterations; i++) {
		await pool.push(
			{
				type: "insert",
				table: "audit_events",
				values: {
					id: crypto.randomUUID(),
					userId: "bench-user",
					type: "bench_op",
					data: "some_data",
					createdAt: Date.now(),
				},
				layer: "plumbing",
			},
			"agent-1",
		)
	}
	await pool.flush()
	const durationPush = performance.now() - startTimePush
	console.log(
		`✅ Individual Push: ${iterations} operations in ${durationPush.toFixed(2)}ms (${((iterations / durationPush) * 1000).toFixed(2)} ops/s)`,
	)

	const startTimeBatch = performance.now()
	const batchSize = 100
	for (let i = 0; i < iterations; i += batchSize) {
		const ops = Array.from({ length: batchSize }, () => ({
			type: "insert",
			table: "audit_events",
			values: {
				id: crypto.randomUUID(),
				userId: "bench-user",
				type: "bench_batch_op",
				data: "some_data",
				createdAt: Date.now(),
			},
			layer: "plumbing",
		}))
		// @ts-expect-error
		await pool.pushBatch(ops, "agent-2")
	}
	await pool.flush()
	const durationBatch = performance.now() - startTimeBatch
	console.log(
		`✅ Batch Push (size ${batchSize}): ${iterations} operations in ${durationBatch.toFixed(2)}ms (${((iterations / durationBatch) * 1000).toFixed(2)} ops/s)`,
	)

	// 2. Benchmark AgentContext Search Latency
	console.log("\n🔍 [AgentContext] Search Latency Test...")

	// Seed knowledge
	const seedCount = 500
	console.log(`Seeding ${seedCount} items into Knowledge Base...`)
	for (let i = 0; i < seedCount; i++) {
		const content = `Knowledge item number ${i}. This contains info about ${i % 10 === 0 ? "critical subjects" : "routine tasks"}.`
		await context.addKnowledge(`kb-${i}`, "fact", content, { importance: i })
	}
	await context.flush()

	const searchIterations = 100
	const startTimeSearchVec = performance.now()
	for (let i = 0; i < searchIterations; i++) {
		await context.searchKnowledge("critical subjects", undefined, 5)
	}
	const durationSearchVec = performance.now() - startTimeSearchVec
	console.log(
		`✅ Vector Search (Mocked): ${searchIterations} queries in ${durationSearchVec.toFixed(2)}ms (${(durationSearchVec / searchIterations).toFixed(2)} ms/query)`,
	)

	const startTimeSearchText = performance.now()
	// Disable AI service to force keyword search fallback
	// @ts-expect-error
	const originalAi = context.aiService
	// @ts-expect-error
	context.aiService = null
	for (let i = 0; i < searchIterations; i++) {
		await context.searchKnowledge("routine tasks", undefined, 5)
	}
	const durationSearchText = performance.now() - startTimeSearchText
	console.log(
		`✅ Keyword Search Fallback: ${searchIterations} queries in ${durationSearchText.toFixed(2)}ms (${(durationSearchText / searchIterations).toFixed(2)} ms/query)`,
	)
	// @ts-expect-error
	context.aiService = originalAi

	// 3. Benchmark Priority Layer Flushing
	console.log("\n⚖️ [BufferedDbPool] Priority Layer Test...")
	const startTimePriority = performance.now()
	// Push a mix of high and low priority ops
	for (let i = 0; i < 500; i++) {
		const layer: any = i % 2 === 0 ? "plumbing" : "domain"
		await pool.push({
			type: "insert",
			table: "audit_events",
			values: {
				id: crypto.randomUUID(),
				userId: "bench-user",
				type: `priority_${layer}`,
				data: "test",
				createdAt: Date.now(),
			},
			layer,
		})
	}
	await pool.flush()
	const durationPriority = performance.now() - startTimePriority
	console.log(`✅ Mixed Priority Flush: 500 operations in ${durationPriority.toFixed(2)}ms`)

	console.log("\n🏁 Benchmark Complete.")

	// Cleanup
	await pool.stop()
	if (fs.existsSync(DB_PATH)) {
		try {
			fs.unlinkSync(DB_PATH)
			fs.unlinkSync(`${DB_PATH}-wal`)
			fs.unlinkSync(`${DB_PATH}-shm`)
		} catch (e) {}
	}
}

runBenchmark().catch((err) => {
	console.error("❌ Benchmark failed:", err)
	process.exit(1)
})
