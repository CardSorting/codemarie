import { strict as assert } from "node:assert"
import * as fs from "fs/promises"
import { after, before, describe, it } from "mocha"
import * as path from "path"
import { InterfaceSummarizer } from "../InterfaceSummarizer"

describe("InterfaceSummarizer Hardening", () => {
	const testDir = path.join(__dirname, "test-files-harden")

	before(async () => {
		await fs.mkdir(testDir, { recursive: true })
	})

	after(async () => {
		await fs.rm(testDir, { recursive: true, force: true })
	})

	it("handles JS/TS comments and multiline declarations", async () => {
		const tsFile = path.join(testDir, "test.ts")
		const content = `
			// export interface Fake { id: string }
			/* export class Hidden {} */
			export 
			class RealService {
				login() {}
			}
			export interface 
			  User {
				id: string;
			}
			/**
			 * export function comment() {}
			 */
			export function active() {}
		`
		await fs.writeFile(tsFile, content)

		const summary = await InterfaceSummarizer.summarize(tsFile)
		assert.match(summary, /Classes: RealService/)
		assert.match(summary, /Interfaces: User/)
		assert.match(summary, /Functions: active/)
		assert.ok(!summary.includes("Fake"))
		assert.ok(!summary.includes("Hidden"))
		assert.ok(!summary.includes("comment"))
	})

	it("handles Python comments", async () => {
		const pyFile = path.join(testDir, "test.py")
		const content = `
# class Fake: pass
class Real:
    pass

# def fake(): pass
def real():
    pass
		`
		await fs.writeFile(pyFile, content)

		const summary = await InterfaceSummarizer.summarize(pyFile)
		assert.match(summary, /Classes: Real/)
		assert.match(summary, /Functions: real/)
		assert.ok(!summary.includes("Fake"))
		assert.ok(!summary.includes("fake"))
	})
})
