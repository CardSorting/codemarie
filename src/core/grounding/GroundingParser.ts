import { Logger } from "@/shared/services/Logger"

/**
 * Robust extraction of JSON from response
 */
export function extractJson(fullResponse: string): any {
	let jsonCandidate = fullResponse.trim()

	// 1. Try to find JSON within markdown code blocks
	const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g
	let bestMatch = ""
	let match = codeBlockRegex.exec(fullResponse)
	while (match !== null) {
		// If multiple blocks, we prefer the one that looks like a spec (contains "decisionVariables")
		const block = match[1].trim()
		if (block.includes("decisionVariables") || block.length > bestMatch.length) {
			bestMatch = block
		}
		match = codeBlockRegex.exec(fullResponse)
	}

	if (bestMatch) {
		jsonCandidate = bestMatch
	}

	// 2. Locate the outermost curly braces if we have a string candidate
	const firstOpen = jsonCandidate.indexOf("{")
	const lastClose = jsonCandidate.lastIndexOf("}")

	if (firstOpen !== -1 && lastClose !== -1 && firstOpen < lastClose) {
		jsonCandidate = jsonCandidate.substring(firstOpen, lastClose + 1)
	} else {
		// FALLBACK: If no clear braces in the whole block, search the entire fullResponse
		const fOpenGlobal = fullResponse.indexOf("{")
		const lCloseGlobal = fullResponse.lastIndexOf("}")
		if (fOpenGlobal !== -1 && lCloseGlobal !== -1 && fOpenGlobal < lCloseGlobal) {
			jsonCandidate = fullResponse.substring(fOpenGlobal, lCloseGlobal + 1)
		} else {
			Logger.error("[GroundingParser] No valid JSON markers found in response", {
				responseLength: fullResponse.length,
				preview: `${fullResponse.substring(0, 500)}...`,
			})
			throw new Error("No valid JSON found in grounding response")
		}
	}

	try {
		// Try parsing the extracted string directly first
		return JSON.parse(jsonCandidate)
	} catch (e) {
		Logger.info("[GroundingParser] Initial JSON parse failed, attempting intensive repair...")
		try {
			const repaired = repairJson(jsonCandidate)
			return JSON.parse(repaired)
		} catch (repairError) {
			Logger.error("[GroundingParser] JSON repair failed", {
				error: repairError instanceof Error ? repairError.message : String(repairError),
				jsonPreview: `${jsonCandidate.substring(0, 200)}...`,
			})
			throw new Error(`Failed to parse grounding JSON: ${e instanceof Error ? e.message : String(e)}`)
		}
	}
}

export function quickExtractJson(fullResponse: string): any | null {
	const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/g.exec(fullResponse)
	let jsonCandidate = codeBlockMatch ? codeBlockMatch[1].trim() : fullResponse.trim()

	const firstOpen = jsonCandidate.indexOf("{")
	const lastClose = jsonCandidate.lastIndexOf("}")

	if (firstOpen !== -1 && lastClose !== -1 && firstOpen < lastClose) {
		jsonCandidate = jsonCandidate.substring(firstOpen, lastClose + 1)
		try {
			return JSON.parse(jsonCandidate)
		} catch {
			try {
				return JSON.parse(repairJson(jsonCandidate))
			} catch {
				return null
			}
		}
	}
	return null
}

export function repairJson(json: string): string {
	// Hardening: Advanced JSON repair logic for LLM-specific failures
	let repaired = json
		.replace(/,\s*([\]}])/g, "$1") // Remove trailing commas
		.replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // Ensure keys are double-quoted
		.replace(/:\s*'([^']*)'/g, ': "$1"') // Replace single quoted values with double quotes
		.replace(/\\'/g, "'") // Fix escaped single quotes
		.replace(/\n/g, "\\n") // Escape literal newlines within strings
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t")
		.replace(/":\s*"([^"]*)"/g, (_, p1) => `": "${p1.replace(/\\n/g, "\n")}"`) // Unescape newlines back in actual string values
		.replace(/\\"/g, '"') // Normalize escaped double quotes
		.replace(/([^\\])"/g, '$1\\"') // Escape all double quotes
		.replace(/\\"/g, '"') // Re-normalize

	// Final pass to ensure structural quotes are NOT escaped
	repaired = repaired.replace(/([^\\])"/g, (m, p1) =>
		p1 === ":" || p1 === " " || p1 === "{" || p1 === "[" || p1 === "," ? m : `${p1}\\"`,
	)

	// Deep Hardening: Handle unescaped double quotes inside string values that cause parse errors
	// We look for patterns like "key": "value "with" quotes",
	repaired = repaired.replace(/":\s*"([\s\S]*?)"(?=\s*[,}])|":\s*"([\s\S]*?)"$/g, (_, p1, p2) => {
		const content = p1 || p2 || ""
		// Escape any internal double quotes that aren't already escaped
		const escapedContent = content.replace(/(?<!\\)"/g, '\\"')
		return `": "${escapedContent}"`
	})

	return repaired
}
