import * as crypto from "node:crypto"
import { exec } from "child_process"
import * as fs from "fs/promises"
import { promisify } from "util"
import type { AgentContext, KnowledgeBaseItem } from "@/core/broccolidb/agent-context"
import type { BlastRadius } from "@/core/broccolidb/agent-context/StructuralDiscoveryService"
import type { Workspace } from "@/core/broccolidb/workspace"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import type { PromptSuggestion, SuggestionType } from "@/shared/ExtensionMessage"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import type { Diagnostic, FileDiagnostics } from "@/shared/proto/codemarie/common"
import { Logger } from "@/shared/services/Logger"
import { asRelativePath } from "@/utils/path"
import { calculateSimilarity } from "@/utils/string"

const execAsync = promisify(exec)

interface CachedSuggestions {
	suggestions: PromptSuggestion[]
	timestamp: number
	contentHash: string
}

export class SuggestionService {
	private lastSuggestions: PromptSuggestion[] = []
	private isGenerating = false
	private lastFetchTime = 0
	private readonly DEBOUNCE_INTERVAL = 10000 // 10 seconds
	private readonly SUGGESTION_HISTORY_SIZE = 6
	private suggestionHistory: PromptSuggestion[] = []
	private agentContext?: AgentContext
	private workspace?: Workspace
	private activeRequestId = 0
	private static readonly MAX_PARSER_CACHE_SIZE = 20
	private static parserCache = new Map<string, { parser: any; lastUsed: number }>() // LRU-managed parsers
	private suggestionCache = new Map<string, CachedSuggestions>()
	private static readonly MAX_SUGGESTION_CACHE_SIZE = 50
	private lastGitStatus = ""
	private lastGitTimestamp = 0
	private readonly GIT_CACHE_TTL = 30000 // 30 seconds
	private lastProjectPatterns = ""
	private lastProjectPatternsTimestamp = 0
	private readonly PROJECT_PATTERNS_TTL = 600000 // 10 minutes
	private symbolCache = new Map<string, { definition: string; timestamp: number }>()
	private readonly SYMBOL_CACHE_TTL = 300000 // 5 minutes

	private readonly JS_TS_KEYWORDS = new Set([
		"if",
		"else",
		"for",
		"while",
		"do",
		"switch",
		"case",
		"break",
		"continue",
		"return",
		"try",
		"catch",
		"finally",
		"throw",
		"async",
		"await",
		"function",
		"class",
		"extends",
		"implements",
		"interface",
		"type",
		"enum",
		"const",
		"let",
		"var",
		"import",
		"export",
		"from",
		"as",
		"default",
		"new",
		"this",
		"super",
		"private",
		"public",
		"protected",
		"static",
		"readonly",
		"abstract",
		"namespace",
		"module",
		"declare",
		"typeof",
		"instanceof",
		"true",
		"false",
		"null",
		"undefined",
		"number",
		"string",
		"boolean",
		"any",
		"void",
		"never",
		"unknown",
	])

	private async ensureContext(): Promise<void> {
		if (this.agentContext) return

		try {
			const stateManager = StateManager.get()
			const machineId = (stateManager.getGlobalStateKey("codemarie.generatedMachineId") as string) || "anonymous"
			const paths = await HostProvider.workspace.getWorkspacePaths({})
			const cwd = paths.paths?.[0] || process.cwd()
			const workspaceId = crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 12)

			const { dbPool } = require("@/infrastructure/db/BufferedDbPool.js")
			const { Workspace } = require("@/core/broccolidb/workspace.js")
			const { AgentContext } = require("@/core/broccolidb/agent-context.js")

			const db = dbPool
			this.workspace = new Workspace(db, machineId, workspaceId)
			await this.workspace!.init()
			this.agentContext = new AgentContext(this.workspace!)
			Logger.info(`[SuggestionService] BroccoliDB context initialized for workspace: ${workspaceId}`)
		} catch (err) {
			Logger.error("[SuggestionService] Failed to initialize BroccoliDB context", err)
		}
	}

	private async getDeepContext(
		filePath: string | undefined,
		fileSnippet: string,
	): Promise<{ structuralImpact: { summary: string; blastRadius: BlastRadius } | null; semanticContext: string[] }> {
		if (!this.agentContext || !filePath) {
			return { structuralImpact: null, semanticContext: [] }
		}

		try {
			const relPath = await asRelativePath(filePath)
			const structuralImpact = this.agentContext.getStructuralImpact(relPath)

			const searchResults = await this.agentContext.searchKnowledge(
				`context for ${relPath}: ${fileSnippet.substring(0, 100)}`,
				["code"],
				2,
			)
			const semanticContext = searchResults.map((res: KnowledgeBaseItem) => res.content)
			return { structuralImpact, semanticContext }
		} catch (err) {
			Logger.warn("[SuggestionService] Failed to gather deep context", err)
			return { structuralImpact: null, semanticContext: [] }
		}
	}

	private async getDiagnosticsContext(): Promise<string> {
		try {
			const diagnosticsResponse = await HostProvider.workspace.getDiagnostics({})
			const allDiagnostics = diagnosticsResponse.fileDiagnostics || []
			const importantDiagnostics = allDiagnostics.flatMap((fd: FileDiagnostics) => fd.diagnostics || []).slice(0, 10)

			if (importantDiagnostics.length > 0) {
				return importantDiagnostics
					.map((d: Diagnostic) => {
						const severity = d.severity === 0 ? "Error" : d.severity === 1 ? "Warning" : "Info"
						return `[${severity}] ${d.message} (Line: ${d.range?.start?.line})`
					})
					.join("\n")
			}
		} catch (err) {
			Logger.warn("[SuggestionService] Failed to gather diagnostics", err)
		}
		return ""
	}

	private async getGitStatusContext(): Promise<string> {
		try {
			// Basic TTL Cache for Git Status
			if (Date.now() - this.lastGitTimestamp < this.GIT_CACHE_TTL && this.lastGitStatus) {
				return this.lastGitStatus
			}

			// -uno ignores untracked files, significantly faster in large repositories
			const { stdout } = await execAsync("git status --porcelain -uno", { timeout: 2000 })
			this.lastGitStatus = stdout.trim()
			this.lastGitTimestamp = Date.now()
			return this.lastGitStatus
		} catch (error) {
			Logger.warn("[SuggestionService] Failed to get git status context", error)
			return ""
		}
	}

	private async getFileSkeleton(filePath: string | undefined): Promise<string> {
		if (!filePath) return ""
		try {
			// Memoized LanguageParser to reduce overhead
			const { loadRequiredLanguageParsers } = require("@/services/tree-sitter/languageParser.js")
			const { parseFile } = require("@/services/tree-sitter/index.js")

			let cached = SuggestionService.parserCache.get(filePath)
			if (!cached) {
				// LRU Eviction for parser cache
				if (SuggestionService.parserCache.size >= SuggestionService.MAX_PARSER_CACHE_SIZE) {
					const oldest = Array.from(SuggestionService.parserCache.entries()).sort(
						(a, b) => a[1].lastUsed - b[1].lastUsed,
					)[0]
					if (oldest) SuggestionService.parserCache.delete(oldest[0])
				}
				const parsers = await loadRequiredLanguageParsers([filePath])
				const parser = parsers[filePath]
				cached = { parser, lastUsed: Date.now() }
				SuggestionService.parserCache.set(filePath, cached)
			} else {
				cached.lastUsed = Date.now()
			}

			const definitions = await parseFile(filePath, { [filePath]: cached.parser })
			return definitions || ""
		} catch (err) {
			Logger.warn("[SuggestionService] Failed to generate file skeleton", err)
			return ""
		}
	}

	private async getImportContext(filePath: string | undefined): Promise<string> {
		if (!this.agentContext || !filePath) return ""
		try {
			const relPath = await asRelativePath(filePath)
			const spiderService = (this.agentContext as any)._spiderService || (this.agentContext as any).getSpiderService?.()
			if (!spiderService) return ""

			const engine = spiderService.getEngine()
			const targetNode =
				engine.nodes.get(relPath) || engine.nodes.get(`${relPath}.ts`) || engine.nodes.get(`${relPath}.tsx`)
			if (!targetNode || !targetNode.imports) return ""

			let context = ""
			const internalImports = targetNode.imports.filter((imp: string) => imp.startsWith(".") || imp.startsWith("@/"))

			// Resolve and get definitions for top 2 imports
			const { loadRequiredLanguageParsers } = require("@/services/tree-sitter/languageParser.js")
			const { parseFile } = require("@/services/tree-sitter/index.js")

			const resolvedPaths: string[] = []
			for (const imp of internalImports.slice(0, 2)) {
				const resolved = engine.resolveImportToNodeId(targetNode.id, imp)
				if (resolved) {
					const absPath = require("path").resolve(engine.cwd, resolved)
					resolvedPaths.push(absPath)
				}
			}

			if (resolvedPaths.length > 0) {
				const parsers = await loadRequiredLanguageParsers(resolvedPaths)
				for (const absPath of resolvedPaths) {
					const definitions = await parseFile(absPath, parsers)
					if (definitions) {
						context += `Symbols in ${require("path").basename(absPath)}:\n${definitions}\n`
					}
				}
			}
			return context
		} catch (err) {
			Logger.warn("[SuggestionService] Failed to resolve import context", err)
			return ""
		}
	}

	private async getProjectPatterns(): Promise<string> {
		if (!this.agentContext) return ""
		try {
			// 10-minute TTL Cache for project patterns
			if (Date.now() - this.lastProjectPatternsTimestamp < this.PROJECT_PATTERNS_TTL && this.lastProjectPatterns) {
				return this.lastProjectPatterns
			}

			const patterns = await this.agentContext.searchKnowledge(
				"dominant design patterns, error handling conventions, and naming styles in this project",
				["code", "documentation"],
				2,
			)
			if (patterns && patterns.length > 0) {
				this.lastProjectPatterns = patterns.map((p: KnowledgeBaseItem) => p.content).join("\n---\n")
				this.lastProjectPatternsTimestamp = Date.now()
				return this.lastProjectPatterns
			}
		} catch (err) {
			Logger.warn("[SuggestionService] Failed to gather project patterns", err)
		}
		return ""
	}

	private async getSmartSymbolContext(filePath: string | undefined, diagnostics: Diagnostic[]): Promise<string> {
		if (!this.agentContext || !filePath || diagnostics.length === 0) return ""
		try {
			const relPath = await asRelativePath(filePath)
			const spiderService = (this.agentContext as any)._spiderService || (this.agentContext as any).getSpiderService?.()
			if (!spiderService) return ""

			const engine = spiderService.getEngine()
			const targetNode =
				engine.nodes.get(relPath) || engine.nodes.get(`${relPath}.ts`) || engine.nodes.get(`${relPath}.tsx`)
			if (!targetNode) return ""

			// Extract symbols from error lines (Advanced Symbol Filtering)
			const errorSymbols: Set<string> = new Set()
			for (const d of diagnostics) {
				const symbols = d.message.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || []
				symbols.forEach((s) => {
					if (s.length > 3 && !this.JS_TS_KEYWORDS.has(s.toLowerCase())) {
						errorSymbols.add(s)
					}
				})
			}

			if (errorSymbols.size === 0) return ""

			let context = "Oracle Symbol Resolution:\n"
			const { loadRequiredLanguageParsers } = require("@/services/tree-sitter/languageParser.js")
			const { parseFile } = require("@/services/tree-sitter/index.js")

			// Attempt high-fidelity resolution via Tree-sitter if available
			let localDefinitions = ""
			try {
				localDefinitions = await this.getFileSkeleton(filePath)
			} catch {}

			const resolvedPaths: string[] = []
			for (const symbol of Array.from(errorSymbols).slice(0, 3)) {
				// 1. If symbol is found in active file definitions, we already have it
				if (localDefinitions.includes(symbol)) continue

				// 2. Check Symbol LRU Cache
				const cached = this.symbolCache.get(symbol)
				if (cached && Date.now() - cached.timestamp < this.SYMBOL_CACHE_TTL) {
					context += cached.definition
					continue
				}

				// 3. Search for symbol definition project-wide
				const searchResults = await this.agentContext.searchKnowledge(`definition of ${symbol}`, ["code"], 1)
				if (searchResults?.[0] && searchResults[0].metadata?.filePath) {
					const absPath = require("path").resolve(engine.cwd, searchResults[0].metadata.filePath as string)
					resolvedPaths.push(absPath)
				}
			}

			if (resolvedPaths.length > 0) {
				const parsers = await loadRequiredLanguageParsers(resolvedPaths)
				for (const absPath of resolvedPaths.slice(0, 2)) {
					const defs = await parseFile(absPath, parsers)
					if (defs) {
						const symbolInfo = `Resolved Symbol from ${require("path").basename(absPath)}:\n${defs}\n`
						context += symbolInfo

						// Cache the resolution for all symbols that were likely resolved to this file
						for (const symbol of Array.from(errorSymbols)) {
							if (defs.includes(symbol)) {
								this.symbolCache.set(symbol, { definition: symbolInfo, timestamp: Date.now() })
							}
						}
					}
				}
			}
			return context
		} catch (err) {
			Logger.warn("[SuggestionService] Failed to gather smart symbol context", err)
			return ""
		}
	}

	private async getDiagnosticGrounding(filePath: string | undefined, diagnostics: Diagnostic[]): Promise<string> {
		if (!this.agentContext || !filePath || diagnostics.length === 0) return ""
		try {
			let grounding = "Diagnostic Grounding:\n"
			for (const d of diagnostics.slice(0, 2)) {
				const symbol = d.message.match(/'([^']+)'/)?.[1] || d.message.match(/`([^`]+)`/)?.[1]
				if (!symbol) continue

				const searchResults = await this.agentContext.searchKnowledge(`definition of ${symbol}`, ["code"], 1)
				if (searchResults?.[0]) {
					grounding += `Symbol '${symbol}':\n${searchResults[0].content}\n`
				}
			}
			return grounding
		} catch (err) {
			Logger.warn("[SuggestionService] Failed to gather diagnostic grounding", err)
			return ""
		}
	}

	private calculateContentHash(content: string, filePath: string): string {
		return crypto.createHash("md5").update(`${filePath}:${content}`).digest("hex")
	}

	async getSuggestions(messages: CodemarieStorageMessage[] = [], ulid?: string): Promise<PromptSuggestion[]> {
		const requestId = ++this.activeRequestId
		if (this.isGenerating) {
			return this.lastSuggestions
		}

		const now = Date.now()
		if (now - this.lastFetchTime < this.DEBOUNCE_INTERVAL) {
			Logger.info("Skipping suggestion generation due to debouncing")
			return this.lastSuggestions
		}

		this.isGenerating = true
		const startTime = Date.now()

		try {
			// Configuration and Model Selection
			const stateManager = StateManager.get()
			const apiConfig = stateManager.getApiConfiguration()
			const mode = stateManager.getGlobalSettingsKey("mode")
			const suggestionApiConfig = { ...apiConfig }

			// Use user-provided models for suggestion generation (no hardcoded/retired fallbacks)
			suggestionApiConfig.planModeReasoningEffort = "none"
			suggestionApiConfig.actModeReasoningEffort = "none"

			// Ensure thinking is enabled with a medium budget for background suggestions.
			// This prevents crashes for models that only work in thinking mode (e.g. Gemini 3)
			// while keeping latency low. Handlers for models that don't support thinking will ignore this.
			suggestionApiConfig.actModeThinkingBudgetTokens = 5024
			suggestionApiConfig.planModeThinkingBudgetTokens = 5024

			// Prevent collision with main task streams by clearing shared identifiers, custom prompts, and prompt caching
			delete suggestionApiConfig.ulid
			suggestionApiConfig.liteLlmUsePromptCache = false
			suggestionApiConfig.awsBedrockUsePromptCache = false

			const { buildApiHandler } = require("@/core/api")
			const handler = buildApiHandler(suggestionApiConfig, mode)

			// Context Gathering: Active File
			const activeEditor = await HostProvider.window.getActiveEditor({})
			const filePath = activeEditor?.filePath
			let fileSnippet = ""
			let contentHash = ""

			if (filePath) {
				try {
					const content = await fs.readFile(filePath, "utf8")
					contentHash = this.calculateContentHash(content, filePath)

					// LRU-managed Cache lookup
					const cached = this.suggestionCache.get(filePath)
					if (cached && cached.contentHash === contentHash && now - cached.timestamp < 300000) {
						// 5 min cache
						this.lastSuggestions = cached.suggestions
						this.lastFetchTime = now
						this.isGenerating = false
						return this.lastSuggestions
					}

					// Semantic Importance Window
					const lines = content.split("\n")
					let fileSnippetContent = ""

					if (this.agentContext && lines.length > 100) {
						// Identify the most semantically important block in the file
						try {
							const relPath = await asRelativePath(filePath)
							const importantBlocks = await this.agentContext.searchKnowledge(
								`core logic and important functions in ${relPath}`,
								["code"],
								1,
							)
							if (importantBlocks?.[0]) {
								fileSnippetContent = `// Semantically Important Block:\n${importantBlocks[0].content}\n\n`
							}
						} catch {}
					}

					// Always include the first 100 lines for structural context if not already covered
					if (fileSnippetContent.length < 500) {
						fileSnippetContent += lines.slice(0, 100).join("\n")
					}
					fileSnippet = fileSnippetContent
				} catch (err) {
					Logger.error(`Failed to read active file for suggestions: ${filePath}`, err)
				}
			}

			// BroccoliDB Deep Context (initialized in background)
			const contextPromise = this.ensureContext()

			// Parallel Context Gathering (Components Latency Tracking)
			const componentStarts = {
				deep: Date.now(),
				diagnostics: Date.now(),
				git: Date.now(),
				skeleton: Date.now(),
				imports: Date.now(),
				diagGrounding: Date.now(),
				projectPatterns: Date.now(),
				smartSymbols: Date.now(),
			}

			const rawDiagnostics = await HostProvider.workspace.getDiagnostics({})
			const activeFileDiagnostics = (rawDiagnostics.fileDiagnostics || [])
				.flatMap((fd: FileDiagnostics) => fd.diagnostics || [])
				.filter((d) => d.severity === 0) // Focus on errors for grounding

			// Run context gathering components in parallel with individual error isolation
			const [
				deepContext,
				diagnosticsSummary,
				gitStatusSummary,
				fileSkeleton,
				importContext,
				diagnosticGrounding,
				projectPatterns,
				smartSymbolContext,
			] = await Promise.all([
				this.wrapContextCall(
					"DeepContext",
					(async () => {
						await contextPromise
						return this.getDeepContext(filePath, fileSnippet)
					})(),
					null,
				),
				this.wrapContextCall("Diagnostics", this.getDiagnosticsContext(), null),
				this.wrapContextCall("GitStatus", this.getGitStatusContext(), ""),
				this.wrapContextCall("FileSkeleton", this.getFileSkeleton(filePath), ""),
				this.wrapContextCall(
					"ImportContext",
					(async () => {
						await contextPromise
						return this.getImportContext(filePath)
					})(),
					"",
				),
				this.wrapContextCall(
					"DiagnosticGrounding",
					(async () => {
						await contextPromise
						return this.getDiagnosticGrounding(filePath, activeFileDiagnostics)
					})(),
					"",
				),
				this.wrapContextCall("ProjectPatterns", this.getProjectPatterns(), ""),
				this.wrapContextCall(
					"SmartSymbolContext",
					(async () => {
						await contextPromise
						return this.getSmartSymbolContext(filePath, activeFileDiagnostics)
					})(),
					"",
				),
			])

			const componentLatencies = {
				deep: Date.now() - componentStarts.deep,
				diagnostics: Date.now() - componentStarts.diagnostics,
				git: Date.now() - componentStarts.git,
				skeleton: Date.now() - componentStarts.skeleton,
				imports: Date.now() - componentStarts.imports,
				diagGrounding: Date.now() - componentStarts.diagGrounding,
				projectPatterns: Date.now() - componentStarts.projectPatterns,
				smartSymbols: Date.now() - componentStarts.smartSymbols,
			}

			const { structuralImpact, semanticContext } = deepContext || { structuralImpact: null, semanticContext: [] }

			// Structured Prompting with XML-style tags
			const systemPrompt = `You are a strict, hyper-aware AI Oracle embedded in the user's IDE.
You ONLY know the code and context provided below.
DO NEVER provide generic coding advice. DO NEVER output any preamble or conversational text.
Your sole purpose is to output a JSON array of 3 highly actionable, contextually accurate prompt suggestions.

Current Context:
<mode>${mode}</mode>
<active_file>${filePath ? await asRelativePath(filePath) : "None"}</active_file>
<structural_impact>
${structuralImpact?.summary || "No architectural data available."}
</structural_impact>
<semantic_context>
${semanticContext.length > 0 ? semanticContext.join("\n---\n") : "No similar code snippets found."}
</semantic_context>
<file_snippet>
${fileSnippet || "No content available."}
</file_snippet>
<file_skeleton>
${fileSkeleton || "No structural data available."}
</file_skeleton>
<import_context>
${importContext || "No internal symbols resolved."}
</import_context>
<smart_symbol_context>
${smartSymbolContext || "No project-wide symbols resolved."}
</smart_symbol_context>
<project_patterns>
${projectPatterns || "Standard project conventions apply."}
</project_patterns>
<diagnostic_deep_context>
${diagnosticGrounding || "No detailed grounding required."}
</diagnostic_deep_context>
<diagnostics>
${diagnosticsSummary || "No problems detected."}
</diagnostics>
<git_status>
${gitStatusSummary || "No pending changes."}
</git_status>
<conversation_history>
${this.stringifyMessages(messages.slice(-5))}
</conversation_history>

Crucial Instructions:
1. Suggestions MUST be STRICTLY grounded in the provided project context.
2. BANNED: Do NOT provide generic advice (e.g., "check the logs", "refactor for readability").
3. BANNED: Do NOT invent files or symbols that do not exist in the context tags.
4. BANNED: Do NOT include preamble, conversational filler, or markdown tags other than the JSON block.
5. You MUST use the exact file names, variable names, and architectural concepts found in the context (especially from <file_snippet>, <smart_symbol_context>, and <diagnostics>).
6. Ensure suggestions follow the <project_patterns> and respect <structural_impact>.
7. Every suggestion MUST be a prompt the user can literally send to you to make progress.

Oracle Modes (Select EXACTLY 3 diverse modes from below):
1. fix: High-precision resolution of the most critical issue in <diagnostics> or <diagnostic_deep_context>.
2. design: Architectural improvement or refactor grounded in <project_patterns> and <structural_impact>.
3. learn: Discovery suggestion focused on explaining complex logic in <file_snippet> or <smart_symbol_context>.
4. feature: Strategic next step for development, identifying a new concept, feature, or logical continuation based on the current state.

Architectural Guardrails:
- Strictly adhere to <project_patterns>. Use the project's preferred idioms.
- Respect the <structural_impact>. If importance is HIGH, avoid suggestions that change the public API or core contracts.
- Ground suggestions in the <file_skeleton>, <import_context>, and <smart_symbol_context>. Use existing types and symbols correctly.
- Prioritize solving errors in <diagnostics>.

Output format: JSON array of EXACTLY 3 objects.
Each object must have:
- "text": The suggestion prompt.
- "type": One of "fix", "design", "learn", "feature".

Example:
[
  {"text": "Fix the type mismatch in login handler", "type": "fix"},
  {"text": "Add user authentication to the profile component", "type": "feature"},
  {"text": "Explain SpiderEngine symbol resolution", "type": "learn"}
]

Output ONLY the JSON, no tags, and no extra text.`

			// Isolation: We pass an empty history array to createMessage to bypass provider-side signature validation
			// for thinking blocks (e.g. Gemini Corrupted Thought Signature 400 error).
			// Full conversational context is instead provided via the <conversation_history> tag in the system prompt.
			const storageMessages: CodemarieStorageMessage[] = []

			// Resilience: Retry Logic and Timeout
			const generateWithRetry = async (retryCount = 1): Promise<PromptSuggestion[]> => {
				let timeoutId: NodeJS.Timeout | undefined
				try {
					const timeoutPromise = new Promise<never>((_, reject) => {
						timeoutId = setTimeout(() => reject(new Error("Suggestion generation timed out")), 10000)
					})

					const streamPromise = (async () => {
						const stream = handler.createMessage(systemPrompt, storageMessages)
						let fullText = ""
						for await (const chunk of stream) {
							// Concurrency Hardening: Discard if newer request started during streaming
							if (requestId !== this.activeRequestId) {
								handler.abort?.()
								throw new Error("Stale request cancelled")
							}

							if (chunk.type === "text") {
								fullText += chunk.text
							}
						}
						return fullText
					})()

					const fullText = await Promise.race([streamPromise, timeoutPromise])
					if (timeoutId) clearTimeout(timeoutId)

					// Parse JSON and validate (Robust extraction)
					let rawSuggestions: any[]
					try {
						// Strip potential markdown blocks and whitespace aggressively
						const jsonText = fullText.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim()
						// Handle edge case where model might have included preamble despite instructions
						const jsonStartIndex = jsonText.indexOf("[")
						const jsonEndIndex = jsonText.lastIndexOf("]")
						if (jsonStartIndex === -1 || jsonEndIndex === -1) throw new Error("No JSON array found")

						rawSuggestions = JSON.parse(jsonText.substring(jsonStartIndex, jsonEndIndex + 1))
					} catch (err) {
						Logger.warn("[SuggestionService] Failed to parse AI JSON response", fullText, err)
						throw new Error("Invalid format from AI")
					}

					if (!Array.isArray(rawSuggestions)) throw new Error("AI response is not an array")

					const finalSuggestions: PromptSuggestion[] = []

					for (const s of rawSuggestions.slice(0, 3)) {
						if (!s.text || !s.type) continue

						// Hardened Similarity Engine (Levenshtein Threshold: 0.8)
						const hasSimilarPending = this.suggestionHistory.some(
							(prev) => calculateSimilarity(prev.text, s.text) > 0.8,
						)

						if (!hasSimilarPending) {
							// Calculate structural impact score (0.0 - 1.0)
							// If importance is high, bias the impact score up
							let impact = 0.1
							if (structuralImpact) {
								const score = structuralImpact.blastRadius.centralityScore
								if (score > 0.2) impact = 0.8
								else if (score > 0) impact = 0.5

								// Scale by blast radius if available
								if (structuralImpact.blastRadius?.affectedNodes) {
									impact = Math.min(1.0, impact + structuralImpact.blastRadius.affectedNodes.length / 100)
								}
							}

							finalSuggestions.push({
								text: s.text,
								type: s.type as SuggestionType,
								impact: Number.parseFloat(impact.toFixed(2)),
							})
						}
					}

					if (finalSuggestions.length === 0) throw new Error("Empty suggestions after filtering")
					return finalSuggestions
				} catch (err) {
					if (timeoutId) clearTimeout(timeoutId)

					// Aggressively abort the background stream to prevent resource leaks and API rate limit consumption
					if (handler?.abort) {
						handler.abort()
					}

					if (retryCount > 0) {
						// Jittered Exponential Backoff
						const backoffMs = 2 ** (2 - retryCount) * 1000 + Math.random() * 500
						Logger.warn(
							`[SuggestionService] Generation failed, retrying in ${Math.round(backoffMs)}ms... (${retryCount} left)`,
							err,
						)
						await new Promise((resolve) => setTimeout(resolve, backoffMs))
						return generateWithRetry(retryCount - 1)
					}
					throw err
				}
			}

			const suggestions = await generateWithRetry()

			// Request ID Guard: Only update if this is still the active request
			if (requestId === this.activeRequestId) {
				this.lastSuggestions = suggestions
				this.lastFetchTime = Date.now()

				// Update History (maintain distinct suggestions)
				this.suggestionHistory = [...suggestions, ...this.suggestionHistory].slice(0, this.SUGGESTION_HISTORY_SIZE)

				// Update cache (with LRU eviction)
				if (filePath && contentHash) {
					if (this.suggestionCache.size >= SuggestionService.MAX_SUGGESTION_CACHE_SIZE) {
						const oldestKey = Array.from(this.suggestionCache.keys())[0]
						if (oldestKey) this.suggestionCache.delete(oldestKey)
					}
					this.suggestionCache.set(filePath, {
						suggestions,
						timestamp: Date.now(),
						contentHash,
					})
				}
			}

			const latency = Date.now() - startTime
			if (ulid) {
				telemetryService.captureSuggestionGenerated(ulid, suggestions.length)
				Logger.info(
					`[SuggestionService] Performance [${ulid}]: total=${latency}ms, ${JSON.stringify(componentLatencies)}`,
				)
			}

			return this.lastSuggestions
		} catch (error) {
			Logger.error("Failed to get AI prompt suggestions after hardening:", error)
			return this.getFallbackSuggestions()
		} finally {
			this.isGenerating = false
		}
	}

	private async getFallbackSuggestions(): Promise<PromptSuggestion[]> {
		const activeEditor = await HostProvider.window.getActiveEditor({})
		const filePath = activeEditor?.filePath

		const suggestions: PromptSuggestion[] = []
		if (filePath) {
			const relPath = await asRelativePath(filePath)
			suggestions.push({ text: `Explain ${require("path").basename(relPath)} to me`, type: "learn", impact: 0.1 })
			suggestions.push({ text: `Add unit tests for ${relPath}`, type: "design", impact: 0.2 })
			suggestions.push({ text: `Refactor ${relPath} for better readability`, type: "design", impact: 0.3 })
		} else {
			// Deep Workspace Discovery
			let workspaceName = "this project"
			let projectContext = ""
			try {
				const paths = await HostProvider.workspace.getWorkspacePaths({})
				if (paths.paths?.[0]) {
					const rootDir = paths.paths[0]
					const pathNode = require("path")
					workspaceName = pathNode.basename(rootDir)

					// Production Hardening: Try to find README for better context
					const fsNode = require("fs")
					const files = fsNode.readdirSync(rootDir)

					const readme = files.find((f: string) => f.toLowerCase().startsWith("readme.md"))
					if (readme) {
						projectContext = " based on the README"
						suggestions.push({
							text: `Summarize ${workspaceName} for me${projectContext}`,
							type: "learn",
							impact: 0.15,
						})
					}

					// Try to find main package/entry point
					const packageJson = files.find((f: string) => f === "package.json")
					if (packageJson) {
						suggestions.push({
							text: `What are the main scripts and dependencies in ${workspaceName}?`,
							type: "learn",
							impact: 0.1,
						})
					}
				}
			} catch {}

			suggestions.push({ text: `Explain the ${workspaceName} project structure`, type: "learn", impact: 0.1 })
			suggestions.push({
				text: `Help me find where the core logic is in ${workspaceName}`,
				type: "learn",
				impact: 0.1,
			})
			suggestions.push({
				text: `What's the best way to get started with ${workspaceName}?`,
				type: "learn",
				impact: 0.1,
			})
		}
		this.lastSuggestions = suggestions.slice(0, 3)
		return this.lastSuggestions
	}

	getCachedSuggestions(): PromptSuggestion[] {
		return this.lastSuggestions
	}

	getIsGenerating(): boolean {
		return this.isGenerating
	}

	/**
	 * Clears the current suggestions and resets the generation state.
	 * Used when user intent changes (e.g. sending a new message).
	 */
	clearSuggestions(): void {
		this.lastSuggestions = []
		this.isGenerating = false
		this.activeRequestId++
		Logger.info("[SuggestionService] Suggestions cleared")
	}

	private stringifyMessages(messages: any[]): string {
		if (messages.length === 0) return "No prior history."
		return messages
			.map((m) => {
				const role = m.role === "user" ? "User" : "Assistant"
				const content = Array.isArray(m.content)
					? m.content
							.map((c: any) => {
								if (c.type === "text") return c.text
								if (c.type === "thought" || c.type === "thinking") return `[Thought: ${c.thought || c.text}]`
								return `[${c.type}]`
							})
							.join("\n")
					: m.content
				return `${role}: ${content}`
			})
			.join("\n---\n")
	}

	/**
	 * Proactive Workspace Warming: Pre-indexes structural data and knowledge for the active workspace.
	 * Triggered when a file is opened to minimize first-suggestion latency.
	 */
	async warmup(filePath: string): Promise<void> {
		try {
			await this.ensureContext()
			if (this.agentContext && filePath) {
				const relPath = await asRelativePath(filePath)
				// Concurrent Warming via AgentContext/SDS
				await Promise.all([
					this.agentContext.searchKnowledge(`core logic in ${relPath}`, ["code"], 1).catch(() => {}),
					this.getFileSkeleton(filePath).catch(() => {}),
					this.getProjectPatterns().catch(() => {}),
				])
				Logger.info(`[SuggestionService] Context warmed for ${relPath}`)
			}
		} catch (err) {
			Logger.warn("[SuggestionService] Failed to perform proactive warmup", err)
		}
	}

	private async wrapContextCall<T>(name: string, promise: Promise<T>, fallback: T): Promise<T> {
		try {
			return await promise
		} catch (err) {
			Logger.warn(`[SuggestionService] Context component failed: ${name}`, err)
			return fallback
		}
	}
}
