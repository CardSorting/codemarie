import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { dbPool } from "@/infrastructure/db/BufferedDbPool"
import { FileSnippet, searchFilesWithSnippets, searchSymbolInFiles } from "@/services/search/file-search"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"
import { KnowledgeGraphService } from "../context/KnowledgeGraphService"
import { GROUNDING_SYSTEM_PROMPT, GroundedSpec, GroundedSpecSchema } from "./types"

interface CacheEntry<V> {
	value: V
	timestamp: number
}

/**
 * A hardened LRU (Least Recently Used) cache implementation with TTL and key hashing.
 * Uses Map's insertion order to maintain LRU property efficiently.
 */
class LRUCache<V> {
	private cache = new Map<string, CacheEntry<V>>()
	private readonly capacity: number
	private readonly ttlMs: number
	private pruneInterval?: NodeJS.Timeout

	constructor(capacity: number, ttlMs = 0) {
		this.capacity = capacity
		this.ttlMs = ttlMs

		// Hardening: Periodic pruning to avoid memory leaks from expired but unaccessed entries
		if (this.ttlMs > 0) {
			this.pruneInterval = setInterval(() => this.prune(), Math.min(this.ttlMs, 600000))
			// Ensure interval doesn't keep process alive in environments like VSCode extension host
			if (this.pruneInterval.unref) {
				this.pruneInterval.unref()
			}
		}
	}

	private prune(): void {
		const now = Date.now()
		for (const [key, entry] of this.cache.entries()) {
			if (now - entry.timestamp > this.ttlMs) {
				this.cache.delete(key)
			}
		}
	}

	get(key: string): V | undefined {
		const entry = this.cache.get(key)
		if (entry === undefined) return undefined

		// TTL check
		if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
			this.cache.delete(key)
			return undefined
		}

		// Move to end (most recently used)
		this.cache.delete(key)
		this.cache.set(key, entry)
		return entry.value
	}

	/**
	 * Check if key exists without updating LRU order.
	 */
	has(key: string): boolean {
		const entry = this.cache.get(key)
		if (!entry) return false
		if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
			this.cache.delete(key)
			return false
		}
		return true
	}

	/**
	 * Retrieve value without updating LRU order.
	 */
	peek(key: string): V | undefined {
		const entry = this.cache.get(key)
		if (!entry) return undefined
		if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
			this.cache.delete(key)
			return undefined
		}
		return entry.value
	}

	set(key: string, value: V): void {
		if (this.cache.has(key)) {
			this.cache.delete(key)
		} else if (this.cache.size >= this.capacity) {
			const oldestKey = this.cache.keys().next().value
			if (oldestKey !== undefined) {
				this.cache.delete(oldestKey)
			}
		}
		this.cache.set(key, { value, timestamp: Date.now() })
	}

	clear(): void {
		this.cache.clear()
	}

	dispose(): void {
		if (this.pruneInterval) {
			clearInterval(this.pruneInterval)
		}
	}
}

export class IntentGrounder {
	private apiHandler: ApiHandler

	// Static caches shared across instances for maximum throughput
	// specCache: 5 minute TTL to allow for codebase changes
	private static specCache = new LRUCache<GroundedSpec>(50, 300000)
	// rgCache: 1 minute TTL for ripgrep results
	private static rgCache = new LRUCache<Record<string, FileSnippet[]>>(20, 60000)
	// rulesCache: 10 minute TTL for project rules to avoid heavy I/O
	private static rulesCache = new LRUCache<string>(10, 600000)
	// keywordCache: 1 hour TTL for extracted keywords (stable per intent)
	private static keywordCache = new LRUCache<string[]>(100, 3600000)

	constructor(apiHandler: ApiHandler) {
		this.apiHandler = apiHandler
	}

	/**
	 * Clears all grounding and discovery caches.
	 * Useful for testing or manual cache invalidation.
	 */
	static clearCache(): void {
		IntentGrounder.specCache.clear()
		IntentGrounder.rgCache.clear()
		IntentGrounder.rulesCache.clear()
		IntentGrounder.keywordCache.clear()
	}

	async ground(
		intent: string,
		context?: string,
		cwd?: string,
		streamId?: string,
		knowledgeGraph?: KnowledgeGraphService,
	): Promise<GroundedSpec> {
		const startTime = Date.now()

		// Attempt cache retrieval with hashed key
		const cacheKey = this.generateCacheKey(intent, context, cwd)
		const cachedSpec = IntentGrounder.specCache.get(cacheKey)
		if (cachedSpec) {
			Logger.info(`[IntentGrounder] Cache hit for intent: ${intent.substring(0, 50)}...`)

			// Update telemetry for cache hit
			const finalSpec = {
				...cachedSpec,
				telemetry: {
					...cachedSpec.telemetry,
					durationMs: Date.now() - startTime,
					tokensIn: 0,
					tokensOut: 0,
					isCacheHit: true,
				},
			}

			// Still persist to memory if requested
			if (streamId) {
				await this.persistToMemory(streamId, intent, finalSpec)
			}
			return finalSpec
		}

		const systemPrompt = GROUNDING_SYSTEM_PROMPT

		// Optimization: Parallelize all discovery steps
		// 1. Project Rules (Cached)
		// 2. Semantic Context (includes Keyword Extraction)

		const [projectRules, discoveredContext] = await Promise.all([
			cwd ? this.loadProjectRules(cwd) : Promise.resolve(""),
			cwd
				? Promise.race([
						this.discoverRelevantContext(intent, cwd, streamId, knowledgeGraph),
						new Promise<string>((resolve) => setTimeout(() => resolve(""), 15000)),
					])
				: Promise.resolve(""),
		])

		// Phase 4: Extreme Hardening - Prompt Shaving
		// If the context is over 20k chars, we begin aggressive truncation of non-essential snippets
		let finalContext = context || ""
		let finalDiscovered = discoveredContext || ""
		const finalRules = projectRules || ""

		const CONTEXT_BUDGET = 25000
		const totalLength = intent.length + finalContext.length + finalDiscovered.length + finalRules.length

		if (totalLength > CONTEXT_BUDGET) {
			Logger.info(`[IntentGrounder] Context budget exceeded (${totalLength} chars). Shaving prompt...`)
			// 1. Shave Environment Context (keep only last few entries if it was large)
			if (finalContext.length > 5000) finalContext = finalContext.substring(0, 5000) + "\n[... truncated ...]"
			// 2. Shave Discovered Context (most expensive but already has top 8 ranking, so we just take top 4)
			if (finalDiscovered.length > 10000) {
				const sections = finalDiscovered.split("File: ")
				finalDiscovered = sections.slice(0, 5).join("File: ") + "\n[... aggressive shaving internal ...]"
			}
		}

		const userContent =
			`Ground this intent: ${intent}` +
			(finalContext ? `\n\nEnvironment Context:\n${finalContext}` : "") +
			(finalDiscovered ? `\n\nDiscovered Semantic Context (ripgrep snippets):\n${finalDiscovered}` : "") +
			(finalRules ? `\n\nProject Rules (.codemarierules):\n${finalRules}` : "")

		const messages: CodemarieStorageMessage[] = [
			{
				role: "user",
				content: [{ type: "text", text: userContent }],
			},
		]

		try {
			Logger.info(`[IntentGrounder] Grounding intent: ${intent.substring(0, 100)}...`)
			const { spec: rawSpec, tokens } = await this.executeGroundingRequest(systemPrompt, messages)

			// Phase 3: Autonomous Validation & Verification with Graceful Resilience
			let validatedSpec: GroundedSpec
			try {
				validatedSpec = GroundedSpecSchema.parse(rawSpec)
			} catch (validationError) {
				Logger.warn("[IntentGrounder] Schema validation failed, attempting to heal spec", validationError)
				validatedSpec = this.healSpec(rawSpec)
			}

			if (cwd) {
				validatedSpec = await this.verifyEntities(validatedSpec, cwd)
			}

			// Optimization: Only run self-critique if confidence is low to improve throughput
			let finalSpec = validatedSpec
			let critiqueTokens = { input: 0, output: 0 }
			if (validatedSpec.confidenceScore < 0.7) {
				Logger.info("[IntentGrounder] Confidence low, performing self-critique...")
				try {
					const { spec: critiqued, tokens: t } = await this.selfCritique(validatedSpec, intent)
					finalSpec = critiqued
					critiqueTokens = t
				} catch (critiqueError) {
					Logger.warn("[IntentGrounder] Self-critique failed, proceeding with validated spec", critiqueError)
				}
			}

			// Finalize telemetry
			const durationMs = Date.now() - startTime
			finalSpec.telemetry = {
				durationMs,
				tokensIn: tokens.input + critiqueTokens.input,
				tokensOut: tokens.output + critiqueTokens.output,
				model: this.apiHandler.getModel().id,
				isCacheHit: false,
			}

			// Orchestrator Integration: Store grounding in memory
			if (streamId) {
				await this.persistToMemory(streamId, intent, finalSpec)
			}

			// Cache the result before returning
			IntentGrounder.specCache.set(cacheKey, finalSpec)

			Logger.info(
				`[IntentGrounder] Successfully grounded intent in ${durationMs}ms (Confidence: ${finalSpec.confidenceScore}).`,
			)
			return finalSpec
		} catch (error) {
			Logger.error("[IntentGrounder] Grounding failed completely:", error)
			// Last resort: return a minimal safe spec to avoid breaking the task loop
			return {
				decisionVariables: [],
				constraints: [],
				outputStructure: {},
				rules: [],
				confidenceScore: 0.1,
				ambiguityReasoning: `Grounding failed: ${error instanceof Error ? error.message : String(error)}`,
				missingInformation: ["The system failed to structure your intent. Please try rephrasing."],
				telemetry: {
					durationMs: Date.now() - startTime,
					model: this.apiHandler.getModel().id,
					isCacheHit: false,
				},
			}
		}
	}

	private generateCacheKey(intent: string, context?: string, cwd?: string): string {
		const modelId = this.apiHandler.getModel().id
		// Hardening: Normalize context to ignore insignificant changes (whitespace, line endings)
		const normalizedContext = context ? context.trim().replace(/\r\n/g, "\n").replace(/\s+/g, " ") : ""
		const rawKey = `${modelId}|${cwd || "no-cwd"}|${intent}|${normalizedContext}`
		return crypto.createHash("sha256").update(rawKey).digest("hex")
	}

	private async persistToMemory(streamId: string, intent: string, spec: GroundedSpec): Promise<void> {
		await orchestrator.storeMemory(streamId, "last_grounding_spec", JSON.stringify(spec))
		await orchestrator.storeMemory(streamId, "last_intent", intent)
		await orchestrator.storeMemory(streamId, "grounding_telemetry", JSON.stringify(spec.telemetry))
		// Deep Hardening: Commit critical grounding metadata immediately to prevent loss in case of crash
		try {
			await dbPool.commitWork(streamId)
		} catch (e) {
			Logger.error("[IntentGrounder] Failed to commit grounding metadata:", e)
		}
	}

	private healSpec(raw: any): GroundedSpec {
		const healed: GroundedSpec = {
			decisionVariables: Array.isArray(raw.decisionVariables) ? raw.decisionVariables : [],
			constraints: Array.isArray(raw.constraints) ? raw.constraints : [],
			outputStructure: typeof raw.outputStructure === "object" ? raw.outputStructure : {},
			rules: Array.isArray(raw.rules) ? raw.rules : [],
			confidenceScore: typeof raw.confidenceScore === "number" ? Math.min(1, Math.max(0, raw.confidenceScore)) : 0.5,
			ambiguityReasoning: raw.ambiguityReasoning || "Spec was automatically healed after validation failure.",
			missingInformation: Array.isArray(raw.missingInformation) ? raw.missingInformation : [],
		}

		// Intelligent Repair: If decisionVariables is missing but rules mention files, try to extract them
		if (healed.decisionVariables.length === 0 && healed.rules.length > 0) {
			const potentialFiles = new Set<string>()
			healed.rules.forEach((r) => {
				const matches = r.match(/[a-zA-Z0-9_\-./]+\.[a-z]{2,5}/g)
				if (matches) matches.forEach((m) => potentialFiles.add(m))
			})

			if (potentialFiles.size > 0) {
				healed.decisionVariables = Array.from(potentialFiles).map((f) => ({
					name: path.basename(f),
					description: `Healed path: ${f}`,
					range: [f],
				}))
				healed.ambiguityReasoning += " Infused decision variables from rules."
			}
		}

		return healed
	}

	private async executeGroundingRequest(
		systemPrompt: string,
		messages: CodemarieStorageMessage[],
	): Promise<{ spec: any; tokens: { input: number; output: number } }> {
		const stream = this.apiHandler.createMessage(systemPrompt, messages)
		let fullResponse = ""
		let reasoning = ""

		const TIMEOUT_MS = 45000 // Increased to 45 seconds for complex grounding
		let isTimedOut = false
		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(() => {
				isTimedOut = true
				this.apiHandler.abort?.()
				reject(new Error("Grounding request timed out"))
			}, TIMEOUT_MS),
		)
		const processStream = async () => {
			for await (const chunk of stream) {
				if (isTimedOut) break
				switch (chunk.type) {
					case "text":
						fullResponse += chunk.text

						// OPTIMISTIC EXTRACTION: Speed up by terminating early if we have a valid spec
						// Check every 200 chars to avoid excessive parsing overhead
						if (fullResponse.length > 500 && fullResponse.includes("}")) {
							const lastChars = fullResponse.slice(-10).trim()
							if (lastChars.endsWith("}") || lastChars.endsWith("```")) {
								try {
									// Attempt a quick parse of the current buffer
									const spec = this.quickExtractJson(fullResponse)
									if (spec && spec.decisionVariables && typeof spec.confidenceScore === "number") {
										Logger.info("[IntentGrounder] Optimistic Extraction triggered: Spec complete.")
										this.apiHandler.abort?.()
										return
									}
								} catch {
									/* Not a complete JSON object yet */
								}
							}
						}
						break
					case "reasoning":
						reasoning += chunk.reasoning
						break
				}
			}
		}

		await Promise.race([processStream(), timeoutPromise]).catch((err) => {
			// Ignore abort errors if we already have a response
			if (err.name === "AbortError" && fullResponse.length > 0) return
			throw err
		})

		let tokens = { input: 0, output: 0 }
		if (this.apiHandler.getApiStreamUsage) {
			const usage = await this.apiHandler.getApiStreamUsage()
			if (usage) {
				tokens = { input: usage.inputTokens, output: usage.outputTokens }
			}
		}

		if (reasoning) {
			Logger.debug(`[IntentGrounder] Model reasoning: ${reasoning.substring(0, 200)}...`)
		}

		// Robust extraction of JSON from response
		let jsonCandidate = fullResponse.trim()

		// 1. Try to find JSON within markdown code blocks
		const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g
		let match
		let bestMatch = ""
		while ((match = codeBlockRegex.exec(fullResponse)) !== null) {
			// If multiple blocks, we prefer the one that looks like a spec (contains "decisionVariables")
			const block = match[1].trim()
			if (block.includes("decisionVariables") || block.length > bestMatch.length) {
				bestMatch = block
			}
		}

		if (bestMatch) {
			jsonCandidate = bestMatch
		}

		// 2. Locate the outermost curly braces if we have a string candidate
		const firstOpen = jsonCandidate.indexOf("{")
		const lastClose = jsonCandidate.lastIndexOf("}")

		if (firstOpen !== -1 && lastClose !== -1 && firstOpen < lastClose) {
			jsonCandidate = jsonCandidate.substring(firstOpen, lastClose + 1)
		} else {
			// FALLBACK: If no clear braces in the whole block, search the entire fullResponse
			const fOpenGlobal = fullResponse.indexOf("{")
			const lCloseGlobal = fullResponse.lastIndexOf("}")
			if (fOpenGlobal !== -1 && lCloseGlobal !== -1 && fOpenGlobal < lCloseGlobal) {
				jsonCandidate = fullResponse.substring(fOpenGlobal, lCloseGlobal + 1)
			} else {
				Logger.error("[IntentGrounder] No valid JSON markers found in response", {
					responseLength: fullResponse.length,
					preview: fullResponse.substring(0, 500) + "...",
				})
				throw new Error("No valid JSON found in grounding response")
			}
		}

		try {
			// Try parsing the extracted string directly first
			return {
				spec: JSON.parse(jsonCandidate),
				tokens,
			}
		} catch (e) {
			Logger.info("[IntentGrounder] Initial JSON parse failed, attempting intensive repair...")
			try {
				const repaired = this.repairJson(jsonCandidate)
				return {
					spec: JSON.parse(repaired),
					tokens,
				}
			} catch (repairError) {
				Logger.error("[IntentGrounder] JSON repair failed", {
					error: repairError instanceof Error ? repairError.message : String(repairError),
					jsonPreview: jsonCandidate.substring(0, 200) + "...",
				})
				throw new Error(`Failed to parse grounding JSON: ${e instanceof Error ? e.message : String(e)}`)
			}
		}
	}

	private quickExtractJson(fullResponse: string): any | null {
		const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/g.exec(fullResponse)
		let jsonCandidate = codeBlockMatch ? codeBlockMatch[1].trim() : fullResponse.trim()

		const firstOpen = jsonCandidate.indexOf("{")
		const lastClose = jsonCandidate.lastIndexOf("}")

		if (firstOpen !== -1 && lastClose !== -1 && firstOpen < lastClose) {
			jsonCandidate = jsonCandidate.substring(firstOpen, lastClose + 1)
			try {
				return JSON.parse(jsonCandidate)
			} catch {
				try {
					return JSON.parse(this.repairJson(jsonCandidate))
				} catch {
					return null
				}
			}
		}
		return null
	}

	private repairJson(json: string): string {
		// Hardening: Advanced JSON repair logic for LLM-specific failures
		let repaired = json
			.replace(/,\s*([\]}])/g, "$1") // Remove trailing commas
			.replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // Ensure keys are double-quoted
			.replace(/:\s*'([^']*)'/g, ': "$1"') // Replace single quoted values with double quotes
			.replace(/\\'/g, "'") // Fix escaped single quotes
			.replace(/\n/g, "\\n") // Escape literal newlines within strings
			.replace(/\r/g, "\\r")
			.replace(/\t/g, "\\t")
			.replace(/":\s*"([^"]*)"/g, (_, p1) => `": "${p1.replace(/\\n/g, "\n")}"`) // Unescape newlines back in actual string values
			.replace(/\\"/g, '"') // Normalize escaped double quotes
			.replace(/([^\\])"/g, '$1\\"') // Escape all double quotes
			.replace(/\\"/g, '"') // Re-normalize

		// Final pass to ensure structural quotes are NOT escaped
		repaired = repaired.replace(/([^\\])"/g, (m, p1) =>
			p1 === ":" || p1 === " " || p1 === "{" || p1 === "[" || p1 === "," ? m : `${p1}\\"`,
		)

		// Deep Hardening: Handle unescaped double quotes inside string values that cause parse errors
		// We look for patterns like "key": "value "with" quotes",
		repaired = repaired.replace(/":\s*"([\s\S]*?)"(?=\s*[,}])|":\s*"([\s\S]*?)"$/g, (_, p1, p2) => {
			const content = p1 || p2 || ""
			// Escape any internal double quotes that aren't already escaped
			const escapedContent = content.replace(/(?<!\\)"/g, '\\"')
			return `": "${escapedContent}"`
		})

		return repaired
	}

	private async verifyEntities(spec: GroundedSpec, cwd: string): Promise<GroundedSpec> {
		const verifiedEntities: string[] = []
		const missingEntities: string[] = []
		const entitiesToVerify = [
			...spec.decisionVariables.flatMap((v) => {
				const paths = v.range || []
				// Also check if description looks like a path or symbol
				const match = v.description.match(/[a-zA-Z0-9_\-./]+\.[a-z]{2,4}/)
				if (match) paths.push(match[0])
				return paths
			}),
			...spec.constraints.flatMap((c) => c.match(/[a-zA-Z0-9_\-./]+\.[a-z]{2,4}/g) || []),
		]

		const uniqueEntities = [...new Set(entitiesToVerify)]
		await Promise.all(
			uniqueEntities.map(async (entity) => {
				try {
					const fullPath = path.isAbsolute(entity) ? entity : path.join(cwd, entity)

					// Hardening: Robust distinction between file, directory, and symbol
					if (entity.includes(".") && !entity.match(/\.[a-z0-9]+$/i)) {
						// Likely a symbol reference like AuthService.login or AuthService.ts:login
						const parts = entity.split(/[.:]/)
						const symbol = parts.pop()!
						const fileName = parts.join(".")

						const possibleFiles = [
							fileName,
							`${fileName}.ts`,
							`${fileName}.js`,
							`${fileName}.tsx`,
							`${fileName}.py`,
							`${fileName}.go`,
						]

						// Hardening: Search for symbol across all possible extensions in parallel
						const results = await Promise.all(
							possibleFiles.map(async (pf) => {
								try {
									const stat = await fs.stat(path.join(cwd, pf))
									if (stat.isFile()) {
										const matches = await searchSymbolInFiles(symbol, [pf], cwd)
										return matches.length > 0 ? pf : null
									}
								} catch {
									return null
								}
								return null
							}),
						)

						const foundFile = results.find((r) => r !== null)
						if (foundFile) {
							verifiedEntities.push(`${entity} (Symbol verified in ${foundFile})`)
						} else {
							missingEntities.push(entity)
						}
					} else {
						// Normal path check (file or directory)
						const stat = await fs.stat(fullPath)
						if (stat.isDirectory()) {
							verifiedEntities.push(`${entity} (Directory)`)
						} else {
							verifiedEntities.push(`${entity} (File)`)
						}
					}
				} catch {
					// Check if it's a "New File" intent
					const isNewFile = spec.rules.some((r) => r.toLowerCase().includes(`create ${entity.toLowerCase()}`))
					if (isNewFile) {
						verifiedEntities.push(`${entity} (Planned)`)
					} else {
						missingEntities.push(entity)
					}
				}
			}),
		)

		spec.verifiedEntities = verifiedEntities

		// Deep Hardening: Granular confidence score recalibration
		if (uniqueEntities.length > 0) {
			const verificationRate = verifiedEntities.length / uniqueEntities.length

			if (verificationRate < 0.4) {
				spec.confidenceScore *= 0.6
				spec.ambiguityReasoning = `${spec.ambiguityReasoning || ""} Critical risk: most referenced entities are missing.`
			} else if (verificationRate < 0.9) {
				spec.confidenceScore *= 0.85
			}
		}

		if (missingEntities.length > 0) {
			if (spec.confidenceScore > 0.3) {
				spec.confidenceScore *= 0.9
			}
			const missingList = missingEntities.join(", ")
			spec.ambiguityReasoning = `${spec.ambiguityReasoning || ""} The following referenced entities were not verified: ${missingList}.`

			if (!spec.missingInformation) spec.missingInformation = []
			spec.missingInformation.push(
				`Please confirm the existence or path of these entities: ${missingList}. If these are new files, please state that explicitly.`,
			)
		}

		return spec
	}

	private async selfCritique(
		spec: GroundedSpec,
		intent: string,
	): Promise<{ spec: GroundedSpec; tokens: { input: number; output: number } }> {
		const reflectionPrompt = `You are a critical reviewer. Review the following Grounded Specification against the User Intent.
User Intent: "${intent}"
Proposed Spec: ${JSON.stringify(spec, null, 2)}

Critique the specification for:
1. Hallucinated file paths (refer to the snippets provided earlier if any).
2. Missing constraints (e.g., if modifying shared logic, did it specify test updates?).
3. Incomplete output structure.

Return the final, improved spec with any necessary fixes to "rules", "constraints", or "decisionVariables".
Ensure file paths are realistic for the project structure.
STRICTLY return ONLY the JSON for the spec.`

		try {
			const { spec: critiqued, tokens } = await this.executeGroundingRequest("Follow instructions carefully.", [
				{ role: "user", content: [{ type: "text", text: reflectionPrompt }] },
			])
			return { spec: GroundedSpecSchema.parse(critiqued), tokens }
		} catch (e) {
			Logger.warn("[IntentGrounder] Self-critique failed, falling back to original spec", e)
			return { spec, tokens: { input: 0, output: 0 } }
		}
	}

	private async speculativeKgDiscovery(
		intent: string,
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
						related.forEach((r) => correlatedFiles.add(r.path))

						const blast = await knowledgeGraph.calculateBlastRadius(streamId, fk, 1)
						blast.forEach((b) => correlatedFiles.add(b.path))
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
			Logger.warn("[IntentGrounder] Speculative KG discovery failed:", kgError)
		}
		return ""
	}

	private async extractKeywords(intent: string, _cwd: string): Promise<string[]> {
		const cacheKey = `${_cwd}:${intent}`
		const cached = IntentGrounder.keywordCache.get(cacheKey)
		if (cached) return cached

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
			} else if (spec.keywords && Array.isArray(spec.keywords)) {
				keywords = spec.keywords.slice(0, 5)
			}

			// Merge naive and LLM keywords for maximum coverage
			const merged = Array.from(new Set([...keywords, ...naiveKeywords])).slice(0, 7)
			if (merged.length > 0) {
				IntentGrounder.keywordCache.set(cacheKey, merged)
				return merged
			}
			return naiveKeywords
		} catch (e) {
			Logger.warn("[IntentGrounder] Keyword extraction failed, falling back to naive", e)
			return naiveKeywords
		}
	}

	private async discoverRelevantContext(
		intent: string,
		cwd: string,
		streamId?: string,
		knowledgeGraph?: KnowledgeGraphService,
	): Promise<string> {
		try {
			// Optimization: Naive keywords for speculative KG discovery
			const naiveKeywords = intent.split(/\W+/).filter((w) => w.length > 4)

			// Start KG discovery speculatively while waiting for LLM keywords
			const kgPromise =
				knowledgeGraph && streamId
					? this.speculativeKgDiscovery(intent, streamId, knowledgeGraph, naiveKeywords)
					: Promise.resolve("")

			const keywordsPromise = this.extractKeywords(intent, cwd)

			// Parallelize KG lookup and Keyword extraction
			const [kgContext, keywords] = await Promise.all([kgPromise, keywordsPromise])

			if (keywords.length === 0) {
				return kgContext
			}

			// Optimization: Cache ripgrep results with TTL to avoid redundant heavy I/O
			const keywordsKey = crypto.createHash("sha256").update(keywords.sort().join("|")).digest("hex")
			const cacheKey = `${cwd}:${keywordsKey}`

			const cachedResults = IntentGrounder.rgCache.get(cacheKey)
			let keywordResults: Record<string, FileSnippet[]> = {}

			if (cachedResults) {
				keywordResults = cachedResults
			} else {
				// Deep Semantic Discovery: Search file contents for keywords and get snippets
				const searchPromises = keywords.map(async (word) => {
					try {
						// Hardening: Limit search scope to 3 files and 2 snippets per file to save memory/tokens
						const snippets = await searchFilesWithSnippets(word, cwd, 3, 2)
						return { word, snippets: snippets.slice(0, 3) }
					} catch {
						return { word, snippets: [] }
					}
				})

				const results = await Promise.all(searchPromises)
				for (const { word, snippets } of results) {
					keywordResults[word] = snippets
				}

				IntentGrounder.rgCache.set(cacheKey, keywordResults)
			}

			// Extreme Hardening: Global Snippet Ranking
			// We aggregate all snippets and rank them to provide the most dense context
			const allSnippets: { path: string; snippets: string[]; score: number }[] = []
			const seenPaths = new Set<string>()

			for (const word of keywords) {
				const results = keywordResults[word] || []
				for (const snip of results) {
					if (seenPaths.has(snip.path)) {
						// Points for multi-keyword overlap
						const existing = allSnippets.find((s) => s.path === snip.path)
						if (existing) existing.score += 2
						continue
					}

					let score = 1 // Base score
					// Bonus if file path is mentioned in the intent
					if (intent.toLowerCase().includes(path.basename(snip.path).toLowerCase())) {
						score += 5
					}
					// Bonus if it's a "deep" file (likely logic) vs root file
					if (snip.path.includes("/") || snip.path.includes("\\")) {
						score += 1
					}

					allSnippets.push({ ...snip, score })
					seenPaths.add(snip.path)
				}
			}

			const topSnippets = allSnippets.sort((a, b) => b.score - a.score).slice(0, 8) // Limit to top 8 most relevant file contexts

			if (topSnippets.length === 0) return ""

			const contextLines: string[] = ["### Semantic Discovery Results (Top Ranked):"]
			for (const snip of topSnippets) {
				contextLines.push(`File: ${snip.path} (Relevance Score: ${snip.score})`)
				contextLines.push("```")
				contextLines.push(...snip.snippets)
				contextLines.push("```")
			}

			return kgContext + contextLines.join("\n")
		} catch (error) {
			Logger.error("[IntentGrounder] Semantic discovery failed:", error)
			return ""
		}
	}

	private async loadProjectRules(cwd: string): Promise<string> {
		const cachedRules = IntentGrounder.rulesCache.get(cwd)
		if (cachedRules !== undefined) {
			return cachedRules
		}

		try {
			// Hardening: Look in both .codemarierules and .codemarie
			const rulesDirs = [path.join(cwd, ".codemarierules"), path.join(cwd, ".codemarie")]
			const allMdFiles: string[] = []

			for (const dir of rulesDirs) {
				try {
					const files = await this.globMdFiles(dir)
					allMdFiles.push(...files)
				} catch {
					/* ignore */
				}
			}

			if (allMdFiles.length === 0) {
				IntentGrounder.rulesCache.set(cwd, "")
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

						truncated =
							content.substring(0, breakIdx).trim() + "\n\n[... Rule file continues, but truncated for brevity ...]"
					}

					return `--- ${relativePath} ---\n${truncated}\n\n`
				}),
			)

			const finalRules = ruleContents.join("").trim()
			IntentGrounder.rulesCache.set(cwd, finalRules)
			return finalRules
		} catch {
			return ""
		}
	}

	private async globMdFiles(dir: string): Promise<string[]> {
		const files: string[] = []
		try {
			const entries = await fs.readdir(dir, { withFileTypes: true })
			for (const entry of entries) {
				const res = path.resolve(dir, entry.name)
				if (entry.isDirectory()) {
					// Hardening: Prevent infinite recursion or too deep search
					if (!entry.name.startsWith(".")) {
						files.push(...(await this.globMdFiles(res)))
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

export type { GroundedSpec } from "./types"
