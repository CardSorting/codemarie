import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../../api"
import { OrchestrationController } from "../OrchestrationController"
import { KAIZEN_SYSTEM_PROMPT } from "../prompts"
import { executeMASRequest } from "../utils"

/**
 * KaizenSystem: Defines the "Continuous Improvement" feedback loop.
 * This system analyzes the output of a stream, compares it against
 * the Ikigai purpose, and suggests refinements for subsequent passes.
 */
export class KaizenSystem {
	private name = "Kaizen"

	/**
	 * Analyzes the completed tasks and stream summary to identify
	 * improvement areas.
	 */
	public async reflect(controller: OrchestrationController, apiHandler: ApiHandler, feedback: string): Promise<string[]> {
		Logger.info(`[MAS][${this.name}] Reflecting on feedback: ${feedback.slice(0, 50)}...`)

		// Start a new task for reflection
		await controller.beginTask("Continuous Improvement Reflection (Kaizen)")

		try {
			// Retrieve context from memory
			const purpose = (await controller.recallMemory("product_purpose")) || "Unknown"
			const tasksRaw = await controller.recallMemory("task_flow")
			const tasks = tasksRaw ? JSON.parse(tasksRaw) : []

			const prompt = `Product Purpose: ${purpose}\nPlanned Tasks: ${tasks.join(", ")}\nUser Feedback: ${feedback}`
			const res = await executeMASRequest(apiHandler, KAIZEN_SYSTEM_PROMPT, prompt)
			const improvements = res.improvements || []

			// --- BroccoliDB Native Persistence: Soundness Evaluation ---
			const ctx = await controller.getAgentContext()
			const ikigaiId = `ikigai-${controller.getStreamId()}`
			const archId = `arch-${controller.getStreamId()}`
			const soundness = await ctx.getLogicalSoundness([ikigaiId, archId])

			Logger.info(`[MAS][${this.name}] Current Pass Soundness Score: ${soundness.toFixed(2)}`)

			if (soundness < 0.7) {
				improvements.push("Perform a secondary architectural audit to resolve low soundness score.")
				await controller.updateTaskProgress(
					"pending",
					`⚠️ Low logical soundness detected (${soundness.toFixed(2)}). Increasing refinement rigor.`,
				)
			}
			// ---------------------------------------------------------

			// Store in memory
			await controller.storeMemory("improvement_plan", JSON.stringify(improvements))

			await controller.updateTaskProgress("completed", `Identified ${improvements.length} improvements based on feedback.`)

			return improvements
		} catch (error) {
			Logger.error(`[MAS][${this.name}] Failed to reflect on feedback:`, error)
			// Fallback to minimal improvement
			const improvements = ["Refine implementation based on feedback"]
			return improvements
		}
	}

	/**
	 * Retrieves the current improvement plan from memory.
	 */
	public async getStoredImprovements(controller: OrchestrationController): Promise<string[]> {
		const improvementsRaw = await controller.recallMemory("improvement_plan")
		if (!improvementsRaw) return []

		try {
			return JSON.parse(improvementsRaw)
		} catch (error) {
			Logger.error(`[MAS][${this.name}] Failed to parse stored improvement plan:`, error)
			return []
		}
	}
}
