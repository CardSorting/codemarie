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
	private reflectionCache = new LRUCache<Record<string, string[]>>(10, 3600000) // Categorized
	private stickyReflectionCache = new Map<string, string[]>() // Long-term unaddressed insights
	private toolFailureTracker = new Map<string, number>()
	private adherenceFailures = 0
	private soundnessTrend: number[] = []
	private lastSoundnessScore = 1.0
	private lastEntropyScore = 0.0
	private entropyTrend: number[] = []

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
		const flattened = Object.values(improvements).flat()
		await this.kanban.planFlow(this.controller, this.apiHandler, purpose, flattened)

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

		// Phase 6: Deep Semantic Auditing
		try {
			const auditResult = await this.kaizen.audit(this.controller, this.apiHandler, filePath, content)
			if (auditResult.violations.length > 0) {
				result.success = false
				result.errors = [...new Set([...result.errors, ...auditResult.violations])]
			}
		} catch (err) {
			Logger.warn(`[${this.name}] Deep semantic audit failed:`, err)
		}

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
			const categorizedImprovements = await this.kaizen.reflect(this.controller, this.apiHandler, enrichedSummary)

			// Update soundness score from Kaizen's internal assessment if possible
			// For now, we'll pull it from the agent context as Kaizen does
			const ctx = await this.controller.getAgentContext()
			const ikigaiId = `ikigai-${this.controller.getStreamId()}`
			const archId = `arch-${this.controller.getStreamId()}`
			this.lastSoundnessScore = await ctx.getLogicalSoundness([ikigaiId, archId])

			// Integrate with FluidPolicyEngine's entropy if available
			// Note: Entropy is typically per-turn/per-file, so we average it or take the max
			// For MAS level, we'll track the latest turn's impact
			const lastEntropyMemory = await this.controller.recallMemory("latest_entropy_score")
			this.lastEntropyScore = lastEntropyMemory ? Number.parseFloat(lastEntropyMemory) : 0.0

			// High Throughput: Store reflection in local LRU cache
			if (categorizedImprovements && Object.keys(categorizedImprovements).length > 0) {
				// Flatten for sticky checks
				const allImprovements = Object.values(categorizedImprovements).flat()

				// Update soundness and entropy trends
				this.soundnessTrend.push(this.lastSoundnessScore)
				this.entropyTrend.push(this.lastEntropyScore)
				if (this.soundnessTrend.length > 5) this.soundnessTrend.shift()
				if (this.entropyTrend.length > 5) this.entropyTrend.shift()

				// Phase 6: Reflection Adherence Tracking
				const streamId = this.controller.getStreamId()
				const stickyKey = `sticky-${streamId}`
				const existingSticky = this.stickyReflectionCache.get(stickyKey) || []

				if (existingSticky.length > 0) {
					// Check if any existing sticky insight is still mentioned in the new reflection
					const stillPresent = allImprovements.some((imp) =>
						existingSticky.some((sticky) => imp.includes(sticky.slice(0, 20))),
					)
					if (stillPresent) {
						this.adherenceFailures++
						Logger.warn(`[${this.name}] Adherence failure detected (${this.adherenceFailures}/2). Guidance ignored.`)
					} else {
						// Recovering adherence
						this.adherenceFailures = Math.max(0, this.adherenceFailures - 1)
					}
				}

				// Phase 4 & 6: Sticky Insights, Auto-Stabilization, and Predictive Abort
				const isCritical = allImprovements.some(
					(imp) => imp.toUpperCase().includes("CRITICAL") || imp.toUpperCase().includes("VIOLATION"),
				)

				// Predictive Mission Termination: Declining soundness or rising entropy
				if (this.soundnessTrend.length >= 3) {
					const isSoundnessDeclining = this.soundnessTrend.slice(-3).every((val, i, arr) => i === 0 || val < arr[i - 1])
					const isEntropyRising =
						this.entropyTrend.length >= 3 &&
						this.entropyTrend.slice(-3).every((val, i, arr) => i === 0 || val > arr[i - 1])

					if (
						(isSoundnessDeclining && this.lastSoundnessScore < 0.6) ||
						(isEntropyRising && this.lastEntropyScore > 0.8)
					) {
						await this.reportAbort(
							`Predictive Termination: Extreme architectural instability detected (Soundness: ${this.lastSoundnessScore.toFixed(2)}, Entropy: ${this.lastEntropyScore.toFixed(2)}).`,
						)
						// Trigger abort in task state via controller if possible
						return undefined
					}
				}

				if (isCritical || this.lastSoundnessScore < 0.5 || this.adherenceFailures > 1) {
					this.stickyReflectionCache.set(stickyKey, [...new Set([...existingSticky, ...allImprovements])])

					// Auto-Stabilization: Inject tasks if soundness is critical
					if (this.lastSoundnessScore < 0.5 || this.adherenceFailures > 1) {
						await this.kanban.injectRefinementTasks(this.controller, [
							this.adherenceFailures > 1
								? "Mandatory Alignment Pass: Resolve persistent architectural guidance violations."
								: "Mandatory Stabilization Pass: Resolve architectural debt and low soundness score.",
						])
					}
				} else {
					// Auto-Pruning: Clear sticky insights if the MAS no longer sees them as critical
					this.stickyReflectionCache.delete(stickyKey)
				}

				return allImprovements
			}
		} catch (err) {
			Logger.warn(`[${this.name}] Turn reflection failed:`, err)
		}
		return undefined
	}

	/**
	 * Retrieves the latest reflection from the high-throughput cache.
	 */
	public getLatestReflection(): Record<string, string[]> | undefined {
		return this.reflectionCache.get(this.controller.getStreamId())
	}

	/**
	 * Returns the sticky (unaddressed) insights for the current stream.
	 */
	public getStickyInsights(): string[] {
		const streamId = this.controller.getStreamId()
		return this.stickyReflectionCache.get(`sticky-${streamId}`) || []
	}

	/**
	 * Resolves a sticky insight.
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

			// Phase 3: Specialized Kaizen Post-Mortem
			const postMortemReflection = await this.executePostMortem()

			// Phase 5: Consumer-First Handoff Digest
			const handoff = `
# 🏁 Swarm Handoff Digest (Stream ${streamId})
				
## 📊 Success Metrics
- **Architectural Soundness**: ${this.getSoundnessScore().toFixed(2)} / 1.00
- **Status**: ${postMortemReflection ? "COMPLETED WITH DEBT" : "CLEAN COMPLETION"}
				
## 🧠 Critical Context for the Next Agent
${postMortemReflection || "No significant architectural debt detected."}
				
## 🛠️ Tool Volatility Report
${
	Array.from(this.toolFailureTracker.entries())
		.map(([tool, count]) => `- ${tool}: ${count} failures`)
		.join("\n") || "No tool usage issues detected."
}

## 📥 Operational Digest
${digest.slice(0, 1000)}...
`.trim()

			// Store as a formal "handoff" node in BroccoliDB
			const ctx = await this.controller.getAgentContext()
			await ctx.addKnowledge(`handoff-${streamId}`, "conclusion", handoff, {
				agentId: "mas-orchestrator",
				tags: ["handoff"],
			})
			await ctx.flush()

			return handoff
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
			const flattened = Object.values(improvements).flat()
			if (flattened.length > 0) {
				return flattened.join("; ")
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
			const flattened = Object.values(suggestions).flat()
			if (flattened.length > 0) {
				return `💡 Swarm Lifeline: ${flattened[0]}`
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
			const flattened = Object.values(strategies).flat()
			if (flattened.length > 0) {
				return `🧱 Swarm Coordination: ${flattened[0]}`
			}
		} catch (err) {
			Logger.warn(`[${this.name}] Failed to generate collision advice:`, err)
		}
		return undefined
	}

	/**
	 * Checks for global swarm updates (handoffs from sibling streams).
	 */
	public async checkGlobalSwarmUpdates(): Promise<string | undefined> {
		try {
			const ctx = await this.controller.getAgentContext()
			const latestHandoffs = await ctx.searchKnowledge("handoff", ["handoff"], 1)
			if (latestHandoffs.length > 0) {
				const handoff = latestHandoffs[0]
				const streamId = this.controller.getStreamId()
				if (handoff && !handoff.itemId.includes(streamId)) {
					return `🌐 Global Swarm Update: A sibling stream has completed a mission. Key Insight: ${handoff.content.slice(0, 100)}...`
				}
			}
		} catch (err) {
			Logger.warn(`[${this.name}] Failed to check global swarm updates:`, err)
		}
		return undefined
	}

	/**
	 * Tracks a tool failure to provide specialized hardening advice.
	 */
	public trackToolFailure(toolName: string): void {
		const count = (this.toolFailureTracker.get(toolName) || 0) + 1
		this.toolFailureTracker.set(toolName, count)
	}

	/**
	 * Calculates the mission risk level based on tool volatility and soundness.
	 */
	public async calculateRiskLevel(): Promise<"LOW" | "MEDIUM" | "HIGH"> {
		const soundness = this.getSoundnessScore()
		const failureCount = Array.from(this.toolFailureTracker.values()).reduce((a, b) => a + b, 0)

		if (soundness < 0.4 || failureCount > 5 || this.adherenceFailures > 1) return "HIGH"
		if (soundness < 0.7 || failureCount > 2 || this.adherenceFailures > 0) return "MEDIUM"
		return "LOW"
	}

	/**
	 * Returns specialized "Tool-Doctor" advice if a tool is failing repeatedly.
	 */
	public getToolDoctorAdvice(toolName: string): string | undefined {
		const failures = this.toolFailureTracker.get(toolName) || 0
		if (failures > 2) {
			return `🩺 Tool Doctor: You have failed \`${toolName}\` ${failures} times. Try simplifying the parameters or checking the file path existence before retrying.`
		}
		return undefined
	}
}
