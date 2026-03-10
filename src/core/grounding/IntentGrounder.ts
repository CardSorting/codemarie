import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"

export interface GroundedSpec {
	decisionVariables: { name: string; description: string; range?: string[] }[]
	constraints: string[]
	outputStructure: Record<string, any>
	rules: string[]
}

export class IntentGrounder {
	private apiHandler: ApiHandler

	constructor(apiHandler: ApiHandler) {
		this.apiHandler = apiHandler
	}

	async ground(intent: string): Promise<GroundedSpec> {
		const systemPrompt = `You are an Intent Grounding expert. 
Your task is to decompose a vague human intent into a structured, computable specification.
Follow the methodology of Interpret -> Ground -> Build.
You are in the GROUND phase.

Decompose the intent into:
1. Decision Variables: Parameters that can be tuned or determined during the task.
2. Constraints: Hard limits, requirements, or boundaries that must be respected.
3. Output Structure: A conceptual model of the final result.
4. Rules: Logic, heuristics, or specific instructions to follow.

Your goal is to translate human ambiguity into machine-actionable structure.

Return the result STRICTLY as a JSON object matching this structure:
{
  "decisionVariables": [{ "name": string, "description": string, "range": string[] | undefined }],
  "constraints": string[],
  "outputStructure": object,
  "rules": string[]
}

User Intent: "${intent}"`

		const messages: CodemarieStorageMessage[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Ground this intent: " + intent }],
			},
		]

		try {
			Logger.info(`[IntentGrounder] Grounding intent: ${intent.substring(0, 100)}...`)
			const stream = this.apiHandler.createMessage(systemPrompt, messages)
			let fullResponse = ""
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					fullResponse += chunk.text
				}
			}

			// Extract JSON from response (handling potential markdown blocks)
			const jsonMatch = fullResponse.match(/\{[\s\S]*\}/)
			if (jsonMatch) {
				try {
					const spec = JSON.parse(jsonMatch[0]) as GroundedSpec
					Logger.info(`[IntentGrounder] Successfully grounded intent.`)
					return spec
				} catch (e) {
					Logger.error("[IntentGrounder] Failed to parse JSON match", e)
					throw new Error("Invalid JSON format in grounding response")
				}
			}
			throw new Error("No JSON found in grounding response")
		} catch (error) {
			Logger.error("[IntentGrounder] Grounding failed:", error)
			throw error
		}
	}
}
