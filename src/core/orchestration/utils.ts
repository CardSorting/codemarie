import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"

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
