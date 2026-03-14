import fs from "fs/promises"
import * as path from "path"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { searchFilesWithKeyword } from "@/services/search/file-search"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"
import { GROUNDING_SYSTEM_PROMPT, GroundedSpec, GroundedSpecSchema } from "./types"

/**
 * A simple LRU (Least Recently Used) cache implementation.
 * Uses Map's insertion order to maintain LRU property efficiently.
 */
class LRUCache<K, V> {
	private cache = new Map<K, V>()
	private readonly capacity: number

	constructor(capacity: number) {
		this.capacity = capacity
	}

	get(key: K): V | undefined {
		const value = this.cache.get(key)
		if (value !== undefined) {
			this.cache.delete(key)
			this.cache.set(key, value)
		}
		return value
	}

	set(key: K, value: V): void {
		if (this.cache.has(key)) {
			this.cache.delete(key)
		} else if (this.cache.size >= this.capacity) {
			const oldestKey = this.cache.keys().next().value
			if (oldestKey !== undefined) {
				this.cache.delete(oldestKey)
			}
		}
		this.cache.set(key, value)
	}

	clear(): void {
		this.cache.clear()
	}
}

export class IntentGrounder {
	private apiHandler: ApiHandler

	// Static caches shared across instances for maximum throughput
	private static specCache = new LRUCache<string, GroundedSpec>(50)
	private static rgCache = new LRUCache<string, { results: Record<string, string[]>; timestamp: number }>(20)
	private static readonly RG_CACHE_TTL_MS = 30000 // 30 second TTL for file discovery

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
	}

	async ground(intent: string, context?: string, cwd?: string, streamId?: string): Promise<GroundedSpec> {
		const startTime = Date.now()

		// Attempt cache retrieval
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
		let projectRules = ""
		let discoveredContext = ""

		if (cwd) {
			// Optimization: Load rules and discover context in parallel
			const [rules, discoContext] = await Promise.all([
				this.loadProjectRules(cwd),
				this.discoverRelevantContext(intent, cwd),
			])
			projectRules = rules
			discoveredContext = discoContext
		}

		const userContent =
			`Ground this intent: ${intent}` +
			(context ? `\n\nEnvironment Context:\n${context}` : "") +
			(discoveredContext ? `\n\nDiscovered Semantic Context:\n${discoveredContext}` : "") +
			(projectRules ? `\n\nProject Rules (.codemarierules):\n${projectRules}` : "")

		const messages: CodemarieStorageMessage[] = [
			{
				role: "user",
				content: [{ type: "text", text: userContent }],
			},
		]

		try {
			Logger.info(`[IntentGrounder] Grounding intent: ${intent.substring(0, 100)}...`)
			const { spec: rawSpec, tokens } = await this.executeGroundingRequest(systemPrompt, messages)

			// Pass 5: Autonomous Validation & Verification
			let validatedSpec = GroundedSpecSchema.parse(rawSpec)

			if (cwd) {
				validatedSpec = await this.verifyEntities(validatedSpec, cwd)
			}

			// Optimization: Only run self-critique if confidence is low to improve throughput
			let finalSpec = validatedSpec
			if (validatedSpec.confidenceScore < 0.7) {
				Logger.info("[IntentGrounder] Confidence low, performing self-critique...")
				finalSpec = await this.selfCritique(validatedSpec, intent)
			}

			// Finalize telemetry
			const durationMs = Date.now() - startTime
			finalSpec.telemetry = {
				durationMs,
				tokensIn: tokens.input,
				tokensOut: tokens.output,
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
			Logger.error("[IntentGrounder] Grounding failed:", error)
			throw error
		}
	}

	private generateCacheKey(intent: string, context?: string, cwd?: string): string {
		const modelId = this.apiHandler.getModel().id
		return `${modelId}|${cwd || "no-cwd"}|${intent}|${context || ""}`
	}

	private async persistToMemory(streamId: string, intent: string, spec: GroundedSpec): Promise<void> {
		await orchestrator.storeMemory(streamId, "last_grounding_spec", JSON.stringify(spec))
		await orchestrator.storeMemory(streamId, "last_intent", intent)
		await orchestrator.storeMemory(streamId, "grounding_telemetry", JSON.stringify(spec.telemetry))
	}

	private async executeGroundingRequest(
		systemPrompt: string,
		messages: CodemarieStorageMessage[],
	): Promise<{ spec: any; tokens: { input: number; output: number } }> {
		const stream = this.apiHandler.createMessage(systemPrompt, messages)
		let fullResponse = ""
		let reasoning = ""

		const TIMEOUT_MS = 30000 // 30 second timeout for grounding pass
		let isTimedOut = false
		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(() => {
				isTimedOut = true
				this.apiHandler.abort?.()
				reject(new Error("Grounding request timed out"))
			}, TIMEOUT_MS),
		)

		try {
			const processStream = async () => {
				for await (const chunk of stream) {
					if (isTimedOut) break
					switch (chunk.type) {
						case "text":
							fullResponse += chunk.text
							break
						case "reasoning":
							reasoning += chunk.reasoning
							break
					}
				}
			}

			await Promise.race([processStream(), timeoutPromise])
		} catch (error) {
			if (error instanceof Error && error.message === "Grounding request timed out") {
				Logger.error("[IntentGrounder] Grounding request timed out")
				throw error
			}
			throw error
		}

		if (reasoning) {
			Logger.debug(`[IntentGrounder] Model reasoning: ${reasoning.substring(0, 200)}...`)
		}

		// Hardened JSON parsing to handle markdown blocks and extra text
		let jsonCandidate = fullResponse
		const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/
		const match = fullResponse.match(codeBlockRegex)
		if (match) {
			jsonCandidate = match[1]
		}

		const firstOpen = jsonCandidate.indexOf("{")
		const lastClose = jsonCandidate.lastIndexOf("}")

		if (firstOpen === -1 || lastClose === -1 || firstOpen > lastClose) {
			Logger.error("[IntentGrounder] No valid JSON found in response")
			throw new Error("No valid JSON found in grounding response")
		}

		jsonCandidate = jsonCandidate.substring(firstOpen, lastClose + 1)

		try {
			return {
				spec: JSON.parse(jsonCandidate),
				tokens: { input: 0, output: 0 },
			}
		} catch (e) {
			Logger.error("[IntentGrounder] Failed to parse JSON candidate")
			throw new Error(`Failed to parse grounding JSON: ${e instanceof Error ? e.message : String(e)}`)
		}
	}

	private async verifyEntities(spec: GroundedSpec, cwd: string): Promise<GroundedSpec> {
		const verifiedEntities: string[] = []
		const missingEntities: string[] = []
		const entitiesToVerify = [
			...spec.decisionVariables.flatMap((v) => v.range || []),
			...spec.constraints.flatMap((c) => c.match(/[a-zA-Z0-9_\-./]+\.[a-z]{2,4}/g) || []),
		]

		const uniqueEntities = [...new Set(entitiesToVerify)]
		await Promise.all(
			uniqueEntities.map(async (entity) => {
				try {
					const fullPath = path.isAbsolute(entity) ? entity : path.join(cwd, entity)
					await fs.access(fullPath)
					verifiedEntities.push(entity)
				} catch {
					missingEntities.push(entity)
				}
			}),
		)

		spec.verifiedEntities = verifiedEntities

		// Hardened verification: Explicitly document missing entities
		if (missingEntities.length > 0 && spec.confidenceScore > 0.3) {
			spec.confidenceScore *= 0.9
			const missingList = missingEntities.join(", ")
			spec.ambiguityReasoning = `${spec.ambiguityReasoning || ""} The following referenced files were not found in the workspace: ${missingList}.`

			if (!spec.missingInformation) spec.missingInformation = []
			spec.missingInformation.push(`Please confirm the location or creation of these files: ${missingList}`)
		}

		return spec
	}

	private async selfCritique(spec: GroundedSpec, intent: string): Promise<GroundedSpec> {
		const reflectionPrompt = `You are a critical reviewer. Review the following Grounded Specification against the User Intent.
User Intent: "${intent}"
Proposed Spec: ${JSON.stringify(spec, null, 2)}

Return the spec with any necessary fixes to "rules" or "constraints" to improve accuracy.
STRICTLY return the JSON for the spec.`

		try {
			const { spec: critiqued } = await this.executeGroundingRequest("Follow instructions carefully.", [
				{ role: "user", content: [{ type: "text", text: reflectionPrompt }] },
			])
			return GroundedSpecSchema.parse(critiqued)
		} catch (e) {
			Logger.warn("[IntentGrounder] Self-critique failed, falling back to original spec", e)
			return spec
		}
	}

	private async discoverRelevantContext(intent: string, cwd: string): Promise<string> {
		try {
			const keywords = intent
				.split(/\W+/)
				.filter((w) => w.length > 4 && !["function", "variable", "refactor", "change"].includes(w.toLowerCase()))
				.sort((a, b) => b.length - a.length)
				.slice(0, 3)

			if (keywords.length === 0) {
				return ""
			}

			// Optimization: Cache ripgrep results with TTL to avoid redundant heavy I/O
			const now = Date.now()
			const cached = IntentGrounder.rgCache.get(cwd)
			let keywordResults: Record<string, string[]> = {}

			if (cached && now - cached.timestamp < IntentGrounder.RG_CACHE_TTL_MS) {
				keywordResults = cached.results
			} else {
				// True Semantic Discovery: Search file contents for keywords
				const searchPromises = keywords.map(async (word) => {
					try {
						const files = await searchFilesWithKeyword(word, cwd, 5) // Limit to 5 files per keyword
						return { word, files }
					} catch {
						return { word, files: [] }
					}
				})

				const results = await Promise.all(searchPromises)
				for (const { word, files } of results) {
					keywordResults[word] = files
				}

				IntentGrounder.rgCache.set(cwd, { results: keywordResults, timestamp: now })
			}

			const contextLines: string[] = []
			for (const word of keywords) {
				const files = keywordResults[word]
				if (files && files.length > 0) {
					contextLines.push(`- Files containing "${word}": ${files.join(", ")}`)
				}
			}

			return contextLines.join("\n")
		} catch (error) {
			Logger.error("[IntentGrounder] Semantic discovery failed:", error)
			return ""
		}
	}

	private async loadProjectRules(cwd: string): Promise<string> {
		try {
			const rulesDir = path.join(cwd, ".codemarierules")
			const entries = await fs.readdir(rulesDir).catch(() => [])
			const mdFiles = entries.filter((entry) => entry.endsWith(".md"))

			const ruleContents = await Promise.all(
				mdFiles.map(async (entry) => {
					const content = await fs.readFile(path.join(rulesDir, entry), "utf-8")
					return `--- ${entry} ---\n${content.substring(0, 300)}${content.length > 300 ? "..." : ""}\n\n`
				}),
			)

			return ruleContents.join("").trim()
		} catch (error) {
			Logger.error("[IntentGrounder] Failed to load project rules:", error)
			return ""
		}
	}
}

export type { GroundedSpec } from "./types"
