import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"

/**
 * executeMASRequest: Standard utility for making LLM requests in the MAS systems.
 */
export async function executeMASRequest(apiHandler: ApiHandler, systemPrompt: string, userPrompt: string): Promise<any> {
	const messages: CodemarieStorageMessage[] = [
		{
			role: "user",
			content: [{ type: "text", text: userPrompt }],
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
	} catch (error) {
		Logger.error("[MAS][Utility] Failed to execute or parse LLM request:", error)
		Logger.debug("[MAS][Utility] Raw Response:", fullResponse)
		throw error
	}
}
