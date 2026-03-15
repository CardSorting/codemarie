import { Logger } from "@/shared/services/Logger"

/**
 * Robust extraction of JSON from response
 */
export function extractJson(fullResponse: string): unknown {
	if (!fullResponse || typeof fullResponse !== "string") {
		throw new Error("Empty or invalid response received for grounding")
	}

	// Hardening: Limit input size to prevent ReDoS or memory issues
	if (fullResponse.length > 100000) {
		Logger.warn("[GroundingParser] Response too large, truncating for safety", { length: fullResponse.length })
		fullResponse = fullResponse.substring(0, 100000)
	}

	let jsonCandidate = fullResponse.trim()

	// 1. Try to find JSON within markdown code blocks
	const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g
	let bestMatch = ""
	let match = codeBlockRegex.exec(fullResponse)
	while (match !== null) {
		const block = match[1].trim()
		if (block.includes("decisionVariables") || (block.includes("{") && block.length > bestMatch.length)) {
			bestMatch = block
		}
		match = codeBlockRegex.exec(fullResponse)
	}

	if (bestMatch) {
		jsonCandidate = bestMatch
	}

	// 2. Locate the outermost curly braces
	const firstOpen = jsonCandidate.indexOf("{")
	const lastClose = jsonCandidate.lastIndexOf("}")

	if (firstOpen !== -1 && lastClose !== -1 && firstOpen < lastClose) {
		jsonCandidate = jsonCandidate.substring(firstOpen, lastClose + 1)
	} else {
		// FALLBACK: Global search
		const fOpenGlobal = fullResponse.indexOf("{")
		const lCloseGlobal = fullResponse.lastIndexOf("}")
		if (fOpenGlobal !== -1 && lCloseGlobal !== -1 && fOpenGlobal < lCloseGlobal) {
			jsonCandidate = fullResponse.substring(fOpenGlobal, lCloseGlobal + 1)
		} else {
			// If we only have an opening brace, we'll try to repair it later
			if (firstOpen !== -1) {
				jsonCandidate = jsonCandidate.substring(firstOpen)
			} else {
				Logger.error("[GroundingParser] No valid JSON found")
				throw new Error("No valid JSON found in grounding response")
			}
		}
	}

	try {
		return JSON.parse(jsonCandidate)
	} catch (e) {
		try {
			const repaired = repairJson(jsonCandidate)
			return JSON.parse(repaired)
		} catch (repairError) {
			Logger.error("[GroundingParser] JSON repair failed", { error: repairError, preview: jsonCandidate.substring(0, 100) })
			throw new Error(`Failed to parse grounding JSON: ${e instanceof Error ? e.message : String(e)}`)
		}
	}
}

export function quickExtractJson(fullResponse: string): unknown | null {
	if (!fullResponse) return null
	try {
		return extractJson(fullResponse)
	} catch {
		return null
	}
}

export function repairJson(json: string): string {
	let repaired = json.trim()

	// 1. Emergency fix for truncated strings: If it ends with an unescaped quote, don't touch it.
	// But if it ends in the middle of a string, we need to close the quote.
	let inString = false
	for (let i = 0; i < repaired.length; i++) {
		if (repaired[i] === '"' && (i === 0 || repaired[i - 1] !== "\\")) {
			inString = !inString
		}
	}
	if (inString) {
		repaired += '"'
	}

	// 2. Fix trailing commas before closing braces/brackets
	repaired = repaired.replace(/,\s*([\]}])/g, "$1")

	// 3. Handle unquoted keys (simple alphanumeric)
	repaired = repaired.replace(/([{,\s])([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')

	// 4. Handle single quoted values
	repaired = repaired.replace(/:\s*'([^']*)'/g, ': "$1"')

	// 5. Escape unescaped double quotes inside string values
	repaired = repaired.replace(/":\s*"([\s\S]*?)"(?=\s*[,}])|":\s*"([\s\S]*?)"$/g, (_match, p1, p2) => {
		const content = p1 || p2 || ""
		let escaped = ""
		for (let i = 0; i < content.length; i++) {
			if (content[i] === '"' && (i === 0 || content[i - 1] !== "\\")) {
				escaped += '\\"'
			} else {
				escaped += content[i]
			}
		}
		return `": "${escaped}"`
	})

	// 6. Balance braces and brackets for truncated output (stack-based for correct order)
	const stack: string[] = []
	for (let i = 0; i < repaired.length; i++) {
		const char = repaired[i]
		if (char === '"' && (i === 0 || repaired[i - 1] !== "\\")) {
			// Skip string content for balancing
			i++
			while (i < repaired.length && (repaired[i] !== '"' || repaired[i - 1] === "\\")) {
				i++
			}
		} else if (char === "{" || char === "[") {
			stack.push(char)
		} else if (char === "}") {
			if (stack.length > 0 && stack[stack.length - 1] === "{") {
				stack.pop()
			}
		} else if (char === "]") {
			if (stack.length > 0 && stack[stack.length - 1] === "[") {
				stack.pop()
			}
		}
	}

	while (stack.length > 0) {
		const last = stack.pop()
		if (last === "{") repaired += "}"
		else if (last === "[") repaired += "]"
	}

	return repaired
}
