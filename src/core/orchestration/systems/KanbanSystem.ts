import { Logger } from "@/shared/services/Logger"
import { ApiHandler } from "../../api"
import { OrchestrationController } from "../OrchestrationController"
import { KANBAN_SYSTEM_PROMPT } from "../prompts"
import { executeMASRequest } from "../utils"

export interface KanbanTask {
	id: string
	description: string
	depends_on: string[]
}

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
		groundedSpec?: any,
	): Promise<KanbanTask[]> {
		Logger.info(`[MAS][${this.name}] Planning flow for purpose: ${purpose.slice(0, 50)}...`)
		Logger.info(`[MAS][${this.name}] Scope: ${scope.join(", ")}`)

		// Start a new task for flow planning
		await controller.beginTask("Planning Task Flow (Kanban)")

		try {
			// Tier 3: Task-Level Grounding (Using IntentGrounder seeds)
			let kanbanPrompt = `Product Purpose: ${purpose}\nScope Items: ${scope.join(", ")}\nArchitectural Plan: ${archPlan || "Layered"}`
			if (groundedSpec?.actions && groundedSpec.actions.length > 0) {
				const actionSeeds = groundedSpec.actions.map((a: any) => `- [${a.type}] ${a.description}`).join("\n")
				kanbanPrompt += `\n\n[Grounded Action Seeds]\n${actionSeeds}`
				Logger.info(`[MAS][${this.name}] Seeding Kanban with ${groundedSpec.actions.length} grounded actions.`)
			}
			const res = await executeMASRequest(apiHandler, KANBAN_SYSTEM_PROMPT, kanbanPrompt)
			const tasks: KanbanTask[] = res.tasks || []

			// --- BroccoliDB Native Persistence ---
			const ctx = await controller.getAgentContext()
			const ikigaiId = `ikigai-${controller.getStreamId()}`
			const archId = `arch-${controller.getStreamId()}`

			// Store in memory (legacy/fallback)
			await controller.storeMemory("task_flow", JSON.stringify(tasks))

			// Create each task in the orchestrator AND BroccoliDB (Concurrent Batch)
			const spawnPromises = tasks.map(async (task, i: number) => {
				const taskId = `task-${controller.getStreamId()}-${task.id}`

				// Native BroccoliDB Task
				await ctx.spawnTask(taskId, "mas-orchestrator", task.description, [ikigaiId, archId])

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
				await controller.beginTask(task.description)
				await controller.updateTaskProgress("pending")
			})

			await Promise.allSettled(spawnPromises)
			// --------------------------------------

			await controller.updateTaskProgress("completed", `Planned ${tasks.length} tasks matching the product scope.`)

			return tasks
		} catch (error) {
			Logger.error(`[MAS][${this.name}] Failed to plan flow:`, error)
			// Fallback to minimal task
			const fallbackTask: KanbanTask = {
				id: "t1",
				description: "Implement core functionality",
				depends_on: [],
			}
			return [fallbackTask]
		}
	}

	/**
	 * Retrieves the current task list from memory.
	 */
	public async getStoredTasks(controller: OrchestrationController): Promise<KanbanTask[]> {
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
