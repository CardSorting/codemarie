import { ToolUse } from "@core/assistant-message"
import { CodemarieDefaultTool } from "@shared/tools"
import { createHash } from "crypto"
import fs from "fs/promises"
import * as path from "path"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { OrchestrationController } from "../orchestration/OrchestrationController"
import { StateManager } from "../storage/StateManager"
import { TspPolicyPlugin } from "./TspPolicyPlugin"

export interface PolicyResult {
	success: boolean
	error?: string
	warning?: string
	violations?: string[]
	entropyScore?: number
	correctionHint?: string
}

/**
 * FluidPolicyEngine: The single point of enforcement for architectural (Joy-Zoning),
 * concurrency (Collision), and stability (Entropy) rules.
 *
 * Progressive Enforcement Strategy:
 * - Strike 1 (domain only): Hard block — the write is rejected with correction hints.
 * - Strike 2+: Graceful degradation — the write proceeds with a strong warning injected.
 * - Core layer: Always warning-only (never hard-blocked).
 * - Other layers: Warning-only.
 * This prevents infinite deadlock while still educating the agent.
 */
export class FluidPolicyEngine {
	private readonly tspPlugin = new TspPolicyPlugin()
	private mode: "plan" | "act" = "act"
	private commitSeal: string | null = null
	private sealReason: string | null = null
	private cachedRules: any[] | null = null
	private layerCache: Map<string, string> = new Map()
	private soundnessScore = 1.0
	private collisionAdvisor?: (filePath: string) => Promise<string | undefined>

	constructor(
		private cwd: string,
		private streamId?: string,
		private stateManager?: StateManager,
		private virtualResolver?: (path: string) => string | undefined,
		private controller?: OrchestrationController,
	) {}

	/**
	 * Increments and persists the strike count for a file.
	 */
	private async incrementStrikes(filePath: string): Promise<number> {
		if (!this.streamId) return 0
		const key = `strikes:${path.basename(filePath)}`
		const currentRaw = await orchestrator.recallMemory(this.streamId, key)
		const newCount = (currentRaw ? Number.parseInt(currentRaw) : 0) + 1
		await orchestrator.storeMemory(this.streamId, key, newCount.toString())

		// --- BroccoliDB Native Persistence ---
		if (this.controller) {
			const ctx = await this.controller.getAgentContext()
			await ctx.appendMemoryLayer(
				"mas-orchestrator",
				`⚠️ Strike ${newCount} recorded for architectural violation in: ${path.basename(filePath)}`,
			)

			// Update total stream strikes for entropy weighing
			const totalKey = "total_architectural_strikes"
			const currentTotalRaw = await orchestrator.recallMemory(this.streamId, totalKey)
			const newTotal = (currentTotalRaw ? Number.parseInt(currentTotalRaw) : 0) + 1
			await orchestrator.storeMemory(this.streamId, totalKey, newTotal.toString())
		}
		// --------------------------------------

		// Global project memory (legacy tracking)
		if (this.stateManager) {
			const strikes = { ...this.stateManager.getGlobalStateKey("architecturalStrikes") }
			strikes[filePath] = newCount
			this.stateManager.setGlobalState("architecturalStrikes", strikes)
		}

		return newCount
	}

	/**
	 * Resets strikes for a file once it's clean.
	 */
	private async resetStrikes(filePath: string): Promise<void> {
		if (this.streamId) {
			await orchestrator.storeMemory(this.streamId, `strikes:${path.basename(filePath)}`, "0")
		}
		if (this.stateManager) {
			const strikes = { ...this.stateManager.getGlobalStateKey("architecturalStrikes") }
			if (strikes[filePath]) {
				delete strikes[filePath]
				this.stateManager.setGlobalState("architecturalStrikes", strikes)
			}
		}
	}

	public setMode(mode: "plan" | "act") {
		this.mode = mode
	}

	public setStreamId(streamId: string) {
		this.streamId = streamId
	}

	public setCommitSeal(seal: string, reason: string) {
		this.commitSeal = seal
		this.sealReason = reason
	}

	public setController(controller: OrchestrationController) {
		this.controller = controller
	}

	/**
	 * Sets the architectural soundness score for the current turn.
	 * Lower scores ( < 0.7) trigger more rigorous enforcement.
	 */
	public setSoundnessScore(score: number) {
		this.soundnessScore = score
	}

	/**
	 * Sets the advisor function for swarm-aware collision mitigation.
	 */
	public setCollisionAdvisor(advisor: (filePath: string) => Promise<string | undefined>) {
		this.collisionAdvisor = advisor
	}

	/**
	 * Returns proactive architectural guidance for a given file's layer.
	 */
	public getFileLayerContext(filePath: string): string {
		const { getLayer } = require("@/utils/joy-zoning")
		const layer = getLayer(filePath)
		const fileName = path.basename(filePath)

		switch (layer) {
			case "domain":
				return `📍 ${fileName} → DOMAIN layer\n  ✅ Pure business logic, models, rules, value objects\n  🚫 No I/O, no external imports, no side effects`
			case "core":
				return `📍 ${fileName} → CORE layer\n  ✅ Orchestration, task coordination, prompt assembly\n  🚫 Avoid raw I/O — delegate to Infrastructure adapters`
			case "infrastructure":
				return `📍 ${fileName} → INFRASTRUCTURE layer\n  ✅ Adapters, API clients, persistence, external services\n  🚫 No business rules (keep those in Domain)`
			case "ui":
				return `📍 ${fileName} → UI layer\n  ✅ Components, views, event handlers, visual state\n  🚫 No business logic, no direct I/O`
			case "plumbing":
				return `📍 ${fileName} → PLUMBING layer\n  ✅ Stateless utilities, formatters, pure helpers\n  🚫 No dependencies on Domain, Infrastructure, or UI`
			default:
				return `📍 ${fileName} → INFRASTRUCTURE layer (default)\n  ✅ Adapters and integrations\n  🚫 No business rules`
		}
	}

	/**
	 * Generates a concise, actionable correction hint for architectural violations.
	 */
	public getCorrectionHint(errors: string[]): string {
		const fixes: string[] = []
		for (const err of errors) {
			if (err.includes("import")) fixes.push("Move the import to the appropriate layer, or extract an interface in Domain.")
			else if (err.includes("class")) fixes.push("Split into separate files — one class per file in Domain.")
			else if (err.includes("circular")) fixes.push("Extract shared logic into a Plumbing utility.")
			else fixes.push("Review the violation and restructure accordingly.")
		}
		const uniqueFixes = [...new Set(fixes)]
		return `💡 How to fix:\n${uniqueFixes.map((f) => `  → ${f}`).join("\n")}`
	}

	/**
	 * Validates a tool block before execution.
	 * Uses progressive enforcement: first domain violation blocks, subsequent ones degrade to warnings.
	 */
	public async validatePreExecution(block: ToolUse): Promise<PolicyResult> {
		// In PLAN mode, skip enforcement — agent is only planning, not writing
		// Return guidance instead of blocking
		if (this.mode === "plan" && block.params?.path) {
			const { getLayer } = require("@/utils/joy-zoning")
			const filePath = path.resolve(this.cwd, block.params.path)
			const layer = getLayer(filePath)

			// Predictive Collision Check: Warn early if another stream has a lock
			const collision = await orchestrator.checkCollision(this.streamId || "viewer", [filePath])
			if (collision) {
				let msg = `⚠️ PREDICTIVE COLLISION: You are planning to edit \`${path.basename(filePath)}\`, but it's currently LOCKED by a sibling stream. Coordination is required before acting.`
				if (this.collisionAdvisor) {
					const advice = await this.collisionAdvisor(filePath)
					if (advice) msg += `\n${advice}`
				}
				return {
					success: true,
					warning: msg,
				}
			}

			return {
				success: true,
				warning: `📍 Planning a change in the **${layer.toUpperCase()}** layer (${path.basename(filePath)}).`,
			}
		}

		// Architectural Policy: AST + BroccoliDB Concurrent Pass
		if (
			(block.name === CodemarieDefaultTool.FILE_NEW || block.name === CodemarieDefaultTool.FILE_EDIT) &&
			block.params?.path &&
			block.params?.content
		) {
			const filePath = path.resolve(this.cwd, block.params.path)
			const content = block.params.content!

			const [astValidation, supremeCourtResult] = await Promise.all([
				// 1. AST Validation (TSP)
				Promise.resolve(this.tspPlugin.validateSource(filePath, content, this.virtualResolver)),
				// 2. Supreme Court Pass (LLM + BroccoliDB)
				this.executeSupremeCourtPass(filePath, content),
			])

			// Block on AST Failure (Strike 1 Domain)
			if (!astValidation.success) {
				const layer = this.getCachedLayer(filePath)
				const strikes = await this.incrementStrikes(filePath)
				const allWarnings = [...(astValidation.warnings || []), ...astValidation.errors]
				const violationSummary = allWarnings.map((e: string) => `  - ${e}`).join("\n")

				if (layer === "domain" && strikes === 1 && astValidation.errors.length > 0) {
					const violationSummaryRejection = astValidation.errors.map((e: string) => `  - ${e}`).join("\n")
					return {
						success: false,
						error: `🏗️ ARCHITECTURAL CORRECTION REQUIRED (Strike ${strikes})\nDomain layer file \`${path.basename(filePath)}\` has ${astValidation.errors.length} violation(s):\n${violationSummaryRejection}\n\n${this.getCorrectionHint(astValidation.errors)}\n\n💡 Your write was NOT executed. Please address these violations and try again.`,
						violations: astValidation.errors,
					}
				}

				// Strike 2+ or other layers: Warning only
				return {
					success: true,
					warning:
						layer === "domain"
							? `⚠️ ARCHITECTURAL WARNING (Strike ${strikes} — enforcement degraded): Domain layer file \`${path.basename(filePath)}\` has ${astValidation.errors.length} unresolved violation(s):\n${violationSummary}\n\nThe write is ALLOWED to prevent deadlock.`
							: `⚠️ ARCHITECTURAL WARNING: ${layer.toUpperCase()} layer file \`${path.basename(filePath)}\` has ${astValidation.errors.length} violation(s):\n${violationSummary}`,
					violations: astValidation.errors,
					correctionHint: this.getCorrectionHint(astValidation.errors),
				}
			}

			// Block on Supreme Court Failure
			if (supremeCourtResult) return supremeCourtResult

			// Clean file — reset strikes for this path
			await this.resetStrikes(filePath)

			// Surface AST warnings if any
			if (astValidation.warnings && astValidation.warnings.length > 0) {
				return {
					success: true,
					warning: `⚠️ DISCERNMENT WARNING: Architectural smell(s) detected:\n${astValidation.warnings.map((w: string) => `  - ${w}`).join("\n")}`,
				}
			}

			// For new files: proactively suggest the best layer if content doesn't match location
			if (block.name === CodemarieDefaultTool.FILE_NEW && block.params.content) {
				const { getLayer, suggestLayerForContent } = require("@/utils/joy-zoning")
				const currentLayer = getLayer(filePath)
				const suggestion = suggestLayerForContent(block.params.content)
				if (suggestion && suggestion.layer !== currentLayer && currentLayer !== "core") {
					return {
						success: true,
						warning: `📍 This file is being created in the **${currentLayer.toUpperCase()}** layer, but its content looks like it belongs in **${suggestion.layer.toUpperCase()}**.\n${suggestion.reason}\nConsider placing it under \`src/${suggestion.layer}/\` instead. If the current location is intentional, proceed.`,
					}
				}
			}
		}

		// Concurrency Policy: Check for file collisions with sibling streams
		if (!this.streamId) return { success: true }

		if (
			block.name === CodemarieDefaultTool.FILE_NEW ||
			block.name === CodemarieDefaultTool.FILE_EDIT ||
			block.name === CodemarieDefaultTool.APPLY_PATCH
		) {
			const files = block.params?.path ? [path.resolve(this.cwd, block.params.path)] : []
			if (files.length > 0) {
				const collision = await orchestrator.checkCollision(this.streamId, files)
				if (collision) {
					let error = `🛑 FLUID COORDINATION ERROR: ${collision}\nYOUR COMMIT HAS BEEN BLOCKED TO PREVENT DATA CORRUPTION. Coordinate with the sibling stream or wait for its completion before proceeding.`
					if (this.collisionAdvisor) {
						const advice = await this.collisionAdvisor(Array.from(files)[0])
						if (advice) error += `\n${advice}`
					}
					return {
						success: false,
						error,
					}
				}
			}
		}

		return { success: true }
	}

	/**
	 * Resolves the architectural layer for a file with in-memory caching.
	 * Tier 3 optimization for high-volume file batches.
	 */
	private getCachedLayer(filePath: string): string {
		let layer = this.layerCache.get(filePath)
		if (!layer) {
			const { getLayer } = require("@/utils/joy-zoning")
			layer = getLayer(filePath)
			this.layerCache.set(filePath, layer!)
		}
		return layer!
	}

	private async executeSupremeCourtPass(filePath: string, content: string): Promise<PolicyResult | null> {
		if (this.controller) {
			const layer = this.getCachedLayer(filePath)

			if (layer === "domain") {
				const ctx = await this.controller.getAgentContext()

				// Tier 2: Cached Rule Retrieval (Zero DB overhead on repeat audits in same session)
				if (!this.cachedRules) {
					this.cachedRules = await ctx.getLogicalConstraints()
				}

				const relevantRules = this.cachedRules.filter((r) =>
					new RegExp(r.pathPattern.replace(/\*\*/g, ".*")).test(filePath),
				)

				if (relevantRules.length > 0) {
					// Parallelize Supreme Court auditing for high throughput
					const auditResults = await Promise.all(
						relevantRules.map(async (rule) => {
							const knowledge = await ctx.getKnowledge(rule.knowledgeId)
							const audit = await ctx.checkConstitutionalViolation(filePath, content, knowledge.content)
							return { rule, audit, knowledge }
						}),
					)

					for (const { audit, knowledge } of auditResults) {
						if (audit.violated) {
							const strikes = await this.incrementStrikes(filePath)
							const rejectionMessage = `🏛️ SUPREME COURT ARCHITECTURAL REJECTION (Strike ${strikes})\n\nViolation: ${audit.reason}\n\nRule: ${knowledge.content}\n\n💡 Please restructure your change to comply with this architectural constraint.`

							if (strikes === 1) {
								return { success: false, error: rejectionMessage }
							}
							return { success: true, warning: `⚠️ SUPREME COURT WARNING (Strike ${strikes}): ${audit.reason}` }
						}
					}
				}
			}
		}
		return null
	}

	/**
	 * Inspects and enriches tool results with proactive layer context.
	 * Always injects the file's layer context so the agent knows the rules before editing.
	 * Additionally warns about existing violations if any are found.
	 */
	public async onRead(
		filePath: string,
		content: string,
		totalReadCount = 0,
		perFileReadCount = 0,
		globalFileReadCount = 0,
	): Promise<string> {
		const absolutePath = path.resolve(this.cwd, filePath)
		const layerContext = this.getFileLayerContext(absolutePath)
		const validation = this.tspPlugin.validateSource(absolutePath, content, this.virtualResolver)
		const { getLayer } = require("@/utils/joy-zoning")
		const layer = getLayer(absolutePath)

		let header = `${layerContext}\n`

		if (!validation.success) {
			header += `⚠️ Existing issues in this file:\n${validation.errors.map((v) => `  - ${v}`).join("\n")}\nKeep these in mind — avoid propagating these patterns.\n`
		}

		// Proactive Dependency Detection (AST-based)
		const sourceFile = require("typescript").createSourceFile(
			absolutePath,
			content,
			require("typescript").ScriptTarget.Latest,
			true,
		)
		const crossLayerViolations = this.tspPlugin.findCrossLayerViolations(sourceFile, absolutePath)
		if (crossLayerViolations.length > 0) {
			header += `⚠️ ARCHITECTURAL SMELL DETECTED (Cross-Layer Dependency):\n${crossLayerViolations.map((v) => `  - ${v}`).join("\n")}\n`
		}

		if (this.mode === "plan") {
			if (perFileReadCount >= 3) {
				header += `🔍 Architecture Analysis (PLAN mode):\n`
				header += `  ⚠️ RECURSIVE STALLING DETECTED: You have read this specific file (${path.basename(filePath)}) ${perFileReadCount} times in this turn without making progress. To avoid an infinite loop, you MUST NOW stop reading this file and either synthesize your findings into a plan or use \`ask_followup_question\`.\n`
			} else if (globalFileReadCount >= 5) {
				header += `🔍 Architecture Analysis (PLAN mode):\n`
				header += `  ⚠️ CROSS-TURN RECURSION DETECTED: You have read this specific file (${path.basename(filePath)}) ${globalFileReadCount} times across multiple turns without progress. To avoid an infinite loop, you MUST NOW stop reading this file and synthesize your findings or use \`ask_followup_question\`.\n`
			} else if (totalReadCount >= 10) {
				header += `🔍 Architecture Analysis (PLAN mode):\n`
				header += `  ⚠️ SYSTEMATIC SCANNING LIMIT: You have read ${totalReadCount} unique files in this interaction turn. To avoid context bloat, you MUST NOW synthesize your current findings into an architectural plan using \`plan_mode_respond\`.\n`
			} else if (totalReadCount >= 5) {
				// Adaptive Guidance: Omit probing questions after 5 reads to reduce turn-overhead and "nagging"
				header += `🔍 Architecture Context (PLAN mode):\n`
				header += `  (Probing questions disabled for turn-efficiency. Focus on your planning objective.)\n`
			} else {
				const isInterface = content.includes("interface ") || content.includes("type ")
				header += `🔍 Architecture Probing (PLAN mode):\n`
				switch (layer) {
					case "domain":
						if (isInterface) {
							header += `  - Is this Domain contract stable enough for Core consumption?\n  - Does it avoid leaking implementation details?`
						} else {
							header += `  - Does this logic belong in a Core Service instead?\n  - Are all Infrastructure side effects abstracted?`
						}
						break
					case "core":
						header += isInterface
							? `  - Is this Core interface consumed by UI or Infrastructure components?`
							: `  - Which Domain models are being coordinated here?\n  - Are Infrastructure dependencies properly abstracted via interfaces?`
						break
					case "infrastructure":
						header += `  - Does this adapter strictly implement a Domain or Core contract?\n  - Is any business logic leaking into this I/O-heavy layer?`
						break
					default:
						header += `  - How does this file fit into the overall JoyZoning topology?`
				}
				header += `\n`
			}
		} else if (this.mode === "act") {
			header += `🛠️ Layer Toolkit (ACT mode):\n`
			switch (layer) {
				case "domain":
					header += `  - 🚫 NO side effects. 🚫 NO external imports. 🚫 NO environment variable leakage.\n  - Ensure logic is pure and testable without I/O.`
					break
				case "core":
					header += `  - 🏗️ Coordinate Domain Models. 🏗️ Use Dependency Inversion for Infrastructure.\n  - Keep logic flow visible; delegate low-level implementation.`
					break
				case "infrastructure":
					header += `  - 🔌 Implement Domain interfaces. 🔌 Isolate I/O details.\n  - Transform external data to Domain models immediately.`
					break
			}
			header += `\n`

			// Context-Aware Tool Guidance
			if (this.commitSeal) {
				header += `🔓 COMMIT SEAL ACTIVE: '${this.commitSeal}'\n  Reason: ${this.sealReason}\n  Continue with care — architectural debt is being recorded.\n\n`
			}
		}

		return `${header}\n${content}`
	}

	/**
	 * Validates the outcome of a tool execution.
	 */
	public async validatePostExecution(block: ToolUse, toolOutput: any, prevResultHash?: string): Promise<PolicyResult> {
		const result: PolicyResult = { success: true }

		// Adaptive Rigor: If soundness is low, increase verification intensity
		const isLowSoundness = this.soundnessScore < 0.7

		// Architectural Policy: Audit file changes via AST (warning-only, never blocks post-execution)
		if (block.name === CodemarieDefaultTool.FILE_NEW || block.name === CodemarieDefaultTool.FILE_EDIT) {
			const filePath = block.params?.path ? path.resolve(this.cwd, block.params.path) : null
			if (filePath) {
				try {
					const content = await fs.readFile(filePath, "utf-8")
					const validation = this.tspPlugin.validateSource(filePath, content, this.virtualResolver)
					if (!validation.success || (validation.warnings && validation.warnings.length > 0)) {
						const allIssues = [...(validation.warnings || []), ...validation.errors]
						result.violations = validation.errors
						result.warning = `⚠️ ${path.basename(filePath)}:\n${allIssues.map((v) => `  - ${v}`).join("\n")}`
						result.correctionHint = this.getCorrectionHint(validation.errors)

						if (isLowSoundness) {
							result.warning = `🚨 CRITICAL ARCHITECTURAL SMELL (Soundness: ${this.soundnessScore.toFixed(2)})\n${result.warning}\nMAS Insight: Architectural stability is low. Immediate correction is STRONGLY advised.`
						}
					}
				} catch {
					// File might not exist yet
				}
			}
		}

		// Stability Policy: Entropy Detection (Structural churn analysis)
		if (prevResultHash) {
			const resultStr = typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput)
			const currentHash = createHash("sha256").update(resultStr).digest("hex")

			if (currentHash !== prevResultHash) {
				// Calculate dynamic entropy score (0.0 - 1.0)
				// Higher score = higher instability/disorder
				const soundnessFactor = Math.max(0, 1 - this.soundnessScore)

				// Fetch total strikes for this stream to weigh entropy
				let totalStrikes = 0
				if (this.streamId) {
					try {
						const memory = await orchestrator.recallMemory(this.streamId, "total_architectural_strikes")
						totalStrikes = memory ? Number.parseInt(memory) : 0
					} catch {
						/* fallback */
					}
				}
				const strikeFactor = Math.min(1.0, totalStrikes / 5)

				// Entropy is a weighted average of soundness gap and architectural debt (strikes)
				result.entropyScore = soundnessFactor * 0.6 + strikeFactor * 0.4

				result.warning =
					(result.warning ? `${result.warning}\n` : "") +
					`⚠️ ENTROPY WARNING (Score: ${result.entropyScore.toFixed(2)}): Tool output has diverged from expected hash. Structural stability may be compromised.`

				if (result.entropyScore > 0.8) {
					result.warning += "\n🚨 CRITICAL INSTABILITY: Progressive enforcement has reached maximum rigor."
				}
			}
		}

		return result
	}

	/**
	 * Performs a final architectural audit on a set of changes before they are committed.
	 * Only domain-layer changes with violations block the commit; others produce warnings.
	 */
	public async validateCommit(
		affectedFiles: Set<string>,
		ops: import("../../infrastructure/db/BufferedDbPool").WriteOp[],
	): Promise<{ success: boolean; errors: string[] }> {
		const allErrors: string[] = []
		const isDomainChange = ops.some((op) => op.layer === "domain")
		const { getLayer } = require("@/utils/joy-zoning")

		for (const filePath of affectedFiles) {
			try {
				const content = await fs.readFile(filePath, "utf-8")
				const validation = this.tspPlugin.validateSource(filePath, content, this.virtualResolver)
				if (!validation.success || (validation.warnings && validation.warnings.length > 0)) {
					const allIssues = [...(validation.warnings || []), ...validation.errors]
					const layer = getLayer(filePath)
					const layerPrefix = `[${layer.toUpperCase()}] ${path.basename(filePath)}`
					allErrors.push(...allIssues.map((e) => `${layerPrefix}: ${e}`))
				}

				// Dependency Detection for commit validation (AST-based)
				const sourceFile = require("typescript").createSourceFile(
					filePath,
					content,
					require("typescript").ScriptTarget.Latest,
					true,
				)
				const crossLayerViolations = this.tspPlugin.findCrossLayerViolations(sourceFile, filePath)
				if (crossLayerViolations.length > 0) {
					const layer = getLayer(filePath)
					const layerPrefix = `[${layer.toUpperCase()}] ${path.basename(filePath)}`
					allErrors.push(
						...crossLayerViolations.map((e) => `${layerPrefix}: ARCHITECTURAL SMELL (Cross-Layer Dependency): ${e}`),
					)
				}
			} catch {
				// File might have been deleted or moved
			}
		}

		if (isDomainChange && allErrors.length > 0) {
			// Restore blocking for domain violations on commit, unless it's just warnings
			let hasHardErrors = false
			for (const filePath of affectedFiles) {
				try {
					const content = require("fs").readFileSync(filePath, "utf-8")
					const validation = this.tspPlugin.validateSource(filePath, content)
					if (validation.errors.length > 0) {
						hasHardErrors = true
						break
					}
				} catch {
					// File might not exist
				}
			}

			if (hasHardErrors && !this.commitSeal) {
				return { success: false, errors: allErrors }
			}

			return { success: true, errors: allErrors.map((e) => `[DOMAIN WARNING] ${e}`) }
		}

		return { success: true, errors: allErrors }
	}
}
