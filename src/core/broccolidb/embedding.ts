import * as crypto from "node:crypto"
import { GoogleGenAI } from "@google/genai"
import { Logger } from "@/shared/services/Logger"
import { LRUCache } from "./lru-cache.js"

export interface EmbeddingConfig {
	/** Model ID. Default: 'gemini-embedding-2-preview' */
	model?: string
	/** Output embedding dimensions. Default: 768. Recommended: 768, 1536, 3072 */
	outputDimensionality?: number
	/** Whether to use Vertex AI instead of the Gemini API. */
	vertexai?: boolean
	/** Vertex AI project ID. Reads from GOOGLE_CLOUD_PROJECT if not provided. */
	projectId?: string
	/** Vertex AI location. Reads from GOOGLE_CLOUD_LOCATION if not provided. Defaults to 'us-central1'. */
	location?: string
}

const DEFAULT_MODEL = "gemini-embedding-2-preview"
const DEFAULT_DIMENSIONS = 768

/**
 * AiService wraps the @google/genai SDK for vector embedding generation
 * and generative AI features like summarization.
 */
export class AiService {
	private ai: GoogleGenAI | null = null
	private model: string
	private dimensions: number
	private embeddingCache = new LRUCache<string, number[]>(1000, 3600000) // 1 hour TTL

	// Circuit Breaker State
	private cbState: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED"
	private failureCount = 0
	private lastFailureTime = 0
	private readonly failureThreshold = 5
	private readonly resetTimeout = 60000 // 60s cooldown

	constructor(config?: EmbeddingConfig) {
		this.model = config?.model || DEFAULT_MODEL
		this.dimensions = config?.outputDimensionality || DEFAULT_DIMENSIONS

		const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
		const vertexai = config?.vertexai || !!process.env.GOOGLE_CLOUD_PROJECT
		const projectId = config?.projectId || process.env.GOOGLE_CLOUD_PROJECT
		const location = config?.location || process.env.GOOGLE_CLOUD_LOCATION || "us-central1"

		try {
			if (vertexai && projectId) {
				this.ai = new GoogleGenAI({
					vertexai: true,
					project: projectId,
					location: location,
				})
			} else if (apiKey) {
				this.ai = new GoogleGenAI({ apiKey })
			}
		} catch (e) {
			Logger.warn("[AiService] Failed to initialize GoogleGenAI:", (e as Error).message)
			this.ai = null
		}
	}

	/** Returns true if the service has a valid API key and client. */
	isAvailable(): boolean {
		return this.ai !== null && this.cbState !== "OPEN"
	}

	/**
	 * Private helper to execute an AI task with exponential backoff and circuit breaking.
	 */
	private async executeWithRetry<T>(task: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
		// 1. Circuit Breaker Check
		if (this.cbState === "OPEN") {
			if (Date.now() - this.lastFailureTime > this.resetTimeout) {
				this.cbState = "HALF_OPEN"
				Logger.info(`[AiService][CB] Circuit moving to HALF_OPEN for ${label}`)
			} else {
				throw new Error(`[AiService][CB] Circuit is OPEN for ${label}. Cooldown active.`)
			}
		}

		let lastError: Error | undefined
		for (let i = 0; i < maxRetries; i++) {
			try {
				const result = await task()

				// Success: Reset circuit breaker
				this.failureCount = 0
				this.cbState = "CLOSED"

				return result
			} catch (e) {
				lastError = e as Error
				const isRetryable =
					lastError.message.includes("429") ||
					lastError.message.includes("503") ||
					lastError.message.includes("504") ||
					lastError.message.includes("timeout") ||
					lastError.message.includes("fetch failed")

				if (!isRetryable || i === maxRetries - 1) break

				const delay = 2 ** i * 1000 + Math.random() * 1000
				Logger.warn(
					`[AiService][Retry] ${label} failed (attempt ${i + 1}/${maxRetries}), retrying in ${Math.round(delay)}ms...`,
				)
				await new Promise((resolve) => setTimeout(resolve, delay))
			}
		}

		// 2. Failure: Update Circuit Breaker
		this.failureCount++
		this.lastFailureTime = Date.now()
		if (this.failureCount >= this.failureThreshold || this.cbState === "HALF_OPEN") {
			this.cbState = "OPEN"
			Logger.error(
				`[AiService][CB] Circuit is now OPEN due to consecutive failures in ${label}. Threshold: ${this.failureThreshold}`,
			)
		}

		throw lastError || new Error(`${label} failed after ${maxRetries} retries`)
	}

	/**
	 * Intelligent Semantic Chunking Utility.
	 * Splits text into chunks of approx `maxChars`, attempting to break at double newlines (paragraphs).
	 */
	private chunkText(text: string, maxChars = 3000): string[] {
		if (text.length <= maxChars) return [text]

		const chunks: string[] = []
		let remaining = text

		while (remaining.length > 0) {
			if (remaining.length <= maxChars) {
				chunks.push(remaining)
				break
			}

			let splitIdx = remaining.lastIndexOf("\n\n", maxChars)
			if (splitIdx === -1) splitIdx = remaining.lastIndexOf("\n", maxChars)
			if (splitIdx === -1) splitIdx = maxChars

			chunks.push(remaining.substring(0, splitIdx).trim())
			remaining = remaining.substring(splitIdx).trim()
		}

		return chunks
	}

	/**
	 * Summarize a text string using Gemini.
	 */
	async summarizeText(text: string): Promise<string> {
		if (!this.ai || !text.trim() || this.cbState === "OPEN") return text

		try {
			const prompt = `Summarize the following cognitive memory logs for an AI agent. Extract key decisions, facts, and status updates into a concise narrative:\n\n${text}`
			const response = await this.executeWithRetry(
				() =>
					this.ai!.models.generateContent({
						model: "gemini-2.5-flash",
						contents: prompt,
					}),
				"summarizeText",
			)

			const candidate = response.candidates?.[0]
			const part = candidate?.content?.parts?.[0]
			return (part as any)?.text || "Summary unavailable."
		} catch (e) {
			Logger.warn("[AiService] summarizeText error:", (e as Error).message)
			return `[Summary Failed] ${text.substring(0, 100)}...`
		}
	}

	/**
	 * Embed a single text string. Supports multi-chunk embedding for large documents.
	 */
	async embedText(text: string, taskType?: string): Promise<number[] | null> {
		if (!this.ai || !text.trim() || this.cbState === "OPEN") return null

		const cacheKey = crypto
			.createHash("sha256")
			.update(`${text}|${taskType || ""}`)
			.digest("hex")
		const cached = this.embeddingCache.get(cacheKey)
		if (cached) return cached

		try {
			// Optimization: Semantic Chunking for large documents (usually conclusions or rule files)
			const chunks = this.chunkText(text, 5000)

			if (chunks.length === 1) {
				const params: any = {
					model: this.model,
					contents: chunks[0],
					outputDimensionality: this.dimensions,
				}
				if (taskType) params.taskType = taskType

				const response = await this.executeWithRetry(() => this.ai!.models.embedContent(params), "embedText")
				let embedding: number[] | null = null
				if (response.embeddings && response.embeddings.length > 0) {
					embedding = response.embeddings[0]?.values || null
				} else if ((response as any).embedding?.values) {
					embedding = (response as any).embedding.values
				}

				if (embedding) {
					this.embeddingCache.set(cacheKey, embedding)
				}
				return embedding
			}
			// Average embeddings of chunks for a global representation
			const results = await this.embedBatch(chunks, taskType)
			const valid = results.filter((r): r is number[] => r !== null)
			if (valid.length === 0) return null

			const avg = Array.from({ length: this.dimensions }, () => 0)
			for (const vec of valid) {
				for (let i = 0; i < this.dimensions; i++) {
					avg[i] += vec[i]!
				}
			}
			const final = avg.map((v) => v / valid.length)
			this.embeddingCache.set(cacheKey, final)
			return final
		} catch (e) {
			Logger.warn("[AiService] embedText error:", (e as Error).message)
			return null
		}
	}

	/**
	 * Embed multiple text strings in a single batch request.
	 */
	async embedBatch(texts: string[], taskType?: string): Promise<(number[] | null)[]> {
		if (!this.ai || texts.length === 0) return texts.map(() => null)

		const results: (number[] | null)[] = Array.from({ length: texts.length }, () => null)
		const missingIndices: number[] = []
		const missingTexts: string[] = []

		// 1. Check cache first
		for (let i = 0; i < texts.length; i++) {
			const text = texts[i]!
			const cacheKey = crypto
				.createHash("sha256")
				.update(`${text}|${taskType || ""}`)
				.digest("hex")
			const cached = this.embeddingCache.get(cacheKey)
			if (cached) {
				results[i] = cached
			} else {
				missingIndices.push(i)
				missingTexts.push(text)
			}
		}

		if (missingTexts.length === 0) return results

		try {
			const params: any = {
				model: this.model,
				contents: missingTexts,
				outputDimensionality: this.dimensions,
			}
			if (taskType) params.taskType = taskType

			const response = await this.executeWithRetry(() => this.ai!.models.embedContent(params), "embedBatch")
			if (response.embeddings) {
				response.embeddings.forEach((e, i) => {
					const embedding = e.values || null
					const originalIdx = missingIndices[i]!
					results[originalIdx] = embedding

					if (embedding) {
						const text = missingTexts[i]!
						const cacheKey = crypto
							.createHash("sha256")
							.update(`${text}|${taskType || ""}`)
							.digest("hex")
						this.embeddingCache.set(cacheKey, embedding)
					}
				})
			}
			return results
		} catch (e) {
			Logger.warn("[AiService] embedBatch error:", (e as Error).message)
			return results
		}
	}

	/**
	 * Evaluates the logical relationship between two pieces of knowledge.
	 */
	async evaluateLogicRelationship(textA: string, textB: string): Promise<"supports" | "contradicts" | "neutral"> {
		if (!this.ai || !textA.trim() || !textB.trim()) return "neutral"

		try {
			const prompt = `Evaluate the logical relationship between the following two statements.
Statement A: "${textA}"
Statement B: "${textB}"

Respond with ONLY one of the following words:
'supports' - if Statement A provides evidence for or logically leads to Statement B.
'contradicts' - if Statement A logically conflicts with, denies, or opposes Statement B.
'neutral' - if there is no strong logical connection between them.

Relationship:`

			const response = await this.executeWithRetry(
				() =>
					this.ai!.models.generateContent({
						model: "gemini-1.5-flash",
						contents: prompt,
					}),
				"evaluateLogicRelationship",
			)

			const text = (response.candidates?.[0]?.content?.parts?.[0] as any)?.text?.toLowerCase()?.trim() || "neutral"
			if (text.includes("supports")) return "supports"
			if (text.includes("contradicts")) return "contradicts"
			return "neutral"
		} catch (e) {
			Logger.warn("[AiService] evaluateLogicRelationship error:", (e as Error).message)
			return "neutral"
		}
	}

	/**
	 * Generates a natural language narrative explaining a reasoning chain.
	 */
	async explainReasoningChain(conclusion: string, steps: { content: string; type: string }[]): Promise<string> {
		if (!this.ai || steps.length === 0) return "No reasoning steps provided."

		try {
			const stepsText = steps.map((s, i) => `${i + 1}. [${s.type}] ${s.content}`).join("\n")
			const prompt = `Explain the following reasoning chain in a concise, professional narrative.
Conclusion: "${conclusion}"

Steps taken:
${stepsText}

Explanation:`

			const response = await this.executeWithRetry(
				() =>
					this.ai!.models.generateContent({
						model: "gemini-1.5-flash",
						contents: prompt,
					}),
				"explainReasoningChain",
			)

			return (response.candidates?.[0]?.content?.parts?.[0] as any)?.text || "Narrative unavailable."
		} catch (e) {
			Logger.warn("[AiService] explainReasoningChain error:", (e as Error).message)
			return "Failed to generate narrative explanation."
		}
	}

	/**
	 * Audits code against a constitutional rule using LLM.
	 */
	async auditCodeAgainstRule(path: string, code: string, ruleContent: string): Promise<{ violated: boolean; reason?: string }> {
		if (!this.ai || !code.trim() || !ruleContent.trim()) return { violated: false }

		try {
			const prompt = `Constitutional Audit for: ${path}
Rule: "${ruleContent}"

Code Content:
\`\`\`
${code.substring(0, 4000)}
\`\`\`

Does the code violate the rule?
Respond with 'VIOLATED: [reason]' or 'PASSED'.

Result:`

			const response = await this.executeWithRetry(
				() =>
					this.ai!.models.generateContent({
						model: "gemini-1.5-flash",
						contents: prompt,
					}),
				"auditCodeAgainstRule",
			)

			const text = (response.candidates?.[0]?.content?.parts?.[0] as any)?.text || "PASSED"
			if (text.toUpperCase().includes("VIOLATED")) {
				return { violated: true, reason: text }
			}
			return { violated: false }
		} catch (e) {
			Logger.warn("[AiService] auditCodeAgainstRule error:", (e as Error).message)
			return { violated: false }
		}
	}

	getDimensions(): number {
		return this.dimensions
	}
	getModel(): string {
		return this.model
	}
}
