import * as crypto from "crypto"
import * as path from "path"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { dbPool } from "@/infrastructure/db/BufferedDbPool"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"
import { KnowledgeGraphService } from "../context/KnowledgeGraphService"
import { LRUCache } from "./GroundingCache"
import { GroundingDiscovery } from "./GroundingDiscovery"
import * as GroundingParser from "./GroundingParser"
import { GroundingValidator } from "./GroundingValidator"
import { GROUNDING_SYSTEM_PROMPT, GroundedSpec, GroundedSpecSchema } from "./types"

export class IntentGrounder {
	private apiHandler: ApiHandler
	private discovery: GroundingDiscovery
	private validator: GroundingValidator

	// Static cache shared across instances for maximum throughput
	// specCache: 5 minute TTL to allow for codebase changes
	private static specCache = new LRUCache<GroundedSpec>(50, 300000)

	constructor(apiHandler: ApiHandler) {
		this.apiHandler = apiHandler
		// Dependency injection of the executeGroundingRequest method to sub-components
		const execRequest = this.executeGroundingRequest.bind(this)
		this.discovery = new GroundingDiscovery(execRequest)
		this.validator = new GroundingValidator(execRequest)
	}

	/**
	 * Clears all grounding and discovery caches.
	 */
	static clearCache(): void {
		IntentGrounder.specCache.clear()
		GroundingDiscovery.clearCache()
	}

	async ground(
		intent: string,
		context?: string,
		cwd?: string,
		streamId?: string,
		knowledgeGraph?: KnowledgeGraphService,
		parentSpec?: GroundedSpec,
	): Promise<GroundedSpec> {
		const startTime = Date.now()

		// Attempt cache retrieval with hashed key
		const cacheKey = this.generateCacheKey(intent, context, cwd)
		const cachedSpec = IntentGrounder.specCache.get(cacheKey)
		if (cachedSpec) {
			Logger.info(`[IntentGrounder] Cache hit for intent: ${intent.substring(0, 50)}...`)

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

			if (streamId) {
				// Don't await non-critical persistence to avoid delaying response
				this.persistToMemory(streamId, intent, finalSpec).catch((e) =>
					Logger.warn("[IntentGrounder] Background persistence failed:", e),
				)
			}
			return finalSpec
		}

		// Phase 5: Swarm Inheritance - Robust Similarity Check
		let synthesizedParentSpec: GroundedSpec | undefined
		if (parentSpec && intent.length > 0) {
			const tokenize = (text: string) =>
				text
					.toLowerCase()
					.split(/[\s.()[\]{}:;'"=<>!+\-*/\\,]+|(?<=[a-z])(?=[A-Z])/)
					.filter((w) => w.length > 3)

			const intentWords = tokenize(intent)
			const parentSearchSpace = [
				parentSpec.ambiguityReasoning || "",
				...parentSpec.constraints,
				...parentSpec.rules,
				...parentSpec.decisionVariables.map((v) => `${v.name} ${v.description}`),
			].join(" ")

			const parentWords = tokenize(parentSearchSpace)

			// If sub-agent intent is very similar to parent's scope, we mark it for synthesis
			const overlap = intentWords.filter((w) => parentWords.includes(w))
			const uniqueOverlap = Array.from(new Set(overlap))
			const matchScore = intentWords.length > 0 ? uniqueOverlap.length / new Set(intentWords).size : 0

			// Threshold: 2 unique technical words or > 40% keyword overlap
			const isSimilar = uniqueOverlap.length >= 2 || (intentWords.length > 0 && matchScore > 0.4)

			if (isSimilar) {
				Logger.info(
					`[IntentGrounder] Swarm Synthesis: Parent context matched (Match: ${(matchScore * 100).toFixed(0)}%). Proceeding with synthesis.`,
				)
				synthesizedParentSpec = parentSpec
			}
		}

		const systemPrompt = GROUNDING_SYSTEM_PROMPT

		// Pass 2: Speculative Execution Pipeline
		// We initiate full discovery and a "fast-track" project rules discovery simultaneously
		const rulesPromise = cwd ? this.discovery.loadProjectRules(cwd) : Promise.resolve("")
		const discoveryTimeout = 2000 // 2 second timeout for Path A (Full Semantic) before Path B (Speculative) starts

		let projectRules = ""
		let discoveredContext = ""

		// Path A: Full semantic discovery
		const anchors = synthesizedParentSpec?.decisionVariables.map((v) => v.name)
		const fullDiscoveryPromise = cwd
			? this.discovery.discoverRelevantContext(intent, cwd, streamId, knowledgeGraph, anchors)
			: Promise.resolve("")

		// Path B: Speculative / Fast Discovery
		// If Path A takes too long, we proceed with project rules only to start LLM grounding early
		const fastDiscoveryResult = await Promise.race([
			fullDiscoveryPromise.then((ctx) => ({ type: "full", ctx })),
			new Promise<{ type: "speculative"; ctx: string }>((resolve) =>
				setTimeout(() => resolve({ type: "speculative", ctx: "" }), discoveryTimeout),
			),
		])

		if (fastDiscoveryResult.type === "speculative") {
			Logger.info("[IntentGrounder] Discovery slow, launching speculative grounding path.")
			projectRules = await rulesPromise
			discoveredContext = ""
		} else {
			projectRules = await rulesPromise
			discoveredContext = fastDiscoveryResult.ctx

			// Pass 3: KG-First check inside full discovery
			if (discoveredContext.includes("High-Confidence Semantic Landmarks")) {
				Logger.info("[IntentGrounder] KG-First: Saturated context detected.")
			}
		}

		// Phase 3: Proactive Workspace Index Pre-loading
		if (cwd) {
			this.discovery.getWorkspaceIndex(cwd).catch((e) => Logger.warn("[IntentGrounder] Index pre-load failed:", e))
		}

		// Pass 5: Token-Aware Shaving
		let finalContext = context || ""
		let finalDiscovered = discoveredContext || ""
		const finalRules = projectRules || ""

		// Estimate tokens instead of character counts for more precision
		const TOKEN_BUDGET = 8000 // Target budget for semantic enrichment
		const estimator = (txt: string) => this.estimateTokens(txt)

		let currentTokens = estimator(intent) + estimator(finalRules) + estimator(finalContext)

		if (currentTokens + estimator(finalDiscovered) > TOKEN_BUDGET) {
			Logger.info(
				`[IntentGrounder] Context budget tight (${currentTokens} estimated tokens). Applying token-aware shaving...`,
			)

			if (finalDiscovered.length > 0) {
				const files = finalDiscovered.split("File: ")
				let shavedDiscovery = files[0] // Headers
				const topFiles = files.slice(1)

				// Phase 5: Intelligent Ranking during Shaving
				// We prioritize files that appear in the intent or have high confidence
				topFiles.sort((a, b) => {
					const aPath = a.split(" [")[0].toLowerCase()
					const bPath = b.split(" [")[0].toLowerCase()
					const aInIntent = intent.toLowerCase().includes(path.basename(aPath))
					const bInIntent = intent.toLowerCase().includes(path.basename(bPath))
					if (aInIntent && !bInIntent) return -1
					if (!aInIntent && bInIntent) return 1
					return 0
				})

				let discoveredTokens = estimator(shavedDiscovery)
				for (let i = 0; i < topFiles.length; i++) {
					const fileText = `File: ${topFiles[i]}`
					const fileTokens = estimator(fileText)
					if (currentTokens + discoveredTokens + fileTokens < TOKEN_BUDGET) {
						shavedDiscovery += fileText
						discoveredTokens += fileTokens
					} else {
						shavedDiscovery += `\n\n[... Additional ${topFiles.length - i} relevant files omitted to fit token budget ...]`
						break
					}
				}
				finalDiscovered = shavedDiscovery
			}

			// If still over, shave environment context lines
			currentTokens = estimator(intent) + estimator(finalRules) + estimator(finalContext) + estimator(finalDiscovered)
			if (currentTokens > TOKEN_BUDGET + 2000) {
				const lines = finalContext.split("\n")
				if (lines.length > 100) {
					finalContext = `${lines.slice(0, 50).join("\n")}\n\n[... Context shaved ...]\n\n${lines.slice(-30).join("\n")}`
				}
			}
		}

		const userContent = [
			`Ground this intent: ${intent}`,
			finalContext ? `\n\nEnvironment Context:\n${finalContext}` : "",
			finalDiscovered ? `\n\nDiscovered Semantic Context (ripgrep snippets):\n${finalDiscovered}` : "",
			finalRules ? `\n\nProject Rules (.codemarierules):\n${finalRules}` : "",
		].join("")

		const messages: CodemarieStorageMessage[] = [
			{
				role: "user",
				content: [{ type: "text", text: userContent }],
			},
		]

		try {
			Logger.info(`[IntentGrounder] Grounding intent: ${intent.substring(0, 100)}...`)
			const { spec: rawSpec, tokens } = await this.executeGroundingRequest(systemPrompt, messages)

			let validatedSpec: GroundedSpec
			try {
				validatedSpec = GroundedSpecSchema.parse(rawSpec)
			} catch (validationError) {
				Logger.warn("[IntentGrounder] Schema validation failed, attempting to heal spec", validationError)
				validatedSpec = this.validator.healSpec(rawSpec)
			}

			let finalSpec = validatedSpec
			let critiqueTokens = { input: 0, output: 0 }
			if (validatedSpec.confidenceScore < 0.7) {
				Logger.info("[IntentGrounder] Confidence low, performing self-critique...")
				try {
					const { spec: critiqued, tokens: t } = await this.validator.selfCritique(validatedSpec, intent)
					finalSpec = critiqued
					critiqueTokens = t
				} catch (critiqueError) {
					Logger.warn("[IntentGrounder] Self-critique failed, proceeding with validated spec", critiqueError)
				}
			}

			if (cwd) {
				const internalCache = this.discovery.getInternalStatCache()
				const workspaceIndex = await this.discovery.getWorkspaceIndex(cwd)
				finalSpec = await this.validator.verifyEntities(finalSpec, cwd, internalCache, workspaceIndex)
			}

			// Phase 5: Swarm Synthesis - Merge Specifications
			if (synthesizedParentSpec) {
				finalSpec = {
					...finalSpec,
					constraints: Array.from(new Set([...synthesizedParentSpec.constraints, ...finalSpec.constraints])),
					rules: Array.from(new Set([...synthesizedParentSpec.rules, ...finalSpec.rules])),
					// Decision variables: Merge by name, favoring local discovery for details
					decisionVariables: this.mergeDecisionVariables(
						synthesizedParentSpec.decisionVariables,
						finalSpec.decisionVariables,
					),
				}
				Logger.info(`[IntentGrounder] Swarm Synthesis: Successfully merged parent and local specifications.`)
			}

			const durationMs = Date.now() - startTime
			finalSpec.telemetry = {
				durationMs,
				tokensIn: tokens.input + critiqueTokens.input,
				tokensOut: tokens.output + critiqueTokens.output,
				model: this.apiHandler.getModel().id,
				isCacheHit: false,
				inheritanceSource: synthesizedParentSpec ? "parent" : "none",
			}

			if (streamId) {
				// Don't await non-critical persistence
				this.persistToMemory(streamId, intent, finalSpec).catch((e) =>
					Logger.warn("[IntentGrounder] Background persistence failed:", e),
				)
			}

			IntentGrounder.specCache.set(cacheKey, finalSpec)

			Logger.info(
				`[IntentGrounder] Successfully grounded intent in ${durationMs}ms (Confidence: ${finalSpec.confidenceScore}).`,
			)
			return finalSpec
		} catch (error) {
			Logger.error("[IntentGrounder] Grounding failed completely:", error)
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
		const normalizedContext = context ? context.trim().replace(/\r\n/g, "\n").replace(/\s+/g, " ") : ""
		const rawKey = `${modelId}|${cwd || "no-cwd"}|${intent}|${normalizedContext}`
		return crypto.createHash("sha256").update(rawKey).digest("hex")
	}

	private async persistToMemory(streamId: string, intent: string, spec: GroundedSpec): Promise<void> {
		try {
			await Promise.all([
				orchestrator.storeMemory(streamId, "last_grounding_spec", JSON.stringify(spec)),
				orchestrator.storeMemory(streamId, "last_intent", intent),
				orchestrator.storeMemory(streamId, "grounding_telemetry", JSON.stringify(spec.telemetry)),
			])
			await dbPool.commitWork(streamId)
		} catch (e) {
			Logger.error("[IntentGrounder] Failed to commit grounding metadata:", e)
		}
	}

	private async executeGroundingRequest(
		systemPrompt: string,
		messages: CodemarieStorageMessage[],
	): Promise<{ spec: unknown; tokens: { input: number; output: number } }> {
		const stream = this.apiHandler.createMessage(systemPrompt, messages)
		let fullResponse = ""
		let reasoning = ""

		const TIMEOUT_MS = 45000
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
						if (fullResponse.length > 500 && fullResponse.includes("}")) {
							const lastChars = fullResponse.slice(-10).trim()
							if (lastChars.endsWith("}") || lastChars.endsWith("```")) {
								try {
									const spec = GroundingParser.quickExtractJson(fullResponse)
									if (
										spec &&
										typeof spec === "object" &&
										"decisionVariables" in spec &&
										"confidenceScore" in spec &&
										typeof spec.confidenceScore === "number"
									) {
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
			if (err.name === "AbortError" && fullResponse.length > 0) return
			// Filter out expected abort errors during optimistic extraction
			if (err.message?.includes("aborted") && fullResponse.length > 0) return
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

		return {
			spec: GroundingParser.extractJson(fullResponse),
			tokens,
		}
	}

	/**
	 * Rough symbolic token estimator optimized for code and technical text.
	 * Better than 4 chars/token as it accounts for symbols and CamelCase.
	 */
	private estimateTokens(text: string): number {
		if (!text) return 0
		// Code often has many symbols and CamelCase which increase token counts
		// Split by typical delimiters and CamelCase boundaries
		const chunks = text.split(/[\s.()[\]{}:;'"=<>!+\-*/\\,]+|(?<=[a-z])(?=[A-Z])/)
		return Math.ceil(chunks.length * 1.3) // 1.3 weight factor for sub-tokens
	}

	private mergeDecisionVariables(
		parent: GroundedSpec["decisionVariables"],
		local: GroundedSpec["decisionVariables"],
	): GroundedSpec["decisionVariables"] {
		const mergedMap = new Map<string, (typeof parent)[number]>()
		for (const v of parent) mergedMap.set(v.name, v)
		for (const v of local) {
			const existing = mergedMap.get(v.name)
			if (existing) {
				mergedMap.set(v.name, {
					...existing,
					description: v.description || existing.description,
					range: Array.from(new Set([...(existing.range || []), ...(v.range || [])])),
				})
			} else {
				mergedMap.set(v.name, v)
			}
		}
		return Array.from(mergedMap.values())
	}
}

export type { GroundedSpec } from "./types"
