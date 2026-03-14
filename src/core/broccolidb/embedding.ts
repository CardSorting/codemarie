import { GoogleGenAI } from "@google/genai"
import { Logger } from "@/shared/services/Logger"

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
		return this.ai !== null
	}

	/**
	 * Summarize a text string using Gemini.
	 */
	async summarizeText(text: string): Promise<string> {
		if (!this.ai || !text.trim()) return text

		try {
			const prompt = `Summarize the following cognitive memory logs for an AI agent. Extract key decisions, facts, and status updates into a concise narrative:\n\n${text}`
			const response = await this.ai.models.generateContent({
				model: "gemini-2.5-flash",
				contents: prompt,
			})

			// Handle response structure for @google/genai
			const candidate = response.candidates?.[0]
			const part = candidate?.content?.parts?.[0]
			return (part as any)?.text || "Summary unavailable."
		} catch (e) {
			Logger.warn("[AiService] summarizeText error:", (e as Error).message)
			return `[Summary Failed] ${text.substring(0, 100)}...`
		}
	}

	/**
	 * Embed a single text string.
	 */
	async embedText(text: string, taskType?: string): Promise<number[] | null> {
		if (!this.ai || !text.trim()) return null

		try {
			const params: any = {
				model: this.model,
				contents: text,
				outputDimensionality: this.dimensions,
			}
			if (taskType) params.taskType = taskType

			const response = await this.ai.models.embedContent(params)
			if (response.embeddings && response.embeddings.length > 0) {
				return response.embeddings[0]?.values || null
			}
			if ((response as any).embedding?.values) {
				return (response as any).embedding.values
			}
			return null
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

		try {
			const params: any = {
				model: this.model,
				contents: texts,
				outputDimensionality: this.dimensions,
			}
			if (taskType) params.taskType = taskType

			const response = await this.ai.models.embedContent(params)
			if (response.embeddings) {
				return response.embeddings.map((e) => e.values || null)
			}
			return texts.map(() => null)
		} catch (e) {
			Logger.warn("[AiService] embedBatch error:", (e as Error).message)
			return texts.map(() => null)
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

			const response = await this.ai.models.generateContent({
				model: "gemini-1.5-flash",
				contents: prompt,
			})

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

			const response = await this.ai.models.generateContent({
				model: "gemini-1.5-flash",
				contents: prompt,
			})

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

			const response = await this.ai.models.generateContent({
				model: "gemini-1.5-flash",
				contents: prompt,
			})

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
