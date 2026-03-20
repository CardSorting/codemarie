import * as crypto from "node:crypto"
import { GraphService } from "./GraphService"
import { ReasoningService } from "./ReasoningService"
import type { ImpactReport, ServiceContext } from "./types"

export class AuditService {
	constructor(
		private ctx: ServiceContext,
		private graph: GraphService,
		private reasoning: ReasoningService,
	) {}

	async checkConstitutionalViolation(
		path: string,
		code: string,
		ruleContent: string,
	): Promise<{ violated: boolean; reason?: string }> {
		if (!this.ctx.aiService?.isAvailable()) {
			return { violated: false }
		}
		return this.ctx.aiService.auditCodeAgainstRule(path, code, ruleContent)
	}

	async predictEffect(kbId: string): Promise<ImpactReport> {
		const _node = await this.graph.getKnowledge(kbId)
		const contradictions = await this.reasoning.detectContradictions(kbId, 2)

		const isValid = contradictions.length === 0
		const suggestions: string[] = []

		if (!isValid) {
			suggestions.push(`Hypothesis ${kbId} contradicts ${contradictions.length} existing nodes.`)
			suggestions.push("Consider adjusting the hypothesis or providing more evidence.")
		} else {
			suggestions.push("No direct contradictions found in immediate neighborhood.")
		}

		return {
			isValid,
			contradictions,
			suggestions,
			soundnessDelta: isValid ? 0.05 : -0.2,
		}
	}

	async addLogicalConstraint(
		pathPattern: string,
		knowledgeId: string,
		severity: "blocking" | "warning" = "blocking",
	): Promise<void> {
		const id = crypto.randomUUID()
		await this.ctx.push({
			type: "insert",
			table: "logical_constraints",
			values: {
				id,
				knowledgeId,
				pathPattern,
				severity,
				repoPath: this.ctx.workspace.workspaceId,
			},
			layer: "domain",
		})
	}

	async getLogicalConstraints(): Promise<{ knowledgeId: string; pathPattern: string; severity: string }[]> {
		const rows = await this.ctx.db.selectWhere("logical_constraints", [
			{ column: "repoPath", value: this.ctx.workspace.workspaceId },
		])
		return rows.map((r) => ({
			knowledgeId: r.knowledgeId,
			pathPattern: r.pathPattern,
			severity: r.severity,
		}))
	}
}
