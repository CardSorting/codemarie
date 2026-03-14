import { z } from "zod"

export const GroundedSpecSchema = z.object({
	decisionVariables: z.array(
		z.object({
			name: z.string(),
			description: z.string(),
			range: z.array(z.string()).optional(),
		}),
	),
	constraints: z.array(z.string()),
	outputStructure: z.record(z.string(), z.any()),
	rules: z.array(z.string()),
	confidenceScore: z.number().min(0).max(1),
	ambiguityReasoning: z.string().optional(),
	missingInformation: z.array(z.string()).optional(),
	telemetry: z
		.object({
			durationMs: z.number().optional(),
			tokensIn: z.number().optional(),
			tokensOut: z.number().optional(),
			model: z.string().optional(),
		})
		.optional(),
	verifiedEntities: z.array(z.string()).optional(),
})

export type GroundedSpec = z.infer<typeof GroundedSpecSchema>

export const GROUNDING_FEW_SHOTS = `
Example 1:
User Intent: "Refactor the authentication logic"
Context: Workspace has src/auth/service.ts and src/auth/utils.ts
{
  "decisionVariables": [
    { "name": "targetFiles", "description": "Files needing refactoring", "range": ["src/auth/service.ts", "src/auth/utils.ts"] },
    { "name": "refactorPattern", "description": "Coding pattern to apply", "range": ["Functional", "OOP"] }
  ],
  "constraints": ["Must not break existing tests", "Keep exported API signatures identical"],
  "outputStructure": { "refactoredFiles": "string[]", "testStatus": "boolean" },
  "rules": ["Follow project DRY principles", "Use async/await consistently"],
  "confidenceScore": 0.85,
  "ambiguityReasoning": "Intent is clear but the specific refactoring goal (performance vs readability) is slightly vague."
}

Example 2:
User Intent: "Make it faster"
Context: Multiple components in workspace
{
  "decisionVariables": [],
  "constraints": [],
  "outputStructure": {},
  "rules": [],
  "confidenceScore": 0.2,
  "ambiguityReasoning": "The intent is globally ambiguous. No target component or performance metric specified.",
  "missingInformation": [
    "Which part of the system should be faster?",
    "Do you have a specific performance target or observed bottleneck?",
    "Are there specific files I should focus on?"
  ]
}
`

export const GROUNDING_SYSTEM_PROMPT = `You are an Intent Grounding expert. 
Your task is to decompose a vague human intent into a structured, computable specification.
Follow the methodology of Interpret -> Ground -> Build.
You are in the GROUND phase.

Decompose the intent into:
1. Decision Variables: Parameters that can be tuned or determined during the task.
2. Constraints: Hard limits, requirements, or boundaries that must be respected.
3. Output Structure: A conceptual model of the final result.
4. Rules: Logic, heuristics, or specific instructions to follow.
5. Confidence Score: Quantitative measure of how well the intent is understood.
6. Ambiguity Reasoning: Why a score might be low.
7. Missing Information: Questions to clarify the intent.

### FEW-SHOT EXAMPLES:
${GROUNDING_FEW_SHOTS}

Your goal is to translate human ambiguity into machine-actionable structure.

Return the result STRICTLY as a JSON object matching this structure:
{
  "decisionVariables": [{ "name": string, "description": string, "range": string[] | undefined }],
  "constraints": string[],
  "outputStructure": object,
  "rules": string[],
  "confidenceScore": number (0.0 to 1.0),
  "ambiguityReasoning": string | undefined,
  "missingInformation": string[] | undefined
}

If context about the environment (files, workspace) is provided, use it to ground the intent to specific entities in the environment.`
