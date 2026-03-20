#!/usr/bin/env ts-node

import fs from "fs"
import path from "path"
import "tsconfig-paths/register"

import { WebSocketAdapter } from "@adapters/webSocketAdapter"
import { NON_DETERMINISTIC_FIELDS } from "@harness/config"
import { SpecFile } from "@harness/types"
import { compareResponse, loadJson, retry } from "@harness/utils"

const STANDALONE_PROTOBUS_SERVER_PORT = process.env.STANDALONE_GRPC_SERVER_PORT || "26040"
const FIX_MODE = process.argv.includes("--fix")

function shouldAttemptFix(): boolean {
	return FIX_MODE
}

function shouldThrowError(fixed: boolean): boolean {
	return !FIX_MODE || !fixed
}

async function tryFixEntry(
	entry: SpecFile["entries"][number],
	actualResponse: any,
	spec: SpecFile,
	specPath: string,
): Promise<boolean> {
	if (!shouldAttemptFix()) return false

	console.warn(`✏️ Updating response for RequestID: ${entry.requestId}`)
	entry.response.message = actualResponse
	fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`)
	console.log(`💾 Spec file updated: ${specPath}`)

	const { success } = compareResponse(actualResponse, entry?.response?.message, NON_DETERMINISTIC_FIELDS)

	if (success) {
		console.log("✅ Response matched after fix! RequestID: %s", entry.requestId)
		return true
	}

	return false
}

async function runSpec(specPath: string, adapter: WebSocketAdapter) {
	const spec: SpecFile = loadJson(specPath)

	for (const entry of spec.entries) {
		console.log(`▶️ ${entry.service}.${entry.method}`)
		let actualResponse
		let fixed = false

		try {
			await retry(async () => {
				actualResponse = await adapter.call(entry.service as any, entry.method, entry.request)

				const { success, diffs } = compareResponse(
					actualResponse,
					entry?.response?.message,
					NON_DETERMINISTIC_FIELDS,
					entry.meta?.expected,
				)

				if (success) {
					console.log("✅ Response matched! RequestID: %s", entry.requestId)
					return
				}

				// Try to fix if mismatch
				fixed = await tryFixEntry(entry, actualResponse, spec, specPath)

				if (!fixed) {
					const diffMsg = diffs.join("\n")
					throw new Error(`❌ Response mismatch! RequestID: ${entry.requestId}\n${diffMsg}`)
				}
			})
		} catch (err) {
			if (shouldThrowError(fixed)) {
				throw err
			}
			console.log("✅ Test passed after fixing response")
		}
	}
}

async function runSpecsFromFolder(folderPath: string, adapter: WebSocketAdapter) {
	const files = fs.readdirSync(folderPath).filter((f) => f.endsWith(".json"))

	if (files.length === 0) {
		console.warn(`⚠️ No JSON spec files found in ${folderPath}`)
		return
	}

	for (const file of files) {
		const fullPath = path.join(folderPath, file)
		console.log(`\n📂 Running spec file: ${file}`)
		await runSpec(fullPath, adapter)
	}
}

async function main() {
	const inputPath = process.argv[2]
	if (!inputPath) {
		console.error("Usage: ts-node index.ts <spec-file-or-folder> [--fix]")
		process.exit(1)
	}

	const fullPath = path.resolve(inputPath)
	const adapter = new WebSocketAdapter(`localhost:${STANDALONE_PROTOBUS_SERVER_PORT}`)

	const stat = fs.statSync(fullPath)
	if (stat.isDirectory()) {
		await runSpecsFromFolder(fullPath, adapter)
	} else {
		await runSpec(fullPath, adapter)
	}

	adapter.close()
}

main().catch((err) => {
	console.error("❌ Fatal error:", err)
	process.exit(1)
})
