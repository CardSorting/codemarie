import { PromptVariant, SystemPromptContext } from "../types"

/**
 * Generates the GROUNDED_SPEC_SECTION for the system prompt.
 * This section provides the model with the grounded specification derived from the user's intent.
 */
export async function getGroundedSpecSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	if (!context.groundedSpec) {
		return undefined
	}

	const { decisionVariables, constraints, rules, outputStructure } = context.groundedSpec

	return `# Grounded Specification
This task has been analyzed and grounded into the following structured specification to ensure accuracy and alignment with your goals.

## Decision Variables
These are specific parameters or choices that have been identified as critical to the task's success:
${decisionVariables.map((v) => `- **${v.name}**: ${v.description}${v.range ? ` (Potential values: ${v.range.join(", ")})` : ""}`).join("\n")}

## Constraints
The following hard limits and requirements MUST be strictly followed:
${constraints.map((c) => `- ${c}`).join("\n")}

## Rules & Heuristics
Follow these logical principles and operational rules:
${rules.map((r) => `- ${r}`).join("\n")}

## Expected Output Structure
The result should align with this conceptual model:
\`\`\`json
${JSON.stringify(outputStructure, null, 2)}
\`\`\`

Use this specification to guide your decisions and tool usage. If any part of the grounding seems to conflict with the direct user intent, prioritize the user's explicit instructions but use the grounded variables to maintain structure.`
}
