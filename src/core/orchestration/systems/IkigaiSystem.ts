import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../../api"
import { OrchestrationController } from "../OrchestrationController"
import { IKIGAI_SYSTEM_PROMPT } from "../prompts"
import { executeMASRequest } from "../utils"

/**
 * IkigaiSystem: Defines the product's "Reason for Being" (Purpose & Scope).
 * This system is the first pass in the multi-agent stream, ensuring the
 * product has a clear objective and defined boundaries.
 */
export class IkigaiSystem {
	private name = "Ikigai"

	/**
	 * Analyzes the user request and determines the product purpose and scope.
	 * Stores findings in the stream's memory for other systems to use.
	 */
	public async defineScope(
		controller: OrchestrationController,
		apiHandler: ApiHandler,
		userRequest: string,
		groundedSpec?: any,
	): Promise<{ purpose: string; scope: any[]; clarificationNeeded?: string }> {
		Logger.info(`[MAS][${this.name}] Defining scope for request: ${userRequest.slice(0, 50)}...`)

		// Start a new task for scope definition
		await controller.beginTask("Defining Product Purpose, Scope & Success Criteria (Ikigai)")

		try {
			// Tier 3: Context Enrichment (Intent Grounding Handoff)
			let contextRequest = userRequest
			if (groundedSpec) {
				const verifiedEntities = groundedSpec.verifiedEntities?.map((e: any) => e.path || e.name).join(", ") || "None"
				const constraints = groundedSpec.constraints?.join("; ") || "None"
				contextRequest = `User Request: ${userRequest}\n\n[Grounded Context]\nVerified Project Entities: ${verifiedEntities}\nConstraints: ${constraints}`
				Logger.info(
					`[MAS][${this.name}] Enriched request with grounded context (${groundedSpec.verifiedEntities?.length || 0} entities).`,
				)
			}

			const res = await executeMASRequest(apiHandler, IKIGAI_SYSTEM_PROMPT, contextRequest)
			const purpose = res.purpose || `Fulfill the user request: ${userRequest}`
			const scope = res.scope || []
			const nonGoals = res.non_goals || []
			const clarificationNeeded = res.clarification_needed

			if (clarificationNeeded) {
				await controller.updateTaskProgress("pending", `Clarification Required: ${clarificationNeeded}`)
				return { purpose, scope: [], clarificationNeeded }
			}

			// Tier 3: Asymmetric Persistence (Backgrounding DB Ops for Extreme Throughput)
			const backgroundPersistence = (async () => {
				const ctx = await controller.getAgentContext()
				const knowledgeId = `ikigai-${controller.getStreamId()}`
				await ctx.addKnowledge(knowledgeId, "conclusion", `Product Purpose: ${purpose}`, {
					tags: ["mas", "ikigai", "scope"],
					metadata: { scope, purpose, nonGoals },
				})
				await ctx.appendMemoryLayer("mas-orchestrator", `Established product purpose: ${purpose}`)

				// Active Reasoning: Contradiction Detection (Async)
				const contradictions = await ctx.detectContradictions(knowledgeId)
				if (contradictions.length > 0) {
					const issues = contradictions.map((c) => `- Contradiction with ${c.conflictingNodeId}`).join("\n")
					Logger.warn(`[MAS][${this.name}] Background inconsistency detected:\n${issues}`)
					// We don't block the stream here, but we log for the refinement pass
				}
				await ctx.flush()
			})()

			// Catch errors in background persistence to prevent unhandled rejections
			backgroundPersistence.catch((err) => Logger.error(`[MAS][${this.name}] Background persistence failed:`, err))

			// Store in memory (legacy/fallback) - Required for JoyZoning handoff
			await controller.storeMemory("product_purpose", purpose)
			await controller.storeMemory("product_scope", JSON.stringify(scope))
			await controller.storeMemory("product_non_goals", JSON.stringify(nonGoals))

			// Detailed progress update with success criteria
			const scopeSummary = scope
				.map((s: any) => `- ${s.name}: ${s.success_criteria?.join(", ") || "No criteria"}`)
				.join("\n")
			await controller.updateTaskProgress("completed", `Purpose: ${purpose}\n\nOutcome Map:\n${scopeSummary}`)

			return { purpose, scope }
		} catch (error) {
			Logger.error(`[MAS][${this.name}] Failed to define scope:`, error)
			// Fallback to minimal scope
			const purpose = `Fulfill user request: ${userRequest}`
			const scope = ["Implement core functionality"]
			return { purpose, scope }
		}
	}

	/**
	 * Retrieves the stored purpose and scope from memory.
	 */
	public async getStoredScope(controller: OrchestrationController): Promise<{ purpose: string; scope: string[] } | null> {
		const purpose = await controller.recallMemory("product_purpose")
		const scopeRaw = await controller.recallMemory("product_scope")

		if (!purpose || !scopeRaw) return null

		try {
			return {
				purpose,
				scope: JSON.parse(scopeRaw),
			}
		} catch (error) {
			Logger.error(`[MAS][${this.name}] Failed to parse stored scope:`, error)
			return null
		}
	}
}
