import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../../api"
import { OrchestrationController } from "../OrchestrationController"
import { KANBAN_SYSTEM_PROMPT } from "../prompts"
import { executeMASRequest } from "../utils"

/**
 * KanbanSystem: Manages the "Flow" of work (Task breakdown & tracking).
 * This system takes the product's scope (from Ikigai) and architectural
 * alignment (from JoyZoning) and breaks it down into a stream of cards.
 */
export class KanbanSystem {
	private name = "Kanban"

	/**
	 * Takes the scope and purpose and generates a list of actionable tasks.
	 * Pushes these tasks to the Orchestrator.
	 */
	public async planFlow(
		controller: OrchestrationController,
		apiHandler: ApiHandler,
		purpose: string,
		scope: string[],
		archPlan?: string,
	): Promise<string[]> {
		Logger.info(`[MAS][${this.name}] Planning flow for purpose: ${purpose.slice(0, 50)}...`)
		Logger.info(`[MAS][${this.name}] Scope: ${scope.join(", ")}`)

		// Start a new task for flow planning
		await controller.beginTask("Planning Task Flow (Kanban)")

		try {
			const prompt = `Product Purpose: ${purpose}\nScope: ${scope.join(", ")}${archPlan ? `\nArchitectural Plan: ${archPlan}` : ""}`
			const res = await executeMASRequest(apiHandler, KANBAN_SYSTEM_PROMPT, prompt)
			const tasks = res.tasks || []

			// --- BroccoliDB Native Persistence ---
			const ctx = await controller.getAgentContext()
			const ikigaiId = `ikigai-${controller.getStreamId()}`
			const archId = `arch-${controller.getStreamId()}`

			// Store in memory (legacy/fallback)
			await controller.storeMemory("task_flow", JSON.stringify(tasks))

			// Create each task in the orchestrator AND BroccoliDB (Concurrent Batch)
			const spawnPromises = tasks.map(async (taskDescription: string, i: number) => {
				const taskId = `task-${controller.getStreamId()}-${i}`

				// Native BroccoliDB Task
				await ctx.spawnTask(taskId, "mas-orchestrator", taskDescription, [ikigaiId, archId])

				// Semantic Enrichment: Auto-discover relationships to existing project knowledge
				try {
					const { discovered } = await ctx.autoDiscoverRelationships(taskId, 3)
					if (discovered > 0) {
						Logger.info(
							`[MAS][${this.name}] Semantic grounding: Auto-linked task ${taskId} to ${discovered} related nodes.`,
						)
					}
				} catch (discoveryError) {
					Logger.warn(`[MAS][${this.name}] Semantic discovery failed for task ${taskId}:`, discoveryError)
				}

				// Legacy Orchestrator Task (for UI/Stream compatibility)
				await controller.beginTask(taskDescription)
				await controller.updateTaskProgress("pending")
			})

			await Promise.all(spawnPromises)
			// --------------------------------------

			await controller.updateTaskProgress("completed", `Planned ${tasks.length} tasks matching the product scope.`)

			return tasks
		} catch (error) {
			Logger.error(`[MAS][${this.name}] Failed to plan flow:`, error)
			// Fallback to minimal task
			const tasks = ["Implement core functionality"]
			return tasks
		}
	}

	/**
	 * Retrieves the current task list from memory.
	 */
	public async getStoredTasks(controller: OrchestrationController): Promise<string[]> {
		const tasksRaw = await controller.recallMemory("task_flow")
		if (!tasksRaw) return []

		try {
			return JSON.parse(tasksRaw)
		} catch (error) {
			Logger.error(`[MAS][${this.name}] Failed to parse stored task flow:`, error)
			return []
		}
	}
}
