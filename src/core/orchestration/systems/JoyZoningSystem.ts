import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../../api"
import { OrchestrationController } from "../OrchestrationController"
import { JOYZONING_ADVERSARY_PROMPT, JOYZONING_SYSTEM_PROMPT } from "../prompts"
import { executeMASRequest } from "../utils"

/**
 * JoyZoningSystem: Ensures architectural alignment and layer isolation.
 */
export class JoyZoningSystem {
	private name = "JoyZoning"

	/**
	 * Reviews the purpose and scope and develops an architectural plan.
	 */
	public async reviewArchitecture(
		controller: OrchestrationController,
		apiHandler: ApiHandler,
		purpose: string,
		scope: string[],
	): Promise<string> {
		Logger.info(`[MAS][${this.name}] Reviewing architecture for purpose: ${purpose.slice(0, 50)}...`)

		// Start a new task for architectural review
		await controller.beginTask("Architectural Alignment Review (JoyZoning)")

		try {
			const prompt = `Product Purpose: ${purpose}\nScope Items: ${scope.join(", ")}`
			const res = await executeMASRequest(apiHandler, JOYZONING_SYSTEM_PROMPT, prompt)

			const archPlan = res.architectural_plan || "Adhere to standard layered architecture."
			const constraints = res.constraints || []
			const layerAssignments = res.layer_assignments || {}

			// Tier 3: Asymmetric Persistence & Background Adversary Pass
			const backgroundArchPass = (async () => {
				const ctx = await controller.getAgentContext()
				const archKnowledgeId = `arch-${controller.getStreamId()}`
				await ctx.addKnowledge(archKnowledgeId, "rule", `Architectural Plan: ${archPlan}`, {
					tags: ["mas", "joyzoning", "architecture"],
					metadata: { archPlan, constraints, layerAssignments },
				})
				await ctx.appendMemoryLayer("mas-orchestrator", "Defined architectural boundaries and layer assignments.")

				// Register Logical Constraints
				for (const [layer, patterns] of Object.entries(layerAssignments)) {
					const severity = layer === "domain" ? "blocking" : "warning"
					const typedPatterns = patterns as string[]
					for (const pattern of typedPatterns) {
						await ctx.addLogicalConstraint(pattern, archKnowledgeId, severity)
					}
				}

				// Phase 2: Adversarial Red-Teaming (Backgrounded)
				Logger.info(`[MAS][${this.name}] Starting background red-teaming...`)
				const adversaryPrompt = `Product Purpose: ${purpose}\nProposed Plan: ${archPlan}\nLayer Assignments: ${JSON.stringify(layerAssignments)}`
				try {
					const redTeamRes = await executeMASRequest(apiHandler, JOYZONING_ADVERSARY_PROMPT, adversaryPrompt)
					const vulnerabilities = redTeamRes.vulnerabilities || []
					const hardening = redTeamRes.recommended_hardening || []

					const redTeamId = `redteam-${controller.getStreamId()}`
					await ctx.addKnowledge(
						redTeamId,
						"hypothesis",
						`Red-Team Findings: ${vulnerabilities.length} vulnerabilities detected.`,
						{
							tags: ["mas", "joyzoning", "red-team"],
							metadata: { vulnerabilities, hardening },
						},
					)
					await controller.storeMemory("arch_vulnerabilities", JSON.stringify(vulnerabilities))
					await controller.storeMemory("arch_hardening_plan", JSON.stringify(hardening))
				} catch (err) {
					Logger.warn(`[MAS][${this.name}] Background adversary pass failed:`, err)
				}
				await ctx.flush()
			})()

			// Fire-and-forget: catch background errors
			backgroundArchPass.catch((err) => Logger.error(`[MAS][${this.name}] Background arch pass failed:`, err))

			// Store in memory (legacy/fallback) - immediate handoff
			await controller.storeMemory("arch_plan", archPlan)
			await controller.storeMemory("arch_constraints", JSON.stringify(constraints))
			await controller.storeMemory("layer_assignments", JSON.stringify(layerAssignments))

			return archPlan
		} catch (error) {
			Logger.error(`[MAS][${this.name}] Failed to review architecture:`, error)
			return "Standard layered architecture (Fallback)"
		}
	}
}
