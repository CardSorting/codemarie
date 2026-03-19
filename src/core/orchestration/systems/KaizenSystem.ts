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
	public async reflect(
		controller: OrchestrationController,
		apiHandler: ApiHandler,
		feedback: string,
	): Promise<Record<string, string[]>> {
		Logger.info(`[MAS][${this.name}] Reflecting on feedback: ${feedback.slice(0, 50)}...`)

		// Start a new task for reflection
		await controller.beginTask("Continuous Improvement Reflection (Kaizen)")

		try {
			// Retrieve context from memory
			const purpose = (await controller.recallMemory("product_purpose")) || "Unknown"
			const tasksRaw = await controller.recallMemory("task_flow")
			const tasks = tasksRaw ? JSON.parse(tasksRaw) : []

			const prompt = `Product Purpose: ${purpose}\nPlanned Tasks: ${tasks.join(", ")}\nUser Feedback: ${feedback}\n\nCategorize your improvements into: ARCHITECTURE, STABILITY, SECURITY, or GENERAL.`
			const res = await executeMASRequest(apiHandler, KAIZEN_SYSTEM_PROMPT, prompt)

			// Support both legacy array and categorized object
			const improvements: any = res.categorizedImprovements || { GENERAL: res.improvements || [] }

			// --- Tier 4: Adaptive Reprioritization (Interconnected Cognitive Fabric) ---
			const ctx = await controller.getAgentContext()
			const ikigaiId = `ikigai-${controller.getStreamId()}`
			const archId = `arch-${controller.getStreamId()}`
			const soundness = await ctx.getLogicalSoundness([ikigaiId, archId])

			Logger.info(`[MAS][${this.name}] Current Pass Soundness Score: ${soundness.toFixed(2)}`)

			if (soundness < 0.7) {
				const archFixes = improvements.ARCHITECTURE || []
				archFixes.push("Perform a secondary architectural audit to resolve low soundness score.")
				improvements.ARCHITECTURE = archFixes
				await controller.updateTaskProgress(
					"pending",
					`⚠️ Low logical soundness detected (${soundness.toFixed(2)}). Increasing refinement rigor.`,
				)

				// Native Interconnect: Directly reprioritize existing tasks in BroccoliDB
				const streamTasks = await controller.getStreamTasks()
				for (const task of streamTasks) {
					if (task.status === "pending" || task.status === "running") {
						// Downgrade existing feature tasks to make room for refinement
						let metadata: any = {}
						try {
							metadata = typeof task.result === "string" ? JSON.parse(task.result) : task.result || {}
						} catch (_e) {
							metadata = { rawResult: task.result }
						}

						await ctx.updateTaskStatus(task.id, "pending", {
							...metadata,
							priority: "low",
							reason: `Downgraded due to low architectural soundness (${soundness.toFixed(2)})`,
						})
					}
				}
				Logger.info(`[MAS][${this.name}] Downgraded ${streamTasks.length} pending/running tasks due to low soundness.`)
			} else {
				// Annotate the Ikigai node with a "Seal of Quality"
				await controller.annotateKnowledge(ikigaiId, "kaizen", `Cog-Quality Seal: Soundness ${soundness.toFixed(2)}`, {
					pass: "refinement",
					soundness,
				})
			}
			// --------------------------------------------------------------------------

			// Store in memory
			await controller.storeMemory("improvement_plan", JSON.stringify(improvements))

			const count = Object.values(improvements).flat().length
			await controller.updateTaskProgress("completed", `Identified ${count} improvements based on feedback.`)

			return improvements
		} catch (error) {
			Logger.error(`[MAS][${this.name}] Failed to reflect on feedback:`, error)
			const improvements: Record<string, string[]> = { GENERAL: ["Refine implementation based on feedback"] }
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

	/**
	 * Performs a deep semantic architectural audit on a file.
	 */
	public async audit(
		controller: OrchestrationController,
		apiHandler: ApiHandler,
		filePath: string,
		content: string,
	): Promise<{ violations: string[] }> {
		Logger.info(`[MAS][${this.name}] Auditing file: ${filePath}`)
		const prompt = `Perform a DEEP ARCHITECTURAL AUDIT on this file: ${filePath}\nContent:\n${content}`
		const res = await executeMASRequest(apiHandler, KAIZEN_SYSTEM_PROMPT, prompt)
		return { violations: res.violations || [] }
	}
}
