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
		const tasks = await this.generateTasks(apiHandler, purpose, scope, archPlan, groundedSpec)
		await this.spawnTasks(controller, tasks)
		return tasks
	}

	private async generateTasks(
		apiHandler: ApiHandler,
		purpose: string,
		scope: string[],
		archPlan?: string,
		groundedSpec?: any,
	): Promise<KanbanTask[]> {
		let kanbanPrompt = `Product Purpose: ${purpose}\nScope Items: ${scope.join(", ")}\nArchitectural Plan: ${archPlan || "Layered"}`
		if (groundedSpec?.actions && groundedSpec.actions.length > 0) {
			const actionSeeds = groundedSpec.actions.map((a: any) => `- [${a.type}] ${a.description}`).join("\n")
			kanbanPrompt += `\n\n[Grounded Action Seeds]\n${actionSeeds}`
		}
		const res = await executeMASRequest(apiHandler, KANBAN_SYSTEM_PROMPT, kanbanPrompt)
		return res.tasks || []
	}

	private async spawnTasks(controller: OrchestrationController, tasks: KanbanTask[]): Promise<void> {
		const ctx = await controller.getAgentContext()
		const ikigaiId = `ikigai-${controller.getStreamId()}`
		const archId = `arch-${controller.getStreamId()}`

		const spawnPromises = tasks.map(async (task) => {
			const taskId = `task-${controller.getStreamId()}-${task.id}`
			await ctx.spawnTask(taskId, "mas-orchestrator", task.description, [ikigaiId, archId])
			try {
				await ctx.autoDiscoverRelationships(taskId, 3)
			} catch {}
			await controller.beginTask(task.description)
			await controller.updateTaskProgress("pending")
		})
		await Promise.allSettled(spawnPromises)
	}

	/**
	 * Injects refinement tasks into the existing flow.
	 */
	public async injectRefinementTasks(controller: OrchestrationController, descriptions: string[]): Promise<void> {
		if (descriptions.length === 0) return
		Logger.info(`[MAS][${this.name}] Injecting ${descriptions.length} refinement tasks into the stream...`)

		const tasks: KanbanTask[] = descriptions.map((desc, i) => ({
			id: `refine-${Date.now()}-${i}`,
			description: `[REFINEMENT] ${desc}`,
			depends_on: [],
		}))

		await this.spawnTasks(controller, tasks)
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
