import { Logger } from "@/shared/services/Logger"
import { validateJoyZoning } from "@/utils/joy-zoning"
import { ApiHandler } from "../api"
import { OrchestrationController } from "./OrchestrationController"
import { IkigaiSystem } from "./systems/IkigaiSystem"
import { JoyZoningSystem } from "./systems/JoyZoningSystem"
import { KaizenSystem } from "./systems/KaizenSystem"
import { KanbanSystem } from "./systems/KanbanSystem"

/**
 * MultiAgentStreamSystem: The central controller for the MAS orchestration.
 * It coordinates the flow between Ikigai, JoyZoning, Kanban, and Kaizen.
 */
export class MultiAgentStreamSystem {
	private name = "MAS"
	private ikigai = new IkigaiSystem()
	private kanban = new KanbanSystem()
	private kaizen = new KaizenSystem()
	private joyZoning = new JoyZoningSystem()

	constructor(
		private controller: OrchestrationController,
		private apiHandler: ApiHandler,
	) {}

	private isAgentRegistered = false

	/**
	 * Executes the full MAS pass for a new product/feature.
	 */
	public async executeFirstPass(
		userRequest: string,
		groundedSpec?: any,
	): Promise<{ success: boolean; clarificationNeeded?: string }> {
		const ctx = await this.controller.getAgentContext()

		// Tier 2: Memoized Agent Registration (Zero DB overhead on repeat calls)
		if (!this.isAgentRegistered) {
			await ctx.registerAgent("mas-orchestrator", "Multi-Agent Stream", "Orchestrator", [
				"reasoning",
				"task_management",
				"architecture",
			])
			this.isAgentRegistered = true
		}

		// Tier 4: Unified Cognitive Fabric (Interconnect Digest)
		const digest = await this.controller.getStreamDigest()
		const enrichedRequest = `Collective System Context:\n${digest}\n\nUser Request: ${userRequest}`

		Logger.info(`[${this.name}] Starting first pass with unified cognitive digest...`)

		// Tier 2: Speculative Cog-Parallelism (Heal while reasoning)
		const healPromise = ctx.selfHealGraph().catch((e: any) => {
			Logger.warn(`[${this.name}] Background self-healing failed, ignoring to protect stream:`, e)
			return { prunedNodes: [] }
		})

		const [healResult, ikigaiResult] = await Promise.all([
			healPromise,
			this.ikigai.defineScope(this.controller, this.apiHandler, enrichedRequest, groundedSpec),
		])

		if (healResult && healResult.prunedNodes && healResult.prunedNodes.length > 0) {
			Logger.info(
				`[${this.name}] Self-Healing: Pruned ${healResult.prunedNodes.length} stale/contradictory reasoning nodes.`,
			)
		}

		const { purpose, scope, clarificationNeeded } = ikigaiResult
		await ctx.flush() // 🚀 Proactive flush for high throughput

		if (clarificationNeeded) {
			Logger.info(`[${this.name}] Clarification required for request: ${userRequest}`)
			return { success: false, clarificationNeeded }
		}

		// 2. JoyZoning Pass — Architectural Alignment
		const archPlan = await this.joyZoning.reviewArchitecture(this.controller, this.apiHandler, purpose, scope)
		await ctx.flush() // 🚀 Proactive flush for high throughput

		// 3. Kanban Pass — Break down into tasks
		await this.kanban.planFlow(this.controller, this.apiHandler, purpose, scope, archPlan, groundedSpec)
		await ctx.flush() // 🚀 Proactive flush for high throughput

		Logger.info(`[${this.name}] First pass completed. Ready for execution.`)
		return { success: true }
	}

	/**
	 * Executes a refinement pass based on user feedback.
	 */
	public async executeRefinementPass(feedback: string): Promise<void> {
		Logger.info(`[${this.name}] Starting refinement pass for feedback: ${feedback.slice(0, 50)}...`)

		// Tier 4: Unified Cognitive Fabric (Interconnect Digest)
		const digest = await this.controller.getStreamDigest()
		const enrichedFeedback = `Collective System Context:\n${digest}\n\nUser Feedback: ${feedback}`

		// 1. Kaizen Pass — Reflect on feedback and output
		const improvements = await this.kaizen.reflect(this.controller, this.apiHandler, enrichedFeedback)

		// 2. Kanban Pass — Add refinement tasks to the stream
		const purpose = (await this.controller.recallMemory("product_purpose")) || "Refining Product"
		await this.kanban.planFlow(this.controller, this.apiHandler, purpose, improvements)

		Logger.info(`[${this.name}] Refinement pass completed. Improvements queued.`)
	}

	/**
	 * Performs a Joy-Zoning audit on a file.
	 */
	public async auditFile(filePath: string, content: string): Promise<{ success: boolean; errors: string[] }> {
		const result = validateJoyZoning(filePath, content)
		if (!result.success) {
			Logger.warn(`[${this.name}][JoyZoning] Violation detected in ${filePath}:`, result.errors)
			// Report violation to the current task metadata
			const currentTaskId = this.controller.getCurrentTaskId()
			if (currentTaskId) {
				await this.controller.updateTaskProgress("failed", `Architectural violation: ${result.errors.join("; ")}`, {
					joy_zoning_violations: result.errors,
					violations: result.errors,
				})
			}
		}
		return result
	}
}
