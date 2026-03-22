import * as crypto from "node:crypto"
import { exec } from "child_process"
import * as fs from "fs/promises"
import { promisify } from "util"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import type { Diagnostic, FileDiagnostics } from "@/shared/proto/codemarie/common"
import { Logger } from "@/shared/services/Logger"
import { asRelativePath } from "@/utils/path"

const execAsync = promisify(exec)

interface CachedSuggestions {
	suggestions: string[]
	timestamp: number
	contentHash: string
}

export class SuggestionService {
	private lastSuggestions: string[] = []
	private isGenerating = false
	private lastFetchTime = 0
	private readonly DEBOUNCE_INTERVAL = 10000 // 10 seconds
	private agentContext?: any // AgentContext
	private workspace?: any // Workspace
	private suggestionCache = new Map<string, CachedSuggestions>()
	private activeRequestId = 0

	private async ensureContext(): Promise<void> {
		if (this.agentContext) return

		try {
			const stateManager = StateManager.get()
			const machineId = ((stateManager as any).getGlobalStateKey("codemarie.generatedMachineId") as string) || "anonymous"
			const paths = await HostProvider.workspace.getWorkspacePaths({})
			const cwd = paths.paths?.[0] || process.cwd()
			const workspaceId = crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 12)

			const { BufferedDbPool } = require("@/infrastructure/db/BufferedDbPool.js")
			const { Workspace } = require("@/core/broccolidb/workspace.js")
			const { AgentContext } = require("@/core/broccolidb/agent-context.js")

			const db = new BufferedDbPool()
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
	): Promise<{ structuralImpact: any; semanticContext: string[] }> {
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
			const semanticContext = searchResults.map((res: any) => res.content)
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
						const sev = d.severity === 0 ? "Error" : d.severity === 1 ? "Warning" : "Info"
						return `[${sev}] ${d.message}`
					})
					.join("\n")
			}
		} catch (err) {
			Logger.error("Failed to fetch diagnostics for suggestions", err)
		}
		return ""
	}

	private async getGitStatusContext(): Promise<string> {
		try {
			const { stdout } = await execAsync("git status -s", { timeout: 2000 })
			if (stdout.trim()) {
				return stdout.trim().split("\n").slice(0, 10).join("\n")
			}
		} catch {
			// Silently fail for git status
		}
		return ""
	}

	private async getFileSkeleton(filePath: string | undefined): Promise<string> {
		if (!filePath) return ""
		try {
			const { loadRequiredLanguageParsers } = require("@/services/tree-sitter/languageParser.js")
			const { parseFile } = require("@/services/tree-sitter/index.js")
			const parsers = await loadRequiredLanguageParsers([filePath])
			const skeleton = await parseFile(filePath, parsers)
			return skeleton || ""
		} catch (err) {
			Logger.warn(`[SuggestionService] Failed to generate file skeleton: ${filePath}`, err)
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

	private calculateContentHash(content: string, filePath: string): string {
		return crypto.createHash("md5").update(`${filePath}:${content}`).digest("hex")
	}

	async getSuggestions(messages: CodemarieStorageMessage[] = [], ulid?: string): Promise<string[]> {
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

			const activeProvider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider

			// User-Selected Model Integration
			const isModelSet =
				mode === "plan"
					? !!(
							suggestionApiConfig.planModeApiModelId ||
							suggestionApiConfig.planModeOpenRouterModelId ||
							suggestionApiConfig.planModeOpenAiModelId ||
							suggestionApiConfig.planModeCodemarieModelId
						)
					: !!(
							suggestionApiConfig.actModeApiModelId ||
							suggestionApiConfig.actModeOpenRouterModelId ||
							suggestionApiConfig.actModeOpenAiModelId ||
							suggestionApiConfig.actModeCodemarieModelId
						)

			if (!isModelSet) {
				// Modern Fallback Strategy (only if user hasn't selected a specific model)
				switch (activeProvider) {
					case "anthropic":
						suggestionApiConfig.actModeApiModelId = "claude-3-5-haiku-20241022"
						suggestionApiConfig.planModeApiModelId = "claude-3-5-haiku-20241022"
						break
					case "openai":
						suggestionApiConfig.actModeOpenAiModelId = "gpt-4o-mini"
						suggestionApiConfig.planModeOpenAiModelId = "gpt-4o-mini"
						break
					case "openrouter":
						suggestionApiConfig.actModeOpenRouterModelId = "google/gemini-2.0-flash-001"
						suggestionApiConfig.planModeOpenRouterModelId = "google/gemini-2.0-flash-001"
						break
					case "gemini":
						suggestionApiConfig.actModeApiModelId = "gemini-1.5-flash"
						suggestionApiConfig.planModeApiModelId = "gemini-1.5-flash"
						break
					case "bedrock":
						suggestionApiConfig.actModeApiModelId = "anthropic.claude-3-5-haiku-20241022-v1:0"
						suggestionApiConfig.planModeApiModelId = "anthropic.claude-3-5-haiku-20241022-v1:0"
						break
				}
			}

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

					// Cache lookup
					const cached = this.suggestionCache.get(filePath)
					if (cached && cached.contentHash === contentHash && now - cached.timestamp < 300000) {
						// 5 min cache
						this.lastSuggestions = cached.suggestions
						this.lastFetchTime = now
						this.isGenerating = false
						return this.lastSuggestions
					}

					// Increased window to 200 lines for better context
					fileSnippet = content.split("\n").slice(0, 200).join("\n")
				} catch (err) {
					Logger.error(`Failed to read active file for suggestions: ${filePath}`, err)
				}
			}

			// BroccoliDB Deep Context
			await this.ensureContext()

			// Parallel Context Gathering
			const [deepContext, diagnosticsSummary, gitStatusSummary, fileSkeleton, importContext] = await Promise.all([
				this.getDeepContext(filePath, fileSnippet),
				this.getDiagnosticsContext(),
				this.getGitStatusContext(),
				this.getFileSkeleton(filePath),
				this.getImportContext(filePath),
			])

			const { structuralImpact, semanticContext } = deepContext

			// Structured Prompting with XML-style tags
			const systemPrompt = `You are a helpful coding assistant specialized in providing forward-looking prompt suggestions.
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
<diagnostics>
${diagnosticsSummary || "No problems detected."}
</diagnostics>
<git_status>
${gitStatusSummary || "No pending changes."}
</git_status>

Your task is to generate 3 short, diverse prompt suggestions (under 60 chars each) that the user might want to run next.

Architectural Guardrails:
- Respect the <structural_impact>. If importance is HIGH, prioritize safety and stability.
- Ground suggestions in the <file_skeleton> and <import_context>. Use existing APIs correctly.
- Prioritize solving issues in <diagnostics>.
- Avoid suggesting changes that would increase architectural entropy or introduce circular dependencies.

Categorize your suggestions internally as:
1. PRIMARY FIX: Addressing an current error or warning.
2. TECHNICAL IMPROVEMENT: Refactoring, testing, or optimization.
3. LOGICAL NEXT STEP: Implementing a related feature or expanding the logic.

Example output format:
Add unit tests for this function
Fix the type mismatch in the loop
Refactor to use a builder pattern

Output ONLY the suggestions, one per line, no numbering, no tags, and no extra text.`

			const storageMessages: CodemarieStorageMessage[] = messages.slice(-5).map((m) => ({
				role: m.role,
				content: typeof m.content === "string" ? m.content : m.content.filter((c) => c.type === "text"),
			}))

			// Resilience: Retry Logic and Timeout
			const generateWithRetry = async (retryCount = 1): Promise<string[]> => {
				let timeoutId: NodeJS.Timeout | undefined
				try {
					const timeoutPromise = new Promise<never>((_, reject) => {
						timeoutId = setTimeout(() => reject(new Error("Suggestion generation timed out")), 10000)
					})

					const streamPromise = (async () => {
						const stream = handler.createMessage(systemPrompt, storageMessages)
						let fullText = ""
						for await (const chunk of stream) {
							if (chunk.type === "text") {
								fullText += chunk.text
							}
						}
						return fullText
					})()

					const fullText = await Promise.race([streamPromise, timeoutPromise])
					if (timeoutId) clearTimeout(timeoutId)

					const suggestions = fullText
						.split("\n")
						.map((s) => s.trim())
						.filter((s) => s.length > 0 && !s.startsWith("-") && !/^\d+\./.test(s))
						.slice(0, 3)

					if (suggestions.length === 0) throw new Error("Empty suggestions from AI")
					return suggestions
				} catch (err) {
					if (timeoutId) clearTimeout(timeoutId)
					if (retryCount > 0) {
						Logger.warn(`Suggestion generation failed, retrying... (${retryCount} left)`, err)
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

				// Update cache
				if (filePath && contentHash) {
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
				Logger.info(`Generated ${suggestions.length} suggestions in ${latency}ms (ulid: ${ulid})`)
			}

			return this.lastSuggestions
		} catch (error) {
			Logger.error("Failed to get AI prompt suggestions after hardening:", error)
			return this.getFallbackSuggestions()
		} finally {
			this.isGenerating = false
		}
	}

	private async getFallbackSuggestions(): Promise<string[]> {
		const activeEditor = await HostProvider.window.getActiveEditor({})
		const filePath = activeEditor?.filePath

		const suggestions: string[] = []
		if (filePath) {
			const relPath = await asRelativePath(filePath)
			suggestions.push(`Refactor ${relPath}`)
			suggestions.push(`Add unit tests for ${relPath}`)
			suggestions.push(`Explain ${relPath} to me`)
		} else {
			suggestions.push("Help me find where the core logic is")
			suggestions.push("Explain the project structure")
			suggestions.push("What's the best way to get started?")
		}
		this.lastSuggestions = suggestions.slice(0, 3)
		return this.lastSuggestions
	}

	getCachedSuggestions(): string[] {
		return this.lastSuggestions
	}

	getIsGenerating(): boolean {
		return this.isGenerating
	}
}
