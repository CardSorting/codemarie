import { z } from "zod"

export const GroundedSpecSchema = z.object({
	decisionVariables: z
		.array(
			z.object({
				name: z.string(),
				description: z.string(),
				range: z.array(z.string()).optional(),
			}),
		)
		.default([]),
	constraints: z.array(z.string()).default([]),
	outputStructure: z.record(z.string(), z.any()).default({}),
	rules: z.array(z.string()).default([]),
	confidenceScore: z.number().min(0).max(1).default(0.5),
	ambiguityReasoning: z.string().optional(),
	missingInformation: z.array(z.string()).optional(),
	telemetry: z
		.object({
			durationMs: z.number().optional(),
			tokensIn: z.number().optional(),
			tokensOut: z.number().optional(),
			model: z.string().optional(),
			isCacheHit: z.boolean().optional(),
			inheritanceSource: z.enum(["parent", "cache", "synthesized", "none"]).optional(),
			matchScore: z.number().optional(),
		})
		.optional(),
	verifiedEntities: z.array(z.string()).optional(),
	actions: z
		.array(
			z.object({
				id: z.string(),
				label: z.string(),
				description: z.string().optional(),
				rationale: z.string().optional(),
				priority: z.enum(["critical", "recommended", "optional"]).default("recommended"),
				isChecked: z.boolean().default(false),
			}),
		)
		.optional(),
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
  "ambiguityReasoning": "Intent is clear but the specific refactoring goal (performance vs readability) is slightly vague.",
  "actions": [
    { "id": "refactor-auth-service", "label": "Refactor src/auth/service.ts", "description": "Apply DRY principles", "rationale": "High-complexity file matching intent keywords", "priority": "critical" },
    { "id": "update-auth-tests", "label": "Update auth tests", "description": "Ensure no regressions", "rationale": "Required by project rules for logic changes", "priority": "recommended" }
  ]
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
Your task is to decompose a human intent into a structured, machine-actionable specification.
Follow the methodology of Interpret -> Ground -> Build.
You are in the GROUND phase.

Decompose the intent into:
1. Decision Variables: Parameters that can be determined during the task. MUST include specific file paths or symbols if they are identifiable from the context.
2. Constraints: Hard limits, requirements, or boundaries that must be respected (e.g., "Do not modify X", "Ensure Y is async").
3. Output Structure: A conceptual model of the final result (e.g., modified files, new components, updated tests).
4. Rules: Logic, heuristics, or specific coding standards to follow.
5. Confidence Score: 0.0 to 1.0. Penalize if the intent is vague or contradicts the provided environment context.
6. Ambiguity Reasoning: Brief explanation of why the confidence score is not 1.0.
7. Missing Information: Specific questions to ask the user to clear up ambiguity.
8. Actions: A list of discrete, actionable steps that can be taken to fulfill the intent. These will be presented to the user as checkboxes. Each action MUST have:
	- 'id': A unique identifier (e.g., "install-deps").
	- 'label': A short, descriptive title (e.g., "Install @types/node").
	- 'description': A brief explanation of the step.
	- 'rationale': Why this step is necessary or how it links to a constraint/variable.
	- 'priority': One of ["critical", "recommended", "optional"].
	- Example Actions: [{"id": "cfg-aws", "label": "Configure AWS credentials", "description": "Ensure local profile is set", "rationale": "Required for subsequent S3 access", "priority": "critical"}]

### OPERATIONAL PRINCIPLES:
- **USE SEMANTIC CONTEXT**: You are provided with "Discovered Semantic Context" (ripgrep) and "Historical Semantic Affinities" (Knowledge Graph). Use these to verify file existence, understand patterns, identify symbols, and discover "hidden" dependencies that often change together.
- **BLAST RADIUS AWARENESS**: Pay attention to the Blast Radius hints. If an intent modifies a "chokepoint" file (high dependency), include constraints or rules for extensive regression testing.
- **DETERMINISTIC PATHS**: Use exact file paths found in the context. Do not guess directory structures.
- **NEW FILE HANDLING**: If you intend to create a new file, you MUST add a rule starting with "Create [path]" so the verification layer can recognize it as a "Planned" entity rather than a missing one.
- **BE ACTIONABLE**: The resulting spec should be enough for an autonomous agent to start work without further guessing.
- **AVOID HALLUCINATIONS**: Do not invent file paths that are not supported by the context unless the intent explicitly asks to CREATE them.
- **CHECK FOR TESTS**: If the intent involves modifying logic, always include a rule or constraint to verify/update related tests.

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
  "missingInformation": string[] | undefined,
  "actions": [{ "id": string, "label": string, "description": string | undefined, "rationale": string | undefined, "priority": "critical" | "recommended" | "optional" }] | undefined
}`
