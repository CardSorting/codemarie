import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"

/**
 * SwarmRateLimiter: Global API Backpressure Coordinator
 * Prevents "Thundering Herd" DDoS cascading failures when high concurrency
 * swarms hit 429 Too Many Requests rate limits.
 */
class SwarmRateLimiter {
	private globalPausePromise: Promise<void> | null = null

	/**
	 * Pauses execution for the entire swarm if a 429 error is detected.
	 */
	public async enforceBackpressure(error: any): Promise<void> {
		const isRateLimit =
			error?.status === 429 ||
			(error?.message && error.message.toLowerCase().includes("429")) ||
			(error?.message && error.message.toLowerCase().includes("rate limit")) ||
			(error?.message && error.message.toLowerCase().includes("too many requests"))

		if (isRateLimit) {
			if (!this.globalPausePromise) {
				Logger.warn(
					`[MAS][SwarmRateLimiter] ⚠️ SWARM RATE LIMIT HIT (429)! Pausing all agent API calls for 30s to let the provider cool down...`,
				)
				// 30 second global pause
				this.globalPausePromise = new Promise((resolve) => setTimeout(resolve, 30000))
				this.globalPausePromise.finally(() => {
					this.globalPausePromise = null
				})
			}
		}

		if (this.globalPausePromise) {
			await this.globalPausePromise
			// Apply 1-5 second random jitter so workers stagger their wake-ups rather than hammering the API on the exact same millisecond
			const jitterMs = 1000 + Math.random() * 4000
			await new Promise((resolve) => setTimeout(resolve, jitterMs))
		}
	}

	/**
	 * Waits if the swarm is currently paused due to rate limiting.
	 */
	public async waitIfPaused(): Promise<void> {
		if (this.globalPausePromise) {
			await this.globalPausePromise
			// Wake up stagger
			const jitterMs = 1000 + Math.random() * 4000
			await new Promise((resolve) => setTimeout(resolve, jitterMs))
		}
	}
}

export const swarmRateLimiter = new SwarmRateLimiter()

/**
 * WORKER_PLAN_SYSTEM_PROMPT: Used for the initial high-level planning phase.
 */
export const WORKER_PLAN_SYSTEM_PROMPT = `You are a Build Worker Architect. You are given a single task to execute from a larger project plan.

Your goal is to produce a structured JSON object with:
1. "actions": A list of concrete file-level actions (create, modify, delete) needed to complete the task.
2. "dependencies": Any other tasks or files this depends on.
3. "verification": How to verify this task was completed correctly.

Rules:
- Focus ONLY on your assigned task. Do not attempt to complete other tasks.
- Be specific about file paths and code changes.
- Respect architectural layer boundaries.

Response Format (JSON ONLY):
{
  "actions": [
    { "type": "create|modify|delete", "file": "path/to/file", "description": "What to do" }
  ],
  "dependencies": ["dependency 1", ...],
  "verification": "How to verify completion"
}`

/**
 * WORKER_ACT_SYSTEM_PROMPT: Used for the concrete implementation of a specific file action.
 * This prompt is used after the planning phase has committed to a specific set of actions.
 */
export const WORKER_ACT_SYSTEM_PROMPT = `You are a Build Worker Coder. You are implementing a specific file action proposed by the Architect.

Your goal is to produce the final, complete source code for the file after the requested change. 
You are working in a production environment where accuracy and reliability are paramount.

Rules:
- Implement ONLY the requested change for the specific file.
- DO NOT add placeholders, TODOs, or simulated logic. Everything must be real and functional.
- Maintain existing styles, patterns, and architectural integrity of the codebase.
- Ensure the code is production-ready, strictly typed (if TypeScript), and well-documented.
- If you are creating a new file, ensure all necessary imports are present and correct.
- If you are modifying an existing file, do not delete existing functionality unless explicitly requested.

Response Format (JSON ONLY):
{
  "file": "path/to/file",
  "content": "Full source code here...",
  "explanation": "Detailed explanation of implementation choices, including any technical trade-offs made"
}`

/**
 * executeMASRequest: Standard utility for making LLM requests in the MAS systems.
 */
export async function executeMASRequest(apiHandler: ApiHandler, systemPrompt: string, userPrompt: string): Promise<any> {
	const MAX_RETRIES = 2
	let attempt = 0
	let currentPrompt = userPrompt

	while (attempt <= MAX_RETRIES) {
		const messages: CodemarieStorageMessage[] = [
			{
				role: "user",
				content: [{ type: "text", text: currentPrompt }],
			},
		]

		// Tier 6: Wait if the entire swarm cluster has been put into timeout by a 429
		await swarmRateLimiter.waitIfPaused()

		const stream = apiHandler.createMessage(systemPrompt, messages)
		let fullResponse = ""

		try {
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					fullResponse += chunk.text
				}
			}

			// Extract JSON from response (handling potential markdown blocks)
			const jsonMatch = fullResponse.match(/```json\n([\s\S]*)\n```/) || fullResponse.match(/{[\s\S]*}/)
			const jsonContent = jsonMatch ? jsonMatch[1] || jsonMatch[0] : fullResponse

			return JSON.parse(jsonContent.trim())
		} catch (error: any) {
			attempt++

			// Tier 6: Check for rate limits and optionally pause the swarm BEFORE we log exhaustion
			await swarmRateLimiter.enforceBackpressure(error)

			Logger.warn(`[MAS][Utility] LLM Request failed on attempt ${attempt} of ${MAX_RETRIES + 1}. Error: ${error.message}`)
			Logger.debug("[MAS][Utility] Raw Response for failed attempt:", fullResponse)

			if (attempt > MAX_RETRIES) {
				Logger.error("[MAS][Utility] Exhausted retries for MAS stream request.")
				throw error
			}

			// System Nudge: Adjust prompt to encourage self-correction on formatting
			const errorInfo = extractErrorInfo(error)
			currentPrompt += `\n\n[System Nudge] Your previous response failed to parse as valid JSON. Error: ${errorInfo}. Please correct the formatting and ensure your response exactly matches the requested JSON schema.`
		}
	}
}

/**
 * extractErrorInfo: Unpacks nested error structures from various API providers.
 */
function extractErrorInfo(error: any): string {
	if (error?.response?.data?.error?.message) {
		return error.response.data.error.message
	}
	if (error?.message) {
		return error.message
	}
	try {
		return JSON.stringify(error)
	} catch (_e) {
		return "Unknown Error (Serialization failed)"
	}
}
