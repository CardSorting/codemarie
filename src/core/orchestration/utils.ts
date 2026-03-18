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
			currentPrompt += `\n\n[System Nudge] Your previous response failed to parse as valid JSON. Error: ${error.message}. Please correct the formatting and ensure your response exactly matches the requested JSON schema.`
		}
	}
}
