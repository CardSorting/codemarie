import * as fs from "fs/promises"
import * as path from "path"

export interface InterfaceSummary {
	classes: string[]
	functions: string[]
	interfaces: string[]
	types: string[]
	constants: string[]
}

export class InterfaceSummarizer {
	/**
	 * Summarizes the public interface of a source file.
	 * Currently supports TS, JS, Python, Go, Rust.
	 */
	static async summarize(filePath: string): Promise<string> {
		const ext = path.extname(filePath).toLowerCase()
		try {
			const content = await fs.readFile(filePath, "utf-8")
			if (content.length > 50000) {
				return "[File too large for full interface summary]"
			}

			switch (ext) {
				case ".ts":
				case ".tsx":
				case ".js":
				case ".jsx":
					return InterfaceSummarizer.summarizeJSFamily(content)
				case ".py":
					return InterfaceSummarizer.summarizePython(content)
				case ".go":
					return InterfaceSummarizer.summarizeGo(content)
				case ".rs":
					return InterfaceSummarizer.summarizeRust(content)
				default:
					return ""
			}
		} catch {
			return ""
		}
	}

	private static summarizeJSFamily(content: string): string {
		const summary: string[] = []

		// Remove comments to avoid false matches
		const cleanedContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "").replace(/\s+/g, " ")

		// Match exports: export class X, export function X, export const X, export interface X, export type X
		// Handles multiline (after cleaning) and async/abstract
		const classRegex = /export\s+(?:abstract\s+)?class\s+([a-zA-Z0-9_]+)/g
		const funcRegex = /export\s+(?:async\s+)?function\s+([a-zA-Z0-9_]+)/g
		const interfaceRegex = /export\s+interface\s+([a-zA-Z0-9_]+)/g
		const typeRegex = /export\s+type\s+([a-zA-Z0-9_]+)/g
		const constRegex = /export\s+(?:const|let|var)\s+([a-zA-Z0-9_]+)/g

		let match
		const classes = []
		while ((match = classRegex.exec(cleanedContent))) classes.push(match[1])
		if (classes.length > 0) summary.push(`Classes: ${classes.join(", ")}`)

		const funcs = []
		while ((match = funcRegex.exec(cleanedContent))) funcs.push(match[1])
		if (funcs.length > 0) summary.push(`Functions: ${funcs.join(", ")}`)

		const interfaces = []
		while ((match = interfaceRegex.exec(cleanedContent))) interfaces.push(match[1])
		if (interfaces.length > 0) summary.push(`Interfaces: ${interfaces.join(", ")}`)

		const types = []
		while ((match = typeRegex.exec(cleanedContent))) types.push(match[1])
		if (types.length > 0) summary.push(`Types: ${types.join(", ")}`)

		// Filter constants to only show likely "important" ones (UPPER_CASE or reasonably long)
		const constants = []
		while ((match = constRegex.exec(cleanedContent))) {
			const name = match[1]
			if (name === name.toUpperCase() || name.length > 10) {
				constants.push(name)
			}
		}
		if (constants.length > 0) summary.push(`Constants: ${constants.join(", ")}`)

		return summary.join(" | ")
	}

	private static summarizePython(content: string): string {
		const summary: string[] = []

		// Remove comments (#)
		const cleanedContent = content.replace(/#.*/g, "").replace(/\s+/g, " ")

		const classRegex = /class\s+([a-zA-Z0-9_]+)/g
		const defRegex = /def\s+([a-zA-Z0-9_]+)/g

		let match
		const classes = []
		while ((match = classRegex.exec(cleanedContent))) classes.push(match[1])
		if (classes.length > 0) summary.push(`Classes: ${classes.join(", ")}`)

		const defs = []
		while ((match = defRegex.exec(cleanedContent))) defs.push(match[1])
		if (defs.length > 0) summary.push(`Functions: ${defs.join(", ")}`)

		return summary.join(" | ")
	}

	private static summarizeGo(content: string): string {
		const summary: string[] = []

		// Remove comments
		const cleanedContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "").replace(/\s+/g, " ")

		const funcRegex = /func\s+([a-zA-Z0-9_]+)/g
		const typeRegex = /type\s+([a-zA-Z0-9_]+)/g

		let match
		const funcs = []
		while ((match = funcRegex.exec(cleanedContent))) {
			if (/^[A-Z]/.test(match[1])) funcs.push(match[1])
		}
		if (funcs.length > 0) summary.push(`Functions: ${funcs.join(", ")}`)

		const types = []
		while ((match = typeRegex.exec(cleanedContent))) {
			if (/^[A-Z]/.test(match[1])) types.push(match[1])
		}
		if (types.length > 0) summary.push(`Types: ${types.join(", ")}`)

		return summary.join(" | ")
	}

	private static summarizeRust(content: string): string {
		const summary: string[] = []

		// Remove comments
		const cleanedContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "").replace(/\s+/g, " ")

		const pubRegex = /pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type)\s+([a-zA-Z0-9_]+)/g

		let match
		const items = []
		while ((match = pubRegex.exec(cleanedContent))) items.push(match[1])
		if (items.length > 0) summary.push(`Public: ${items.join(", ")}`)

		return summary.join(" | ")
	}
}
