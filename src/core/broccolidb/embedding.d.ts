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
/**
 * EmbeddingService wraps the @google/genai SDK for vector embedding generation.
 *
 * For Gemini API: Reads GEMINI_API_KEY (or GOOGLE_API_KEY) from environment.
 * For Vertex AI: Reads GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION (defaults to 'us-central1').
 *
 * Gracefully degrades to null when no credentials are configured — never throws.
 */
export declare class EmbeddingService {
	private ai
	private model
	private dimensions
	constructor(config?: EmbeddingConfig)
	/** Returns true if the service has a valid API key and client. */
	isAvailable(): boolean
	/**
	 * Embed a single text string.
	 * @param text - The text content to embed
	 * @param taskType - Optional task type hint: 'RETRIEVAL_DOCUMENT', 'RETRIEVAL_QUERY', 'SEMANTIC_SIMILARITY', etc.
	 * @returns The embedding vector, or null if unavailable/error
	 */
	embedText(text: string, taskType?: string): Promise<number[] | null>
	/**
	 * Embed multiple text strings in a single batch request.
	 * @param texts - Array of text strings
	 * @param taskType - Optional task type hint
	 * @returns Array of embedding vectors (null for any that failed)
	 */
	embedBatch(texts: string[], taskType?: string): Promise<(number[] | null)[]>
	/** Get the configured output dimensionality */
	getDimensions(): number
	/** Get the configured model ID */
	getModel(): string
}
//# sourceMappingURL=embedding.d.ts.map
