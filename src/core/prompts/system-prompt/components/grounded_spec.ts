import { PromptVariant, SystemPromptContext } from "../types"

/**
 * Generates the GROUNDED_SPEC_SECTION for the system prompt.
 * This section provides the model with the grounded specification derived from the user's intent.
 */
export async function getGroundedSpecSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	if (!context.groundedSpec) {
		return ""
	}

	const { decisionVariables, constraints, rules, outputStructure, confidenceScore, ambiguityReasoning } = context.groundedSpec

	return (
		`# INTENT GROUNDING SPECIFICATION\n` +
		`This task has been grounded into a structured specification. (Confidence: ${Math.round(confidenceScore * 100)}%)\n` +
		(ambiguityReasoning ? `**Reasoning**: ${ambiguityReasoning}\n\n` : "\n") +
		`## Decision Variables\n` +
		`${decisionVariables.map((v) => `- **${v.name}**: ${v.description}${v.range ? ` (Valid range: ${v.range.join(", ")})` : ""}`).join("\n")}\n\n` +
		`## Constraints\n` +
		`${constraints.map((c) => `- [REQUIRED] ${c}`).join("\n")}\n\n` +
		`## Rules & Logic\n` +
		`${rules.map((r) => `- ${r}`).join("\n")}\n\n` +
		`## Final Output Structure\n` +
		`Expected conceptual structure of the result:\n` +
		`\`\`\`json\n${JSON.stringify(outputStructure, null, 2)}\n\`\`\``
	)
}
