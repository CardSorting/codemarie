import { execSync, spawn } from "child_process"
import * as path from "path"
import * as fs from "fs"
import net from "net"

async function waitForPort(port: number, host = "127.0.0.1", timeout = 15000): Promise<number> {
	const start = Date.now()
	while (Date.now() - start < timeout) {
		try {
			await new Promise<void>((resolve, reject) => {
				const socket = net.connect(port, host, () => {
					socket.destroy()
					resolve()
				})
				socket.on("error", reject)
			})
			return Date.now() - start
		} catch {
			await new Promise((res) => setTimeout(res, 100))
		}
	}
	throw new Error(`Timeout waiting for ${host}:${port}`)
}

async function benchmarkSmokeTestHarness() {
	console.log("📊 Benchmarking Smoke Test Harness...")
	
	const startTime = Date.now()
	// Run a single trial of a simple scenario
	try {
		const output = execSync("npm run eval:smoke -- --scenario 01-create-file --trials 1", {
			encoding: "utf-8",
			env: { ...process.env, CODEMARIE_API_KEY: process.env.CODEMARIE_API_KEY || "dummy" }
		})
		const duration = Date.now() - startTime
		console.log(`✅ Smoke Test (01-create-file) completed in ${duration}ms`)
		return duration
	} catch (err: any) {
		console.error("❌ Smoke test failed:", err.message)
		return null
	}
}

async function benchmarkTestingPlatformHarness() {
	console.log("\n📊 Benchmarking Testing Platform Harness...")
	
	const startTime = Date.now()
	
	// 1. Measure server boot time
	const grpcPort = 26040
	console.log(`🚀 Starting standalone server on port ${grpcPort}...`)
	const server = spawn("npx", ["tsx", "scripts/test-standalone-core-api-server.ts"], {
		env: { ...process.env, PROTOBUS_PORT: grpcPort.toString() }
	})
	
	try {
		const bootTime = await waitForPort(grpcPort)
		console.log(`✅ Server booted in ${bootTime}ms`)
		
		// 2. Run a spec (if any exists)
		const specsDir = path.join(process.cwd(), "tests", "specs")
		if (fs.existsSync(specsDir)) {
			const specFiles = fs.readdirSync(specsDir).filter(f => f.endsWith(".json"))
			if (specFiles.length > 0) {
				const specPath = path.join(specsDir, specFiles[0])
				const specStartTime = Date.now()
				execSync(`npx ts-node index.ts "${specPath}"`, {
					cwd: path.join(process.cwd(), "testing-platform"),
					env: { ...process.env, STANDALONE_GRPC_SERVER_PORT: grpcPort.toString() }
				})
				console.log(`✅ Spec ${path.basename(specPath)} executed in ${Date.now() - specStartTime}ms`)
			}
		}
		
		const totalDuration = Date.now() - startTime
		console.log(`✅ Testing Platform total benchmark: ${totalDuration}ms`)
		return totalDuration
	} finally {
		server.kill()
	}
}

async function main() {
	const smokeDuration = await benchmarkSmokeTestHarness()
	const tpDuration = await benchmarkTestingPlatformHarness()
	
	console.log("\n" + "=".repeat(40))
	console.log("HARNESS PERFORMANCE SUMMARY")
	console.log("=".repeat(40))
	console.log(`Smoke Test Harness:     ${smokeDuration ? smokeDuration + "ms" : "FAILED"}`)
	console.log(`Testing Platform:       ${tpDuration ? tpDuration + "ms" : "FAILED"}`)
	console.log("=".repeat(40))
}

main().catch(console.error)
