import * as crypto from "crypto"
import * as fs from "fs"
import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { FileSnippet, searchFilesWithSnippetsBatch } from "@/services/search/file-search"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { LRUCache } from "@/shared/utils/LRUCache"
import { KnowledgeGraphService } from "../context/KnowledgeGraphService"
import { InterfaceSummarizer } from "./InterfaceSummarizer"

export class GroundingDiscovery {
	// rgCache: 1 minute TTL for ripgrep results
	private static rgCache = new LRUCache<Record<string, FileSnippet[]>>(20, 60000)
	// rulesCache: 10 minute TTL for project rules to avoid heavy I/O
	private static rulesCache = new LRUCache<string>(10, 600000)
	// keywordCache: 1 hour TTL for extracted keywords (stable per intent)
	private static keywordCache = new LRUCache<string[]>(100, 3600000)
	// statCache: 10 second TTL for fs stats to avoid redundant I/O in a single discovery pass
	private static statCache = new LRUCache<fs.Stats>(50, 10000)
	// workspaceIndexCache: 5 minute TTL for workspace file list
	private static workspaceIndexCache = new LRUCache<Map<string, { size: number; mtime: string }>>(5, 300000)
	// refreshingNodes: Track nodes currently being refreshed to avoid redundant work
	private static refreshingNodes = new Set<string>()

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

	getInternalStatCache(): LRUCache<fs.Stats> {
		return GroundingDiscovery.statCache
	}

	private static getAdaptiveConcurrency(projectSize = 0): number {
		const cpuCount = os.cpus().length || 4
		// In large projects, we want to be more conservative to avoid I/O thrashing
		if (projectSize > 5000) return Math.min(cpuCount, 8)
		if (projectSize > 1000) return Math.min(cpuCount * 2, 16)
		return Math.min(cpuCount * 4, 32)
	}

	async getWorkspaceIndex(cwd: string): Promise<Map<string, { size: number; mtime: string }>> {
		const cached = GroundingDiscovery.workspaceIndexCache.get(cwd)
		if (cached) return cached

		const index = new Map<string, { size: number; mtime: string }>()
		try {
			// Phase 3: Workspace Virtualization - Get all files once
			const { executeRipgrepForFiles } = await import("@/services/search/file-search")
			const items = await executeRipgrepForFiles(cwd, 10000) // Increased limit for large projects

			for (const item of items) {
				if (item.type === "file") {
					index.set(item.path, { size: 0, mtime: "unknown" })
				}
			}

			// Phase 5: Accelerated Indexing - Batch populate stats for the first 500 files
			// This makes drift detection near-instant for most hotspots.
			const filesToStat = Array.from(index.keys()).slice(0, 500)
			await this.batchPopulateStats(cwd, filesToStat, index)

			GroundingDiscovery.workspaceIndexCache.set(cwd, index)
		} catch (e) {
			Logger.warn("[GroundingDiscovery] Failed to build workspace index:", e)
		}
		return index
	}

	private async batchPopulateStats(
		cwd: string,
		files: string[],
		index: Map<string, { size: number; mtime: string }>,
	): Promise<void> {
		const CONCURRENCY = GroundingDiscovery.getAdaptiveConcurrency(index.size)
		for (let i = 0; i < files.length; i += CONCURRENCY) {
			const batch = files.slice(i, i + CONCURRENCY)
			await Promise.all(
				batch.map(async (file) => {
					try {
						const fullPath = path.isAbsolute(file) ? file : path.join(cwd, file)
						const stats = await fsp.stat(fullPath)
						index.set(file, {
							size: stats.size,
							mtime: stats.mtime.toISOString().split("T")[0] || "unknown",
						})
					} catch {
						// skip if file removed since index start
					}
				}),
			)
		}
	}

	async discoverRelevantContext(
		intent: string,
		cwd: string,
		streamId?: string,
		knowledgeGraph?: KnowledgeGraphService,
		anchors?: string[],
	): Promise<string> {
		if (typeof intent !== "string" || !intent) return ""
		try {
			// Phase 5: Anchor Injection - Force critical files into context
			let saturatedContext = ""
			if (anchors && anchors.length > 0) {
				saturatedContext += `\n### Primary Inherited Anchors:\n`
				saturatedContext += `${anchors.map((a) => `- ${a}`).join("\n")}\n`
			}

			// Phase 3: Swarm Memory Lookup - proactively load neighbor findings
			if (streamId) {
				const { orchestrator } = await import("@/infrastructure/ai/Orchestrator")
				const findings = await orchestrator.getSwarmFindings(streamId)

				if (findings.length > 0) {
					saturatedContext += `\n### Predictive Swarm Insights (Shared Findings):\n`
					saturatedContext += `${findings.map((f) => `- ${f}`).join("\n")}\n`
				}
			}

			// Pass 5: KG-First Blocking Path
			if (knowledgeGraph && streamId) {
				const semanticMatches = await knowledgeGraph.searchKnowledge(streamId, intent, {
					augmentWithGraph: true,
					limit: 5,
				})

				const validatedNodes = await Promise.all(
					semanticMatches.map(async (n) => {
						const isStale = await this.isNodeStale(cwd, n, knowledgeGraph)
						if (isStale) {
							this.triggerBackgroundRefresh(n, cwd, knowledgeGraph)
							return { ...n, similarity: n.similarity * 0.5, isStale: true }
						}
						return { ...n, isStale: false }
					}),
				)

				const highConfNodes = validatedNodes.filter((n) => n.similarity > 0.45 || (n.similarity > 0.95 && !n.isStale))

				if (highConfNodes.length > 0) {
					Logger.info(`[GroundingDiscovery] KG-First: Found ${highConfNodes.length} matches (Drift-Checked).`)
					saturatedContext += `\n### High-Confidence Semantic Landmarks:\n`
					saturatedContext += `${highConfNodes
						.map((n) => {
							const staleWarning = n.isStale ? " [STALE - MODIFIED]" : ""
							return `- ${n.content}${staleWarning} (Ref: ${n.id})`
						})
						.join("\n")}\n`

					// Phase 5: Multi-Factor Satiety Metric
					// Satiety is reached if:
					// 1. We have an extremely high precision match (>0.98) that is fresh.
					// 2. We have 3+ high precision matches (>0.90) that are all fresh.
					const landmarkSatiety = validatedNodes.some((n) => n.similarity > 0.98 && !n.isStale)
					const coverageSatiety = validatedNodes.filter((n) => n.similarity > 0.9 && !n.isStale).length >= 3

					if (landmarkSatiety || coverageSatiety) {
						Logger.info(
							`[GroundingDiscovery] Fast-KG Satiety reached (${landmarkSatiety ? "Landmark" : "Coverage"}). Bypassing Ripgrep.`,
						)
						return saturatedContext
					}
				}
			}

			// Optimization: Naive keywords for speculative KG discovery
			const naiveKeywords = intent.split(/\W+/).filter((w) => typeof w === "string" && w.length > 4)

			// Start speculative discovery and LLM keyword extraction in parallel
			const kgPromise =
				knowledgeGraph && streamId
					? this.speculativeKgDiscovery(intent, streamId, knowledgeGraph, naiveKeywords)
					: Promise.resolve("")

			const keywordsPromise = this.extractKeywords(intent, cwd)

			// Parallelize Speculative KG lookup and Keyword extraction
			const [speculativeKgContext, keywords] = await Promise.all([kgPromise, keywordsPromise])

			// Phase 5: Affinity Promotion - Merge results with weighted ranking
			if (speculativeKgContext) {
				saturatedContext += `\n### Predictive File Affinities (Speculative):\n${speculativeKgContext}\n`
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
				const controller = new AbortController()
				const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT)

				try {
					// Pass 2: Multiplexed Ripgrep - Search keywords in a single batch
					keywordResults = await searchFilesWithSnippetsBatch(keywords, cwd, 3, 2, controller.signal)
				} catch (e) {
					Logger.warn("[GroundingDiscovery] Multiplexed search failed or timed out, falling back to empty:", e)
					keywordResults = {}
				} finally {
					clearTimeout(timeoutId)
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

			if (enrichedSnippets.length === 0) return saturatedContext

			const contextLines: string[] = ["### Semantic Discovery Results (Top Ranked with Metadata):"]
			for (const snip of enrichedSnippets) {
				const metaParts = []
				if (snip.metadata) {
					metaParts.push(`Size: ${snip.metadata.size}b`)
					metaParts.push(`Mod: ${snip.metadata.mtime}`)
					if (snip.metadata.interfaceSummary) {
						metaParts.push(`Interface: ${snip.metadata.interfaceSummary}`)
					}
				}
				const meta = metaParts.length > 0 ? ` [${metaParts.join(", ")}]` : ""
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
					const content = await fsp.readFile(filePath, "utf-8")
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

	private async isNodeStale(
		cwd: string,
		node: { id: string; content: string; metadata?: Record<string, any> },
		knowledgeGraph: KnowledgeGraphService,
	): Promise<boolean> {
		try {
			// Phase 4.1: Path Robustness - Use metadata path if available
			const filePath = node.metadata?.path || node.content.split("\n")[0]?.trim()
			if (!filePath || !filePath.includes(".")) return false

			const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath)

			// Phase 4.1: I/O Shortcut - Check mtime/size from session cache first
			const index = GroundingDiscovery.workspaceIndexCache.get(cwd)
			const cachedMeta = index?.get(filePath) || index?.get(path.relative(cwd, fullPath))

			if (cachedMeta && node.metadata?.mtime === cachedMeta.mtime && node.metadata?.size === cachedMeta.size) {
				return false // Metadata match, assume fresh
			}

			// Phase 4.1: I/O Guard - Skip hashing for massive files (> 1MB) during discovery
			let stats = GroundingDiscovery.statCache.get(fullPath)
			if (!stats) {
				stats = await fsp.stat(fullPath)
				GroundingDiscovery.statCache.set(fullPath, stats)
			}

			if (stats.size > 1024 * 1024) {
				Logger.info(`[GroundingDiscovery] Skipping hash check for large file: ${filePath} (${stats.size}b)`)
				return node.metadata?.size !== stats.size // Fallback to size-only check
			}

			const content = await fsp.readFile(fullPath, "utf-8")
			const currentHash = knowledgeGraph.calculateHash(content)

			return node.metadata?.hash !== currentHash
		} catch {
			return true // If file missing or error, consider stale
		}
	}

	private triggerBackgroundRefresh(
		node: { id: string; content: string; metadata?: Record<string, any> },
		cwd: string,
		knowledgeGraph: KnowledgeGraphService,
	): void {
		// Phase 4.1: Concurrency Guard - Don't start duplicate refreshes
		if (GroundingDiscovery.refreshingNodes.has(node.id)) return
		GroundingDiscovery.refreshingNodes.add(node.id)

		// Background execution to avoid blocking discovery
		;(async () => {
			try {
				const filePath = node.metadata?.path || node.content.split("\n")[0]?.trim()
				if (!filePath) return

				const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath)
				const stats = await fsp.stat(fullPath)
				const freshContent = await fsp.readFile(fullPath, "utf-8")

				// Update with fresh content, new hash, and mtime
				await knowledgeGraph.updateKnowledge(node.id, {
					content: freshContent,
					metadata: {
						...node.metadata,
						path: filePath,
						hash: knowledgeGraph.calculateHash(freshContent),
						mtime: stats.mtime.toISOString().split("T")[0] || "unknown",
						size: stats.size,
					},
				})
				Logger.info(`[GroundingDiscovery] Refreshed stale KG node: ${node.id} (${filePath})`)
			} catch (e) {
				Logger.warn(`[GroundingDiscovery] Background KG refresh failed for ${node.id}:`, e)
			} finally {
				GroundingDiscovery.refreshingNodes.delete(node.id)
			}
		})().catch(() => {})
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
		if (pathMatch) {
			pathMatch.forEach((p) => {
				keywords.add(p)
			})
		}

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
	): Promise<
		{
			path: string
			snippets: string[]
			score: number
			metadata?: { size: number; mtime: string; interfaceSummary?: string }
		}[]
	> {
		const index = GroundingDiscovery.workspaceIndexCache.get(cwd)
		const CONCURRENCY = GroundingDiscovery.getAdaptiveConcurrency(index?.size || 0)
		const results: { path: string; snippets: string[]; score: number; metadata?: any }[] = []

		for (let i = 0; i < snippets.length; i += CONCURRENCY) {
			const batch = snippets.slice(i, i + CONCURRENCY)
			const enrichedBatch = await Promise.all(
				batch.map(async (snip) => {
					try {
						const fullPath = path.join(cwd, snip.path)
						const cacheKey = fullPath

						// Pass 5: Add interface summary with per-file circuit breaker
						const SUMMARIZER_TIMEOUT = 1000
						const interfaceSummary = await Promise.race([
							InterfaceSummarizer.summarize(fullPath),
							new Promise<string>((resolve) =>
								setTimeout(() => resolve("[Summary timed out]"), SUMMARIZER_TIMEOUT),
							),
						])

						// Pass 3: Use Workspace Index if available
						const indexedMeta = index?.get(snip.path)
						if (indexedMeta) {
							return {
								...snip,
								metadata: {
									size: indexedMeta.size,
									mtime: indexedMeta.mtime,
									interfaceSummary,
								},
							}
						}

						let stats = GroundingDiscovery.statCache.get(cacheKey)
						if (!stats) {
							stats = await fsp.stat(fullPath)
							GroundingDiscovery.statCache.set(cacheKey, stats)
						}

						return {
							...snip,
							metadata: {
								size: stats.size,
								mtime: stats.mtime.toISOString().split("T")[0],
								interfaceSummary,
							},
						}
					} catch {
						return snip
					}
				}),
			)
			results.push(...enrichedBatch)
		}
		return results
	}

	private async globMdFiles(dir: string, currentDepth = 0): Promise<string[]> {
		const files: string[] = []
		// Hardening: Prevent too deep search for rules
		const MAX_RULE_DEPTH = 2
		if (currentDepth > MAX_RULE_DEPTH) return []
		try {
			const entries = await fsp.readdir(dir, { withFileTypes: true })
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
