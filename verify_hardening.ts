import * as assert from "assert"
import * as os from "os"
import * as path from "path"
import { FluidPolicyEngine } from "./src/core/policy/FluidPolicyEngine"
import { orchestrator } from "./src/infrastructure/ai/Orchestrator"
import { dbPool } from "./src/infrastructure/db/BufferedDbPool"
import { setDbPath } from "./src/infrastructure/db/Config"

async function test() {
	console.log("🚀 Starting DB Fluidity & Policy Seal Verification...")

	// Initialize DB
	const tempDb = path.join(os.tmpdir(), `test-${Date.now()}.db`)
	setDbPath(tempDb)

	// 1. Verify DB Fluidity (Shadow Merging)
	const streamId = "test-stream-1"
	await dbPool.beginWork(streamId)

	// storeMemory pushes to globalBuffer
	await orchestrator.storeMemory(streamId, "key1", "value1")

	// recallMemory calls selectOne, which should merge disk + global
	const globalVal = await orchestrator.recallMemory(streamId, "key1")
	assert.strictEqual(globalVal, "value1", "Should recall from global buffer")

	// Now push to shadow
	await dbPool.push(
		{
			type: "insert",
			table: "agent_memory",
			values: { streamId, key: "shadowKey", value: "shadowVal", updatedAt: Date.now() },
			layer: "domain",
		},
		streamId,
	)

	const shadowVal = await dbPool.selectOne(
		"agent_memory",
		[
			{ column: "streamId", value: streamId },
			{ column: "key", value: "shadowKey" },
		],
		streamId,
	)
	assert.ok(shadowVal, "Should find shadow value")
	assert.strictEqual(shadowVal!.value, "shadowVal", "Should recall from shadow buffer")

	// Verify selectWhere optimization
	const tasks = await orchestrator.getStreamTasks(streamId, streamId)
	assert.ok(Array.isArray(tasks), "Should return tasks array")

	console.log("✅ DB Fluidity Verified.")

	// 2. Verify Policy Seal
	const engine = new FluidPolicyEngine(process.cwd(), streamId)

	engine.setCommitSeal("ARCH-DEBT-01", "Urgent bugfix requiring temporary violation")
	const header = await engine.onRead("src/domain/test.ts", "content")
	assert.ok(header.includes("COMMIT SEAL ACTIVE: 'ARCH-DEBT-01'"), "Seal should be injected into header")

	console.log("✅ Policy Seal Logic Verified.")
}

test().catch((e) => {
	console.error("❌ Verification Failed:", e)
	process.exit(1)
})
