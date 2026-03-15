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
		) => Promise<{ spec: unknown; tokens: { input: number; output: number } }>,
	) {}

	healSpec(raw: unknown): GroundedSpec {
		const r = raw as any // Local cast for safe field access after validation
		const healed: GroundedSpec = {
			decisionVariables:
				r && typeof r === "object" && Array.isArray(r.decisionVariables)
					? r.decisionVariables
							.filter((v: unknown) => v && typeof v === "object")
							.map((v: any) => ({
								name: String(v.name || "unnamed"),
								description: String(v.description || ""),
								range: Array.isArray(v.range) ? v.range.filter((item: unknown) => typeof item === "string") : [],
							}))
					: [],
			constraints:
				r && typeof r === "object" && Array.isArray(r.constraints)
					? r.constraints.filter((c: unknown) => typeof c === "string")
					: [],
			outputStructure: r && typeof r === "object" && typeof r.outputStructure === "object" ? r.outputStructure : {},
			rules:
				r && typeof r === "object" && Array.isArray(r.rules)
					? r.rules.filter((rule: unknown) => typeof rule === "string")
					: [],
			confidenceScore:
				r && typeof r === "object" && typeof r.confidenceScore === "number"
					? Math.min(1, Math.max(0, r.confidenceScore))
					: 0.5,
			ambiguityReasoning:
				(r && typeof r === "object" && r.ambiguityReasoning) || "Spec was automatically healed after validation failure.",
			missingInformation:
				r && typeof r === "object" && Array.isArray(r.missingInformation)
					? r.missingInformation.filter((info: unknown) => typeof info === "string")
					: [],
		}

		// Intelligent Repair: If decisionVariables is missing but rules mention files, try to extract them
		if (healed.decisionVariables.length === 0 && healed.rules.length > 0) {
			const potentialFiles = new Set<string>()
			for (const rule of healed.rules) {
				const matches = rule.match(/[a-zA-Z0-9_\-./]+\.[a-z]{2,5}/g)
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
		const plannedEntities: string[] = []

		const entitiesToVerify = [
			...spec.decisionVariables.flatMap((v) => {
				const paths = [...(v.range || [])]
				// Also check if description looks like a path or symbol
				if (typeof v.description === "string") {
					const match = v.description.match(/[a-zA-Z0-9_\-./]+\.[a-z]{2,4}/)
					if (match) paths.push(match[0])
				}
				return paths
			}),
			...spec.constraints.flatMap((c) => (typeof c === "string" ? c.match(/[a-zA-Z0-9_\-./]+\.[a-z]{2,4}/g) || [] : [])),
		]

		const uniqueEntities = [...new Set(entitiesToVerify)].filter((e) => typeof e === "string" && e.length > 0)

		try {
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
								`${fileName}.rs`,
								`${fileName}.rb`,
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

							const foundFile = results.find((res) => res !== null)
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
						const isNewFile = spec.rules.some(
							(rule) =>
								typeof rule === "string" &&
								(rule.toLowerCase().includes(`create ${entity.toLowerCase()}`) ||
									rule.toLowerCase().includes(`new file ${entity.toLowerCase()}`)),
						)
						if (isNewFile) {
							verifiedEntities.push(`${entity} (Planned)`)
							plannedEntities.push(entity)
						} else {
							missingEntities.push(entity)
						}
					}
				}),
			)
		} catch (error) {
			Logger.error("[GroundingValidator] Critical error in verifyEntities Promise.all:", error)
			throw error
		}

		spec.verifiedEntities = verifiedEntities

		// Deep Hardening: Granular confidence score recalibration
		// We weight missing entities based on their role (decision variables are high priority)
		if (uniqueEntities.length > 0) {
			const verificationRate = verifiedEntities.length / uniqueEntities.length
			const missingDecisionVars = spec.decisionVariables.filter((v) =>
				v.range?.some((r) => missingEntities.includes(r)),
			).length

			if (verificationRate < 0.3 || missingDecisionVars > 1) {
				spec.confidenceScore *= 0.5
				spec.ambiguityReasoning = `${spec.ambiguityReasoning || ""} CRITICAL: Key target entities are missing from workspace.`
			} else if (verificationRate < 0.8) {
				spec.confidenceScore *= 0.8
			}

			// Slight bonus for having planned entities
			if (plannedEntities.length > 0) {
				spec.confidenceScore = Math.min(1, spec.confidenceScore * 1.05)
			}
		}

		if (missingEntities.length > 0) {
			if (spec.confidenceScore > 0.3) {
				spec.confidenceScore *= 0.9
			}
			const missingList = missingEntities.join(", ")
			spec.ambiguityReasoning = `${spec.ambiguityReasoning || ""} Referenced entities not verified: ${missingList}.`

			if (!spec.missingInformation) spec.missingInformation = []
			spec.missingInformation.push(
				`Missing entities: ${missingList}. Please confirm if these are new files or provide correct paths.`,
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
1. Hallucinated file paths (refer to the context provided).
2. Missing constraints (e.g., security, performance, tests).
3. Incomplete or overly broad output structure.

Return the final, improved spec with fixes. Return ONLY JSON.`

		try {
			const { spec: critiqued, tokens } = await this.executeGroundingRequest("Follow instructions carefully.", [
				{ role: "user", content: [{ type: "text", text: reflectionPrompt }] },
			])
			// Harden: Ensure the LLM didn't return a malformed object
			const parsed = GroundedSpecSchema.parse(critiqued)
			return { spec: parsed, tokens }
		} catch (e) {
			Logger.warn("[GroundingValidator] Self-critique failed, falling back to original spec", e)
			return { spec, tokens: { input: 0, output: 0 } }
		}
	}
}
