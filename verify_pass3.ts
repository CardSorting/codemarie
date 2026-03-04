import * as assert from "assert"
import * as path from "path"
import * as os from "os"
import { setDbPath } from "./src/infrastructure/db/Config"
import { dbPool } from "./src/infrastructure/db/BufferedDbPool"
import { orchestrator } from "./src/infrastructure/ai/Orchestrator"
import { FluidPolicyEngine } from "./src/core/policy/FluidPolicyEngine"
import { CodemarieDefaultTool } from "./src/shared/tools"

async function test() {
    console.log("🚀 Starting Pass 3: Advanced Fluidity Verification...")

    // Initialize DB
    const tempDb = path.join(os.tmpdir(), `test-pass3-${Date.now()}.db`)
    setDbPath(tempDb)

    const stream1 = "stream-1"
    const stream2 = "stream-2"
    await dbPool.beginWork(stream1)
    await dbPool.beginWork(stream2)

    // 1. Verify Atomic Upsert (Shadow Phase)
    console.log("--- Testing Atomic Upsert ---")
    await orchestrator.storeMemory(stream1, "key1", "initial")
    await orchestrator.storeMemory(stream1, "key1", "updated") // This is an upsert
    
    const val1 = await orchestrator.recallMemory(stream1, "key1")
    assert.strictEqual(val1, "updated", "Upsert should maintain the latest value in shadow")

    // 2. Verify Chronological Order (Chronos Test)
    console.log("--- Testing Chronological Shadow Order ---")
    // Ops: Insert('v1') -> Update('v2') -> Delete -> Insert('v3')
    const key = "chronos-key"
    await dbPool.push({ type: "insert", table: "agent_memory", values: { streamId: stream1, key, value: "v1", updatedAt: 1 }, layer: "domain" }, stream1)
    await dbPool.push({ type: "update", table: "agent_memory", values: { value: "v2" }, where: [{ column: "key", value: key }], layer: "domain" }, stream1)
    await dbPool.push({ type: "delete", table: "agent_memory", where: [{ column: "key", value: key }], layer: "domain" }, stream1)
    await dbPool.push({ type: "insert", table: "agent_memory", values: { streamId: stream1, key, value: "v3", updatedAt: 2 }, layer: "domain" }, stream1)

    const finalV = await dbPool.selectOne("agent_memory", { column: "key", value: key }, stream1)
    assert.ok(finalV, "Should have a value after delete+insert")
    assert.strictEqual(finalV!.value, "v3", "Chronological order must be respected in shadow merge")

    // 3. Verify Predictive Collision
    console.log("--- Testing Predictive Collision ---")
    const testFile = path.resolve(process.cwd(), "src/domain/locked-file.ts")
    
    // Stream 2 locks the file
    await dbPool.push({ type: "insert", table: "agent_streams", values: { id: stream2, focus: "locking", status: "active", createdAt: 1 }, layer: "infrastructure" })
    await dbPool.commitWork(stream2) // Commit stream2's existence
    
    await dbPool.beginWork(stream2) // Start new work for stream2
    await dbPool.push({ type: "insert", table: "agent_memory", values: { streamId: stream2, key: "lock", value: "active" }, layer: "domain" }, stream2, testFile)

    // Stream 1 checks collision in PLAN mode
    const engine1 = new FluidPolicyEngine(process.cwd(), stream1)
    engine1.setMode("plan")
    
    const planResult = await engine1.validatePreExecution({
        name: CodemarieDefaultTool.FILE_EDIT,
        params: { path: "src/domain/locked-file.ts", content: "// planning" }
    })
    
    assert.ok(planResult.warning?.includes("PREDICTIVE COLLISION"), "Plan mode must warn about active locks")
    console.log("✅ All Pass 3 Tests Completed Successfully.")
}

test().catch(e => {
    console.error("❌ Pass 3 Verification Failed:", e)
    process.exit(1)
})
