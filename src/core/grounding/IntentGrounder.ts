import fs from "fs/promises"
import * as path from "path"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { searchWorkspaceFiles } from "@/services/search/file-search"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../api"
import { GROUNDING_SYSTEM_PROMPT, GroundedSpec, GroundedSpecSchema } from "./types"

export class IntentGrounder {
	private apiHandler: ApiHandler

	constructor(apiHandler: ApiHandler) {
		this.apiHandler = apiHandler
	}

	async ground(intent: string, context?: string, cwd?: string, streamId?: string): Promise<GroundedSpec> {
		const startTime = Date.now()
		const systemPrompt = GROUNDING_SYSTEM_PROMPT

		let projectRules = ""
		let discoveredContext = ""

		if (cwd) {
			projectRules = await this.loadProjectRules(cwd)
			discoveredContext = await this.discoverRelevantContext(intent, cwd)
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

			// Pass 5: Self-Critique Loop (detect hallucinations/omissions)
			const critiquedSpec = await this.selfCritique(validatedSpec, intent)

			// Finalize telemetry
			const durationMs = Date.now() - startTime
			critiquedSpec.telemetry = {
				durationMs,
				tokensIn: tokens.input,
				tokensOut: tokens.output,
				model: this.apiHandler.getModel().id,
			}

			// Orchestrator Integration: Store grounding in memory
			if (streamId) {
				await orchestrator.storeMemory(streamId, "last_grounding_spec", JSON.stringify(critiquedSpec))
				await orchestrator.storeMemory(streamId, "last_intent", intent)
				await orchestrator.storeMemory(streamId, "grounding_telemetry", JSON.stringify(critiquedSpec.telemetry))
			}

			Logger.info(`[IntentGrounder] Successfully grounded intent (Confidence: ${critiquedSpec.confidenceScore}).`)
			return critiquedSpec
		} catch (error) {
			Logger.error("[IntentGrounder] Grounding failed:", error)
			throw error
		}
	}

	private async executeGroundingRequest(
		systemPrompt: string,
		messages: CodemarieStorageMessage[],
	): Promise<{ spec: any; tokens: { input: number; output: number } }> {
		const stream = this.apiHandler.createMessage(systemPrompt, messages)
		let fullResponse = ""
		// In a real implementation, we'd get token counts from the final chunk or metadata.
		// For this prototype implementation, we simulate/estimate or use what's available.
		for await (const chunk of stream) {
			if (chunk.type === "text") {
				fullResponse += chunk.text
			}
		}

		const jsonMatch = fullResponse.match(/\{[\s\S]*\}/)
		if (!jsonMatch) throw new Error("No valid JSON found in grounding response")

		return {
			spec: JSON.parse(jsonMatch[0]),
			tokens: { input: 0, output: 0 }, // Simulator for now; ApiHandler doesn't expose usage directly in stream loop easily
		}
	}

	private async verifyEntities(spec: GroundedSpec, cwd: string): Promise<GroundedSpec> {
		const verifiedEntities: string[] = []
		const entitiesToVerify = [
			...spec.decisionVariables.flatMap((v) => v.range || []),
			...spec.constraints.flatMap((c) => c.match(/[a-zA-Z0-9_\-./]+\.[a-z]{2,4}/g) || []), // simple filename regex
		]

		for (const entity of new Set(entitiesToVerify)) {
			try {
				const fullPath = path.isAbsolute(entity) ? entity : path.join(cwd, entity)
				await fs.access(fullPath)
				verifiedEntities.push(entity)
			} catch {
				// Entity doesn't exist – track as a potential hallucination or missing file
			}
		}

		spec.verifiedEntities = verifiedEntities
		if (verifiedEntities.length < entitiesToVerify.length && spec.confidenceScore > 0.3) {
			spec.confidenceScore *= 0.9 // Penalize confidence if entities are missing
			spec.ambiguityReasoning = (spec.ambiguityReasoning || "") + " Some referenced files were not found in the workspace."
		}

		return spec
	}

	private async selfCritique(spec: GroundedSpec, intent: string): Promise<GroundedSpec> {
		// A lightweight reflection pass: The LLM checks its own work.
		// For cost efficiency in this pass, we use the same model but ask it to verify the spec.
		const reflectionPrompt = `You are a critical reviewer. Review the following Grounded Specification against the User Intent.
User Intent: "${intent}"
Proposed Spec: ${JSON.stringify(spec, null, 2)}

Does this spec contain any hallucinations? (Referencing files that don't exist in the context provided)
Is it missing any critical constraints from the intent?

Return the spec with any necessary fixes to "rules" or "constraints" to improve accuracy.
STRICTLY return the JSON for the spec.`

		try {
			// In production, we might use a cheaper model for reflection if available.
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
				.filter((w) => w.length > 3)
				.slice(0, 5)
			let context = ""
			for (const word of keywords) {
				const results = await searchWorkspaceFiles(word, cwd, 3)
				if (results.length > 0) {
					context += `\n- Potential matches for "${word}": ${results.map((r) => r.path).join(", ")}`
				}
			}
			return context.trim()
		} catch (error) {
			Logger.error("[IntentGrounder] Semantic discovery failed:", error)
			return ""
		}
	}

	private async loadProjectRules(cwd: string): Promise<string> {
		try {
			const rulesDir = path.join(cwd, ".codemarierules")
			const entries = await fs.readdir(rulesDir).catch(() => [])
			let combinedRules = ""
			for (const entry of entries) {
				if (entry.endsWith(".md")) {
					const content = await fs.readFile(path.join(rulesDir, entry), "utf-8")
					combinedRules += `--- ${entry} ---\n${content.substring(0, 300)}${content.length > 300 ? "..." : ""}\n\n`
				}
			}
			return combinedRules.trim()
		} catch (error) {
			Logger.error("[IntentGrounder] Failed to load project rules:", error)
			return ""
		}
	}
}

export type { GroundedSpec } from "./types"
