import * as fs from "fs/promises"
import * as path from "path"
import { searchSymbolInFiles } from "@/services/search/file-search"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { GroundedSpec, GroundedSpecSchema } from "./types"

export class GroundingValidator {
	constructor(
		private executeGroundingRequest: (
			systemPrompt: string,
			messages: CodemarieStorageMessage[],
		) => Promise<{ spec: any; tokens: { input: number; output: number } }>,
	) {}

	healSpec(raw: any): GroundedSpec {
		const healed: GroundedSpec = {
			decisionVariables: Array.isArray(raw.decisionVariables) ? raw.decisionVariables : [],
			constraints: Array.isArray(raw.constraints) ? raw.constraints : [],
			outputStructure: typeof raw.outputStructure === "object" ? raw.outputStructure : {},
			rules: Array.isArray(raw.rules) ? raw.rules : [],
			confidenceScore: typeof raw.confidenceScore === "number" ? Math.min(1, Math.max(0, raw.confidenceScore)) : 0.5,
			ambiguityReasoning: raw.ambiguityReasoning || "Spec was automatically healed after validation failure.",
			missingInformation: Array.isArray(raw.missingInformation) ? raw.missingInformation : [],
		}

		// Intelligent Repair: If decisionVariables is missing but rules mention files, try to extract them
		if (healed.decisionVariables.length === 0 && healed.rules.length > 0) {
			const potentialFiles = new Set<string>()
			for (const r of healed.rules) {
				const matches = r.match(/[a-zA-Z0-9_\-./]+\.[a-z]{2,5}/g)
				if (matches) {
					for (const m of matches) potentialFiles.add(m)
				}
			}

			if (potentialFiles.size > 0) {
				healed.decisionVariables = Array.from(potentialFiles).map((f) => ({
					name: path.basename(f),
					description: `Healed path: ${f}`,
					range: [f],
				}))
				healed.ambiguityReasoning += " Infused decision variables from rules."
			}
		}

		return healed
	}

	async verifyEntities(spec: GroundedSpec, cwd: string): Promise<GroundedSpec> {
		const verifiedEntities: string[] = []
		const missingEntities: string[] = []
		const entitiesToVerify = [
			...spec.decisionVariables.flatMap((v) => {
				const paths = v.range || []
				// Also check if description looks like a path or symbol
				const match = v.description.match(/[a-zA-Z0-9_\-./]+\.[a-z]{2,4}/)
				if (match) paths.push(match[0])
				return paths
			}),
			...spec.constraints.flatMap((c) => c.match(/[a-zA-Z0-9_\-./]+\.[a-z]{2,4}/g) || []),
		]

		const uniqueEntities = [...new Set(entitiesToVerify)]
		await Promise.all(
			uniqueEntities.map(async (entity) => {
				try {
					const fullPath = path.isAbsolute(entity) ? entity : path.join(cwd, entity)

					// Hardening: Robust distinction between file, directory, and symbol
					if (entity.includes(".") && !entity.match(/\.[a-z0-9]+$/i)) {
						// Likely a symbol reference like AuthService.login or AuthService.ts:login
						const parts = entity.split(/[.:]/)
						const symbol = parts.pop() || ""
						const fileName = parts.join(".")

						const possibleFiles = [
							fileName,
							`${fileName}.ts`,
							`${fileName}.js`,
							`${fileName}.tsx`,
							`${fileName}.py`,
							`${fileName}.go`,
						]

						// Hardening: Search for symbol across all possible extensions in parallel
						const results = await Promise.all(
							possibleFiles.map(async (pf) => {
								try {
									const stat = await fs.stat(path.join(cwd, pf))
									if (stat.isFile()) {
										const matches = await searchSymbolInFiles(symbol, [pf], cwd)
										return matches.length > 0 ? pf : null
									}
								} catch {
									return null
								}
								return null
							}),
						)

						const foundFile = results.find((r) => r !== null)
						if (foundFile) {
							verifiedEntities.push(`${entity} (Symbol verified in ${foundFile})`)
						} else {
							missingEntities.push(entity)
						}
					} else {
						// Normal path check (file or directory)
						const stat = await fs.stat(fullPath)
						if (stat.isDirectory()) {
							verifiedEntities.push(`${entity} (Directory)`)
						} else {
							verifiedEntities.push(`${entity} (File)`)
						}
					}
				} catch {
					// Check if it's a "New File" intent
					const isNewFile = spec.rules.some((r) => r.toLowerCase().includes(`create ${entity.toLowerCase()}`))
					if (isNewFile) {
						verifiedEntities.push(`${entity} (Planned)`)
					} else {
						missingEntities.push(entity)
					}
				}
			}),
		)

		spec.verifiedEntities = verifiedEntities

		// Deep Hardening: Granular confidence score recalibration
		if (uniqueEntities.length > 0) {
			const verificationRate = verifiedEntities.length / uniqueEntities.length

			if (verificationRate < 0.4) {
				spec.confidenceScore *= 0.6
				spec.ambiguityReasoning = `${spec.ambiguityReasoning || ""} Critical risk: most referenced entities are missing.`
			} else if (verificationRate < 0.9) {
				spec.confidenceScore *= 0.85
			}
		}

		if (missingEntities.length > 0) {
			if (spec.confidenceScore > 0.3) {
				spec.confidenceScore *= 0.9
			}
			const missingList = missingEntities.join(", ")
			spec.ambiguityReasoning = `${spec.ambiguityReasoning || ""} The following referenced entities were not verified: ${missingList}.`

			if (!spec.missingInformation) spec.missingInformation = []
			spec.missingInformation.push(
				`Please confirm the existence or path of these entities: ${missingList}. If these are new files, please state that explicitly.`,
			)
		}

		return spec
	}

	async selfCritique(
		spec: GroundedSpec,
		intent: string,
	): Promise<{ spec: GroundedSpec; tokens: { input: number; output: number } }> {
		const reflectionPrompt = `You are a critical reviewer. Review the following Grounded Specification against the User Intent.
User Intent: "${intent}"
Proposed Spec: ${JSON.stringify(spec, null, 2)}

Critique the specification for:
1. Hallucinated file paths (refer to the snippets provided earlier if any).
2. Missing constraints (e.g., if modifying shared logic, did it specify test updates?).
3. Incomplete output structure.

Return the final, improved spec with any necessary fixes to "rules", "constraints", or "decisionVariables".
Ensure file paths are realistic for the project structure.
STRICTLY return ONLY the JSON for the spec.`

		try {
			const { spec: critiqued, tokens } = await this.executeGroundingRequest("Follow instructions carefully.", [
				{ role: "user", content: [{ type: "text", text: reflectionPrompt }] },
			])
			return { spec: GroundedSpecSchema.parse(critiqued), tokens }
		} catch (e) {
			Logger.warn("[GroundingValidator] Self-critique failed, falling back to original spec", e)
			return { spec, tokens: { input: 0, output: 0 } }
		}
	}
}
