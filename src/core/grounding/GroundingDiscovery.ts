import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { FileSnippet, searchFilesWithSnippetsBatch } from "@/services/search/file-search"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { KnowledgeGraphService } from "../context/KnowledgeGraphService"
import { LRUCache } from "./GroundingCache"

export class GroundingDiscovery {
	// rgCache: 1 minute TTL for ripgrep results
	private static rgCache = new LRUCache<Record<string, FileSnippet[]>>(20, 60000)
	// rulesCache: 10 minute TTL for project rules to avoid heavy I/O
	private static rulesCache = new LRUCache<string>(10, 600000)
	// keywordCache: 1 hour TTL for extracted keywords (stable per intent)
	private static keywordCache = new LRUCache<string[]>(100, 3600000)
	// statCache: 10 second TTL for fs stats to avoid redundant I/O in a single discovery pass
	private static statCache = new LRUCache<import("fs").Stats>(50, 10000)
	// workspaceIndexCache: 5 minute TTL for workspace file list
	private static workspaceIndexCache = new LRUCache<Map<string, { size: number; mtime: string }>>(5, 300000)

	static clearCache(): void {
		GroundingDiscovery.rgCache.clear()
		GroundingDiscovery.rulesCache.clear()
		GroundingDiscovery.keywordCache.clear()
		GroundingDiscovery.statCache.clear()
		GroundingDiscovery.workspaceIndexCache.clear()
	}

	constructor(
		private executeGroundingRequest: (
			systemPrompt: string,
			messages: CodemarieStorageMessage[],
		) => Promise<{ spec: unknown; tokens: { input: number; output: number } }>,
	) {}

	getInternalStatCache(): LRUCache<import("fs").Stats> {
		return GroundingDiscovery.statCache
	}

	async getWorkspaceIndex(cwd: string): Promise<Map<string, { size: number; mtime: string }>> {
		const cached = GroundingDiscovery.workspaceIndexCache.get(cwd)
		if (cached) return cached

		const index = new Map<string, { size: number; mtime: string }>()
		try {
			// Phase 3: Workspace Virtualization - Get all files once
			const { executeRipgrepForFiles } = await import("@/services/search/file-search")
			const items = await executeRipgrepForFiles(cwd, 5000)

			// We populate the index with existence. Size/Mtime will be lazily added or batch populated if possible.
			// For now, existence check is the primary speedup for verification.
			for (const item of items) {
				if (item.type === "file") {
					index.set(item.path, { size: 0, mtime: "unknown" })
				}
			}
			GroundingDiscovery.workspaceIndexCache.set(cwd, index)
		} catch (e) {
			Logger.warn("[GroundingDiscovery] Failed to build workspace index:", e)
		}
		return index
	}

	async discoverRelevantContext(
		intent: string,
		cwd: string,
		streamId?: string,
		knowledgeGraph?: KnowledgeGraphService,
	): Promise<string> {
		if (typeof intent !== "string" || !intent) return ""
		try {
			// Optimization: Naive keywords for speculative KG discovery
			const naiveKeywords = intent.split(/\W+/).filter((w) => typeof w === "string" && w.length > 4)

			// Start KG discovery speculatively while waiting for LLM keywords
			const kgPromise =
				knowledgeGraph && streamId
					? this.speculativeKgDiscovery(intent, streamId, knowledgeGraph, naiveKeywords)
					: Promise.resolve("")

			const keywordsPromise = this.extractKeywords(intent, cwd)

			// Parallelize KG lookup and Keyword extraction
			const [kgContext, keywords] = await Promise.all([kgPromise, keywordsPromise])

			// Pass 3: KG Saturation - If KG found high-confidence semantic matches, we can optionally bypass/short-circuit
			// For now we merge them, but we prioritize them in ranking.
			let saturatedContext = kgContext
			if (knowledgeGraph && streamId) {
				const semanticMatches = await knowledgeGraph.searchKnowledge(streamId, intent, {
					augmentWithGraph: true,
					limit: 5,
				})

				const highConfNodes = semanticMatches.filter((n) => n.similarity > 0.9)
				if (highConfNodes.length > 0) {
					Logger.info(`[GroundingDiscovery] KG Saturation: Found ${highConfNodes.length} high-confidence matches.`)
					saturatedContext += `\n### High-Confidence Semantic Landmarks:\n`
					saturatedContext += highConfNodes.map((n) => `- ${n.content} (Ref: ${n.id})`).join("\n") + "\n"
				}
			}

			if (keywords.length === 0) {
				return saturatedContext
			}

			// Optimization: Cache ripgrep results with TTL to avoid redundant heavy I/O
			const keywordsKey = crypto.createHash("sha256").update(keywords.sort().join("|")).digest("hex")
			const cacheKey = `${cwd}:${keywordsKey}`

			const cachedResults = GroundingDiscovery.rgCache.get(cacheKey)
			let keywordResults: Record<string, FileSnippet[]> = {}

			if (cachedResults) {
				keywordResults = cachedResults
			} else {
				// Phase 5: I/O Circuit Breaker - Cap total search time per keyword
				const SEARCH_TIMEOUT = 8000

				try {
					// Pass 2: Multiplexed Ripgrep - Search keywords in a single batch
					keywordResults = await Promise.race([
						searchFilesWithSnippetsBatch(keywords, cwd, 3, 2),
						new Promise<Record<string, FileSnippet[]>>((_, reject) =>
							setTimeout(() => reject(new Error("Timeout in multiplexed ripgrep batch")), SEARCH_TIMEOUT),
						),
					])
				} catch (e) {
					Logger.warn("[GroundingDiscovery] Multiplexed search failed, falling back to empty:", e)
					keywordResults = {}
				}

				GroundingDiscovery.rgCache.set(cacheKey, keywordResults)
			}

			// Extreme Hardening: Global Snippet Ranking
			// We aggregate all snippets and rank them to provide the most dense context
			const allSnippets: { path: string; snippets: string[]; score: number }[] = []
			const seenPaths = new Set<string>()

			for (const word of keywords) {
				const results = keywordResults[word] || []
				for (const snip of results) {
					if (!snip || typeof snip.path !== "string") continue
					if (seenPaths.has(snip.path)) {
						// Points for multi-keyword overlap
						const existing = allSnippets.find((s) => s.path === snip.path)
						if (existing) {
							existing.score += 3 // Increased weight for overlap
							// Also add unique snippets from other keywords
							for (const s of snip.snippets) {
								if (!existing.snippets.includes(s)) {
									existing.snippets.push(s)
								}
							}
						}
						continue
					}

					let score = 1 // Base score
					// Bonus if file path is mentioned in the intent
					try {
						const basename = path.basename(snip.path).toLowerCase()
						const intentLower = intent.toLowerCase()
						if (intentLower.includes(basename)) {
							score += 5
						}
						// Bonus for exact extension match in intent
						const ext = path.extname(snip.path).toLowerCase()
						if (ext && intentLower.includes(ext)) {
							score += 1
						}
					} catch {
						/* ignore potential string failures */
					}
					// Bonus if it's a "deep" file (likely logic) vs root file
					if (snip.path.includes("/") || snip.path.includes("\\")) {
						score += 1
					}

					allSnippets.push({ ...snip, score })
					seenPaths.add(snip.path)
				}
			}

			// Final score adjustment: normalize by snippet count (we want dense files)
			for (const s of allSnippets) {
				s.score += s.snippets.length * 0.5
			}

			const topSnippets = allSnippets.sort((a, b) => b.score - a.score).slice(0, 8)
			// Optimization: Batch metadata enrichment with session cache
			const enrichedSnippets = await this.enrichWithMetadata(cwd, topSnippets)

			if (enrichedSnippets.length === 0) return ""

			const contextLines: string[] = ["### Semantic Discovery Results (Top Ranked with Metadata):"]
			for (const snip of enrichedSnippets) {
				const meta = snip.metadata ? ` [Size: ${snip.metadata.size}b, Mod: ${snip.metadata.mtime}]` : ""
				contextLines.push(`File: ${snip.path}${meta} (Relevance Score: ${snip.score.toFixed(1)})`)
				contextLines.push("```")
				// Limit snippets per file to keep context focused
				contextLines.push(...snip.snippets.slice(0, 4))
				contextLines.push("```")
			}

			return saturatedContext + contextLines.join("\n")
		} catch (error) {
			Logger.error("[GroundingDiscovery] Semantic discovery failed:", error)
			return ""
		}
	}

	async loadProjectRules(cwd: string): Promise<string> {
		const cachedRules = GroundingDiscovery.rulesCache.get(cwd)
		if (cachedRules !== undefined) {
			return cachedRules
		}

		try {
			// Hardening: Look in both .codemarierules and .codemarie
			const rulesDirs = [path.join(cwd, ".codemarierules"), path.join(cwd, ".codemarie")]
			const allMdFiles: string[] = []

			for (const dir of rulesDirs) {
				try {
					// Optimization: Depth-limited rule discovery to avoid scanning massive repos
					const files = await this.globMdFiles(dir, 1)
					allMdFiles.push(...files)
				} catch {
					/* ignore */
				}
			}

			if (allMdFiles.length === 0) {
				GroundingDiscovery.rulesCache.set(cwd, "")
				return ""
			}

			// Prioritize CORE.md, GENERAL.md, or CLI.md
			allMdFiles.sort((a, b) => {
				const aBase = path.basename(a).toLowerCase()
				const bBase = path.basename(b).toLowerCase()
				const priority = ["core.md", "general.md", "cli.md", "README.md"]
				for (const p of priority) {
					if (aBase.includes(p) && !bBase.includes(p)) return -1
					if (!aBase.includes(p) && bBase.includes(p)) return 1
				}
				return 0
			})

			const ruleContents = await Promise.all(
				allMdFiles.slice(0, 8).map(async (filePath) => {
					const content = await fs.readFile(filePath, "utf-8")
					const relativePath = path.relative(cwd, filePath)

					// Extreme Hardening: Intelligent Rule Truncation
					// We want to keep the most important context (headers, directives) when truncating.
					const MAX_RULE_CHARS = 4000
					let truncated = content
					if (content.length > MAX_RULE_CHARS) {
						// Look for a high-level header near the limit to break cleanly
						let breakIdx = content.lastIndexOf("\n#", MAX_RULE_CHARS)
						if (breakIdx === -1) breakIdx = content.lastIndexOf("\n##", MAX_RULE_CHARS)
						if (breakIdx === -1) breakIdx = MAX_RULE_CHARS

						truncated = `${content.substring(0, breakIdx).trim()}\n\n[... Rule file continues, but truncated for brevity ...]`
					}

					return `--- ${relativePath} ---\n${truncated}\n\n`
				}),
			)

			const finalRules = ruleContents.join("").trim()
			GroundingDiscovery.rulesCache.set(cwd, finalRules)
			return finalRules
		} catch {
			return ""
		}
	}

	private async speculativeKgDiscovery(
		_intent: string,
		streamId: string,
		knowledgeGraph: KnowledgeGraphService,
		naiveKeywords: string[],
	): Promise<string> {
		try {
			// Get co-modification graph for naive keywords to start early
			const fileKeywords = naiveKeywords.filter((k) => k.includes(".") || k.includes("/") || k.includes("\\"))
			const correlatedFiles = new Set<string>()

			// Parallelize KG lookups
			await Promise.all(
				fileKeywords.map(async (fk) => {
					try {
						const related = await knowledgeGraph.getContextGraph(streamId, fk, 3)
						for (const r of related) correlatedFiles.add(r.path)

						const blast = await knowledgeGraph.calculateBlastRadius(streamId, fk, 1)
						for (const b of blast) correlatedFiles.add(b.path)
					} catch {
						/* ignore individual file failures */
					}
				}),
			)

			if (correlatedFiles.size > 0) {
				let kgContext = `\n### Historical Semantic Affinities (Speculative Discovery):\n`
				kgContext += `Based on past modifications, these files may also be relevant: ${Array.from(correlatedFiles).join(", ")}\n`
				return kgContext
			}
		} catch (kgError) {
			Logger.warn("[GroundingDiscovery] Speculative KG discovery failed:", kgError)
		}
		return ""
	}

	private async extractKeywords(intent: string, _cwd: string): Promise<string[]> {
		const cacheKey = `${_cwd}:${intent}`
		const cached = GroundingDiscovery.keywordCache.get(cacheKey)
		if (cached) return cached

		// Optimization: Fast-path heuristic extraction
		const heuristicKeywords = this.extractKeywordsHeuristics(intent)

		// If heuristic finds enough high-quality keywords (file paths or specific terms), consider skipping LLM
		const highQualityHeuristics = heuristicKeywords.filter(
			(k) => k.includes(".") || k.length > 10 || /^[A-Z]/.test(k), // paths, long terms, or PascalCase names
		)

		if (highQualityHeuristics.length >= 3) {
			Logger.info("[GroundingDiscovery] Fast-path keyword extraction triggered.")
			GroundingDiscovery.keywordCache.set(cacheKey, heuristicKeywords)
			return heuristicKeywords
		}

		const naiveKeywords = intent
			.split(/\W+/)
			.filter(
				(w) =>
					w.length > 5 &&
					!["function", "variable", "refactor", "change", "module", "component"].includes(w.toLowerCase()),
			)
			.sort((a, b) => b.length - a.length)
			.slice(0, 5)

		const prompt = `Extract exactly 5 technical keywords or file paths from this intent to use for semantic search (ripgrep).
Intent: "${intent}"

Focus on:
- Specific file names or extensions.
- Core domain terms or component names.
- Technical verbs (e.g., "authenticate", "serialize").

Return ONLY a JSON string array of keywords. (e.g. ["AuthService.ts", "login", "encryption"])`

		try {
			// Hardening: Use a simplified request for keywords to improve speed and determinism
			const { spec } = await this.executeGroundingRequest("JSON array only. High precision.", [
				{ role: "user", content: [{ type: "text", text: prompt }] },
			])

			let keywords: string[] = []
			if (Array.isArray(spec)) {
				keywords = spec.slice(0, 5)
			} else if (spec && typeof spec === "object" && "keywords" in spec && Array.isArray(spec.keywords)) {
				keywords = spec.keywords.slice(0, 5)
			}

			// Merge naive and LLM keywords for maximum coverage
			const merged = Array.from(new Set([...keywords, ...naiveKeywords, ...heuristicKeywords])).slice(0, 7)
			if (merged.length > 0) {
				GroundingDiscovery.keywordCache.set(cacheKey, merged)
				return merged
			}
			return heuristicKeywords.length > 0 ? heuristicKeywords : naiveKeywords
		} catch (e) {
			Logger.warn("[GroundingDiscovery] Keyword extraction failed, falling back to heuristics", e)
			return heuristicKeywords.length > 0 ? heuristicKeywords : naiveKeywords
		}
	}

	private extractKeywordsHeuristics(intent: string): string[] {
		const keywords = new Set<string>()

		// Regex for file paths (e.g., src/core/file.ts)
		const pathMatch = intent.match(/[\w/\\.-]+\.\w+/g)
		if (pathMatch) pathMatch.forEach((p) => keywords.add(p))

		// Regex for PascalCase/camelCase names (potential classes/functions)
		const identifierMatch = intent.match(/\b[a-zA-Z][a-zA-Z0-9]{5,}\b/g)
		if (identifierMatch) {
			identifierMatch.forEach((id) => {
				if (!["function", "variable", "refactor", "change", "module", "component"].includes(id.toLowerCase())) {
					keywords.add(id)
				}
			})
		}

		return Array.from(keywords).slice(0, 7)
	}

	private async enrichWithMetadata(
		cwd: string,
		snippets: { path: string; snippets: string[]; score: number }[],
	): Promise<{ path: string; snippets: string[]; score: number; metadata?: { size: number; mtime: string } }[]> {
		return Promise.all(
			snippets.map(async (snip) => {
				try {
					const fullPath = path.join(cwd, snip.path)
					const cacheKey = fullPath

					// Pass 3: Use Workspace Index if available
					const index = GroundingDiscovery.workspaceIndexCache.get(cwd)
					if (index?.has(snip.path)) {
						return {
							...snip,
							metadata: {
								size: index.get(snip.path)!.size || 0,
								mtime: index.get(snip.path)!.mtime || "indexed",
							},
						}
					}

					let stats = GroundingDiscovery.statCache.get(cacheKey)
					if (!stats) {
						stats = await fs.stat(fullPath)
						GroundingDiscovery.statCache.set(cacheKey, stats)
					}

					return {
						...snip,
						metadata: {
							size: stats.size,
							mtime: stats.mtime.toISOString().split("T")[0],
						},
					}
				} catch {
					return snip
				}
			}),
		)
	}

	private async globMdFiles(dir: string, currentDepth = 0): Promise<string[]> {
		const files: string[] = []
		// Hardening: Prevent too deep search for rules
		const MAX_RULE_DEPTH = 2
		if (currentDepth > MAX_RULE_DEPTH) return []
		try {
			const entries = await fs.readdir(dir, { withFileTypes: true })
			for (const entry of entries) {
				const res = path.resolve(dir, entry.name)
				if (entry.isDirectory()) {
					// Hardening: Prevent infinite recursion or too deep search
					if (!entry.name.startsWith(".")) {
						files.push(...(await this.globMdFiles(res, currentDepth + 1)))
					}
				} else if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) {
					files.push(res)
				}
			}
		} catch {
			/* ignore */
		}
		return files
	}
}
