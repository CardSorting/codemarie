import { Logger } from "@/shared/services/Logger"
import { LRUCache } from "@/shared/utils/LRUCache"
import { validateJoyZoning } from "@/utils/joy-zoning"
import { ApiHandler } from "../api"
import { OrchestrationController } from "./OrchestrationController"
import { StreamPool, type StreamPoolResult } from "./StreamPool"
import { IkigaiSystem } from "./systems/IkigaiSystem"
import { JoyZoningSystem } from "./systems/JoyZoningSystem"
import { KaizenSystem } from "./systems/KaizenSystem"
import { KanbanSystem, type KanbanTask } from "./systems/KanbanSystem"

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

	/** Last pool result from concurrent build dispatch */
	private lastPoolResult?: StreamPoolResult
	private reflectionCache = new LRUCache<string[]>(10, 3600000) // 1 hour TTL
	private stickyReflectionCache = new Map<string, string[]>() // Long-term unaddressed insights
	private lastSoundnessScore = 1.0

	constructor(
		public controller: OrchestrationController,
		private apiHandler: ApiHandler,
		private concurrency = 3,
	) {}

	private isAgentRegistered = false

	public async executeFirstPass(
		userRequest: string,
		groundedSpec?: unknown,
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

		Logger.info(`[${this.name}] Starting first pass (PLANNING phase)...`)
		await this.controller.updateTaskProgress("planning")

		// Tier 2: Speculative Cog-Parallelism (Heal while reasoning)
		const healPromise = ctx.selfHealGraph().catch((e: unknown) => {
			Logger.warn(`[${this.name}] Background self-healing failed, ignoring to protect stream:`, e)
			return { prunedNodes: [] }
		})

		const [healResult, ikigaiResult] = await Promise.all([
			healPromise,
			this.ikigai.defineScope(this.controller, this.apiHandler, enrichedRequest, groundedSpec),
		])

		if (healResult?.prunedNodes && healResult.prunedNodes.length > 0) {
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
		const tasks = await this.kanban.planFlow(this.controller, this.apiHandler, purpose, scope, archPlan, groundedSpec)
		await ctx.flush() // 🚀 Proactive flush for high throughput

		Logger.info(`[${this.name}] Planning phase complete. ${tasks.length} tasks ready.`)
		await this.controller.updateTaskProgress("planned")

		// 4. Concurrent Build Dispatch (Tier 5: Swarm-Parallel Execution)
		if (tasks.length > 0) {
			this.lastPoolResult = await this.executeConcurrentBuild(tasks)
			Logger.info(
				`[${this.name}] Build: ${this.lastPoolResult.completed}/${this.lastPoolResult.totalTasks} tasks succeeded in ${this.lastPoolResult.durationMs}ms`,
			)

			// 5. Final Materialization (Sync DB to Physical Disk)
			if (this.lastPoolResult.completed > 0) {
				await this.controller.materialize()
			}
		}

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
	 * Dispatches Kanban tasks to a concurrent StreamPool for DAG parallel execution.
	 * Each task runs in its own isolated child stream with DB shadow.
	 */
	public async executeConcurrentBuild(tasks: KanbanTask[]): Promise<StreamPoolResult> {
		Logger.info(`[${this.name}] Dispatching ${tasks.length} tasks to StreamPool (concurrency: ${this.concurrency})...`)
		await this.controller.updateTaskProgress("acting")

		const pool = new StreamPool(this.controller, this.apiHandler, {
			maxConcurrency: this.concurrency,
			parentStreamId: this.controller.getStreamId(),
			userId: this.controller.getUserId(),
			workspaceId: this.controller.getWorkspaceId(),
		})

		const result = await pool.dispatch(tasks)

		// Store the aggregated digest for refinement passes
		try {
			const aggregatedDigest = await pool.getAggregatedDigest()
			await this.controller.storeMemory("concurrent_digest", aggregatedDigest)
		} catch (err) {
			Logger.warn(`[${this.name}] Failed to store concurrent digest:`, err)
		}

		return result
	}

	/**
	 * Returns the result from the last concurrent build dispatch.
	 */
	public getLastPoolResult(): StreamPoolResult | undefined {
		return this.lastPoolResult
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

	/**
	 * Reflects on the current turn's tool outputs and provides high-level insights.
	 */
	public async executeTurnReflection(turnSummary: string): Promise<string[] | undefined> {
		Logger.info(`[${this.name}] Executing turn-based reflection...`)
		try {
			const digest = await this.controller.getStreamDigest()
			const enrichedSummary = `Collective System Context:\n${digest}\n\nTurn Summary: ${turnSummary}`
			const improvements = await this.kaizen.reflect(this.controller, this.apiHandler, enrichedSummary)

			// Update soundness score from Kaizen's internal assessment if possible
			// For now, we'll pull it from the agent context as Kaizen does
			const ctx = await this.controller.getAgentContext()
			const ikigaiId = `ikigai-${this.controller.getStreamId()}`
			const archId = `arch-${this.controller.getStreamId()}`
			this.lastSoundnessScore = await ctx.getLogicalSoundness([ikigaiId, archId])

			// High Throughput: Store reflection in local LRU cache
			if (improvements && improvements.length > 0) {
				const streamId = this.controller.getStreamId()
				this.reflectionCache.set(streamId, improvements)

				// Phase 4: Sticky Insights & Auto-Stabilization
				const isCritical = improvements.some(
					(imp) => imp.toUpperCase().includes("CRITICAL") || imp.toUpperCase().includes("VIOLATION"),
				)
				if (isCritical || this.lastSoundnessScore < 0.5) {
					const stickyKey = `sticky-${streamId}`
					const existing = this.stickyReflectionCache.get(stickyKey) || []
					this.stickyReflectionCache.set(stickyKey, [...new Set([...existing, ...improvements])])

					// Auto-Stabilization: Inject tasks if soundness is critical
					if (this.lastSoundnessScore < 0.5) {
						await this.kanban.injectRefinementTasks(this.controller, [
							"Mandatory Stabilization Pass: Resolve architectural debt and low soundness score.",
						])
					}
				} else {
					// Auto-Pruning: Clear sticky insights if the MAS no longer sees them as critical
					this.stickyReflectionCache.delete(`sticky-${streamId}`)
				}

				return improvements
			}
		} catch (err) {
			Logger.warn(`[${this.name}] Turn reflection failed:`, err)
		}
		return undefined
	}

	/**
	 * Retrieves the latest reflection from the high-throughput cache.
	 */
	public getLatestReflection(): string[] | undefined {
		return this.reflectionCache.get(this.controller.getStreamId())
	}

	/**
	 * Returns the sticky (unaddressed) insights for the current stream.
	 */
	public getStickyInsights(): string[] {
		return this.stickyReflectionCache.get(`sticky-${this.controller.getStreamId()}`) || []
	}

	/**
	 * Manually resolves a specific sticky insight.
	 */
	public resolveStickyInsight(insightIndex: number): void {
		const streamId = this.controller.getStreamId()
		const stickyKey = `sticky-${streamId}`
		const insights = this.stickyReflectionCache.get(stickyKey) || []
		if (insightIndex >= 0 && insightIndex < insights.length) {
			insights.splice(insightIndex, 1)
			if (insights.length === 0) {
				this.stickyReflectionCache.delete(stickyKey)
			} else {
				this.stickyReflectionCache.set(stickyKey, insights)
			}
		}
	}

	/**
	 * Returns the latest architectural soundness score calculated by the MAS.
	 */
	public getSoundnessScore(): number {
		return this.lastSoundnessScore
	}

	/**
	 * Executes a final architectural audit of the entire stream.
	 * Aggregates all turn reflections into a "Handoff Digest" in BroccoliDB.
	 */
	public async executeFinalAudit(): Promise<string | undefined> {
		Logger.info(`[${this.name}] Executing final architectural audit...`)
		try {
			const streamId = this.controller.getStreamId()
			const digest = await this.controller.getStreamDigest()
			const reflections = await this.controller.recallMemory("turn_reflection")

			// Phase 3: Specialized Kaizen Post-Mortem
			const postMortemReflection = await this.executePostMortem()

			const postMortem = `Final Post-Mortem for Stream ${streamId}:\nStatus: Completed\nReflections: ${reflections || "None"}\nSwarm Insight: ${postMortemReflection || "N/A"}\nSystem Digest: ${digest}`

			// Store as a formal "handoff" node in BroccoliDB
			const ctx = await this.controller.getAgentContext()
			await ctx.addKnowledge(`handoff-${streamId}`, "conclusion", postMortem, { agentId: "mas-orchestrator" })
			await ctx.flush()

			return postMortem
		} catch (err) {
			Logger.warn(`[${this.name}] Final audit failed:`, err)
		}
		return undefined
	}

	/**
	 * Perfroms a specialized "Post-Mortem" reflection to summarize architectural debt.
	 */
	public async executePostMortem(): Promise<string | undefined> {
		Logger.info(`[${this.name}] Generating post-mortem reflection...`)
		try {
			const digest = await this.controller.getStreamDigest()
			const prompt = `Perform a FINAL ARCHITECTURAL AUDIT of this stream. Identify any remaining technical debt, JoyZoning violations, or stability risks:\n${digest}`
			const improvements = await this.kaizen.reflect(this.controller, this.apiHandler, prompt)
			if (improvements && improvements.length > 0) {
				return improvements.join("; ")
			}
		} catch (err) {
			Logger.warn(`[${this.name}] Post-mortem reflection failed:`, err)
		}
		return undefined
	}

	/**
	 * Synchronizes the MAS with a task abort event.
	 */
	public async reportAbort(reason: string): Promise<void> {
		Logger.info(`[${this.name}] Reporting task abort: ${reason}`)
		try {
			const streamId = this.controller.getStreamId()
			await this.controller.storeMemory("abort_reason", reason)

			// Mark current stream as failed in MAS architecture
			const ctx = await this.controller.getAgentContext()
			await ctx.addKnowledge(`abort-${streamId}-${Date.now()}`, "fact", reason, { agentId: "mas-orchestrator" })
			await ctx.flush()
		} catch (err) {
			Logger.warn(`[${this.name}] Failed to report abort to MAS:`, err)
		}
	}

	/**
	 * Ingests user feedback into the MAS context to refine planning.
	 */
	public async processUserFeedback(feedback: string): Promise<void> {
		Logger.info(`[${this.name}] Ingesting user feedback: ${feedback.slice(0, 50)}...`)
		try {
			await this.controller.storeMemory("user_feedback_enrichment", feedback)
			// Trigger a proactive reflection on the feedback
			await this.executeTurnReflection(`User Feedback Received: ${feedback}`)
		} catch (err) {
			Logger.warn(`[${this.name}] Failed to process user feedback:`, err)
		}
	}

	/**
	 * Generates a "Lifeline" (pivot suggestion) when the agent is stuck.
	 */
	public async getStuckLifeline(): Promise<string | undefined> {
		Logger.info(`[${this.name}] Generating stuck agent lifeline...`)
		try {
			const digest = await this.controller.getStreamDigest()
			const prompt = `The agent appears stuck (consecutive mistakes/failures). Based on the following context, suggest a DRAMATIC PIVOT or a different tool approach:\n${digest}`

			const suggestions = await this.kaizen.reflect(this.controller, this.apiHandler, prompt)
			if (suggestions && suggestions.length > 0) {
				return `💡 Swarm Lifeline: ${suggestions[0]}`
			}
		} catch (err) {
			Logger.warn(`[${this.name}] Failed to generate lifeline:`, err)
		}
		return undefined
	}

	/**
	 * Generates coordination advice when a file collision is detected.
	 */
	public async getCollisionAdvice(filePath: string): Promise<string | undefined> {
		Logger.info(`[${this.name}] Generating collision advice for ${filePath}...`)
		try {
			const digest = await this.controller.getStreamDigest()
			const prompt = `A file collision was detected on ${filePath}. Suggest a coordination strategy based on the current swarm state:\n${digest}`
			const strategies = await this.kaizen.reflect(this.controller, this.apiHandler, prompt)
			if (strategies && strategies.length > 0) {
				return `🧱 Swarm Coordination: ${strategies[0]}`
			}
		} catch (err) {
			Logger.warn(`[${this.name}] Failed to generate collision advice:`, err)
		}
		return undefined
	}
}
