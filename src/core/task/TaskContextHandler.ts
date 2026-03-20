import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { ApiHandler, ApiProviderInfo } from "@core/api"
import { getContextWindowInfo } from "@core/context/context-management/context-window-utils"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { CodemarieIgnoreController } from "@core/ignore/CodemarieIgnoreController"
import { parseMentions } from "@core/mentions"
import { formatResponse } from "@core/prompts/responses"
import { parseSlashCommands } from "@core/slash-commands"
import { GlobalFileNames } from "@core/storage/disk"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { HostProvider } from "@hosts/host-provider"
import { ITerminalManager } from "@integrations/terminal/types"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { listFiles } from "@services/glob/list-files"
import { McpHub } from "@services/mcp/McpHub"
import { findLast } from "@shared/array"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import { CodemarieMessage } from "@shared/ExtensionMessage"
import { USER_CONTENT_TAGS } from "@shared/messages/constants"
import { isClaude4PlusModelFamily, isGPT5ModelFamily } from "@utils/model-utils"
import { arePathsEqual, getDesktopDir } from "@utils/path"
import { filterExistingFiles } from "@utils/tabFiltering"
import pWaitFor from "p-wait-for"
import * as path from "path"
import { CodemarieContent, CodemarieTextContentBlock } from "@/shared/messages"
import { ensureLocalCodemarieDirExists } from "../context/instructions/user-instructions/rule-helpers"
import { refreshWorkflowToggles } from "../context/instructions/user-instructions/workflows"
import { Controller } from "../controller"
import { StateManager } from "../storage/StateManager"
import { FocusChainManager } from "./focus-chain"
import { MessageStateHandler } from "./message-state"
import { TaskState } from "./TaskState"

export interface TaskContextDependencies {
	cwd: string
	stateManager: StateManager
	workspaceManager?: WorkspaceRootManager
	codemarieIgnoreController: CodemarieIgnoreController
	terminalManager: ITerminalManager
	fileContextTracker: FileContextTracker
	urlContentFetcher: UrlContentFetcher
	focusChainManager?: FocusChainManager
	taskState: TaskState
	controller: Controller
	ulid: string
	mcpHub: McpHub
	api: ApiHandler
	messageStateHandler: MessageStateHandler
}

export class TaskContextHandler {
	constructor(private deps: TaskContextDependencies) {}

	async loadContext(
		userContent: CodemarieContent[],
		includeFileDetails = false,
		useCompactPrompt = false,
	): Promise<[CodemarieContent[], string, boolean]> {
		let needsCodemarierulesFileCheck = false

		const {
			ulid,
			stateManager,
			cwd,
			controller,
			urlContentFetcher,
			fileContextTracker,
			workspaceManager,
			focusChainManager,
			taskState,
		} = this.deps

		const apiConfig = stateManager.getApiConfiguration()
		const mode = stateManager.getGlobalSettingsKey("mode")
		const providerId = (mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const customPrompt = stateManager.getGlobalSettingsKey("customPrompt")
		const providerInfo: ApiProviderInfo = {
			model: this.deps.api.getModel(),
			providerId,
			customPrompt,
			mode,
		}

		const { localWorkflowToggles, globalWorkflowToggles } = await refreshWorkflowToggles(controller, cwd)

		const hasUserContentTag = (text: string): boolean => {
			return USER_CONTENT_TAGS.some((tag) => text.includes(tag))
		}

		const parseTextBlock = async (text: string): Promise<string> => {
			const parsedText = await parseMentions(text, cwd, urlContentFetcher, fileContextTracker, workspaceManager)

			// Create MCP prompt fetcher callback that wraps mcpHub.getPrompt
			// We need mcpHub here too.
			const mcpPromptFetcher = async (serverName: string, promptName: string) => {
				try {
					return await this.deps.mcpHub.getPrompt(serverName, promptName)
				} catch {
					return null
				}
			}

			const { processedText, needsCodemarierulesFileCheck: needsCheck } = await parseSlashCommands(
				parsedText,
				localWorkflowToggles,
				globalWorkflowToggles,
				ulid,
				stateManager.getGlobalSettingsKey("focusChainSettings"),
				stateManager.getGlobalStateKey("nativeToolCallEnabled"),
				providerInfo,
				mcpPromptFetcher,
			)

			if (needsCheck) {
				needsCodemarierulesFileCheck = true
			}

			return processedText
		}

		const processTextContent = async (block: CodemarieTextContentBlock): Promise<CodemarieTextContentBlock> => {
			if (block.type !== "text" || !hasUserContentTag(block.text)) {
				return block
			}

			const processedText = await parseTextBlock(block.text)
			return { ...block, text: processedText }
		}

		const processContentBlock = async (block: CodemarieContent): Promise<CodemarieContent> => {
			if (block.type === "text") {
				return processTextContent(block)
			}

			if (block.type === "tool_result") {
				if (!block.content) {
					return block
				}

				if (typeof block.content === "string") {
					const processed = await processTextContent({ type: "text", text: block.content })
					return { ...block, content: [processed] }
				}

				if (Array.isArray(block.content)) {
					const processedContent = await Promise.all(
						block.content.map(async (contentBlock) => {
							return contentBlock.type === "text" ? processTextContent(contentBlock) : contentBlock
						}),
					)

					return { ...block, content: processedContent }
				}
			}

			return block
		}

		const [processedUserContent, environmentDetails] = await Promise.all([
			Promise.all(userContent.map(processContentBlock)),
			this.getEnvironmentDetails(includeFileDetails),
		])

		const codemarierulesError = needsCodemarierulesFileCheck
			? await ensureLocalCodemarieDirExists(cwd, GlobalFileNames.codemarieRules)
			: false

		if (!useCompactPrompt && focusChainManager?.shouldIncludeFocusChainInstructions()) {
			const focusChainInstructions = focusChainManager.generateFocusChainInstructions()
			if (focusChainInstructions.trim()) {
				processedUserContent.push({
					type: "text",
					text: focusChainInstructions,
				})

				taskState.apiRequestsSinceLastTodoUpdate = 0
				taskState.todoListWasUpdatedByUser = false
			}
		}

		return [processedUserContent, environmentDetails, codemarierulesError]
	}

	async getEnvironmentDetails(includeFileDetails = false) {
		const host = await HostProvider.env.getHostVersion({})
		let details = ""

		details += this.formatWorkspaceRootsSection()

		details += `\n\n# ${host.platform} Visible Files`
		const rawVisiblePaths = (await HostProvider.window.getVisibleTabs({})).paths
		const filteredVisiblePaths = await filterExistingFiles(rawVisiblePaths)
		const visibleFilePaths = filteredVisiblePaths.map((absolutePath) => path.relative(this.deps.cwd, absolutePath))

		const allowedVisibleFiles = this.deps.codemarieIgnoreController
			.filterPaths(visibleFilePaths)
			.map((p) => p.toPosix())
			.join("\n")

		if (allowedVisibleFiles) {
			details += `\n${allowedVisibleFiles}`
		} else {
			details += "\n(No visible files)"
		}

		details += `\n\n# ${host.platform} Open Tabs`
		const rawOpenTabPaths = (await HostProvider.window.getOpenTabs({})).paths
		const filteredOpenTabPaths = await filterExistingFiles(rawOpenTabPaths)
		const openTabPaths = filteredOpenTabPaths.map((absolutePath) => path.relative(this.deps.cwd, absolutePath))

		const allowedOpenTabs = this.deps.codemarieIgnoreController
			.filterPaths(openTabPaths)
			.map((p) => p.toPosix())
			.join("\n")

		if (allowedOpenTabs) {
			details += `\n${allowedOpenTabs}`
		} else {
			details += "\n(No open tabs)"
		}

		const busyTerminals = this.deps.terminalManager.getTerminals(true)
		const inactiveTerminals = this.deps.terminalManager.getTerminals(false)

		if (busyTerminals.length > 0 && this.deps.taskState.didEditFile) {
			await setTimeoutPromise(300)
		}
		if (busyTerminals.length > 0) {
			await pWaitFor(() => busyTerminals.every((t) => !this.deps.terminalManager.isProcessHot(t.id)), {
				interval: 100,
				timeout: 15_000,
			}).catch(() => {})
		}

		this.deps.taskState.didEditFile = false

		let terminalDetails = ""
		if (busyTerminals.length > 0) {
			terminalDetails += "\n\n# Actively Running Terminals"
			for (const busyTerminal of busyTerminals) {
				terminalDetails += `\n## Original command: \`${busyTerminal.lastCommand}\``
				const newOutput = this.deps.terminalManager.getUnretrievedOutput(busyTerminal.id)
				if (newOutput) {
					terminalDetails += `\n### New Output\n${newOutput}`
				}
			}
		}
		if (inactiveTerminals.length > 0) {
			const inactiveTerminalOutputs = new Map<number, string>()
			for (const inactiveTerminal of inactiveTerminals) {
				const newOutput = this.deps.terminalManager.getUnretrievedOutput(inactiveTerminal.id)
				if (newOutput) {
					inactiveTerminalOutputs.set(inactiveTerminal.id, newOutput)
				}
			}
			if (inactiveTerminalOutputs.size > 0) {
				terminalDetails += "\n\n# Inactive Terminals"
				for (const [terminalId, newOutput] of inactiveTerminalOutputs) {
					const inactiveTerminal = inactiveTerminals.find((t) => t.id === terminalId)
					if (inactiveTerminal) {
						terminalDetails += `\n## ${inactiveTerminal.lastCommand}`
						terminalDetails += `\n### New Output\n${newOutput}`
					}
				}
			}
		}

		if (terminalDetails) {
			details += terminalDetails
		}

		const recentlyModifiedFiles = this.deps.fileContextTracker.getAndClearRecentlyModifiedFiles()
		if (recentlyModifiedFiles.length > 0) {
			details +=
				"\n\n# Recently Modified Files\nThese files have been modified since you last accessed them (file was just edited so you may need to re-read it before editing):"
			for (const filePath of recentlyModifiedFiles) {
				details += `\n${filePath}`
			}
		}

		const now = new Date()
		const formatter = new Intl.DateTimeFormat(undefined, {
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
			hour12: true,
		})
		const timeZone = formatter.resolvedOptions().timeZone
		const timeZoneOffset = -now.getTimezoneOffset() / 60
		const timeZoneOffsetStr = `${timeZoneOffset >= 0 ? "+" : ""}${timeZoneOffset}:00`
		details += `\n\n# Current Time\n${formatter.format(now)} (${timeZone}, UTC${timeZoneOffsetStr})`

		if (includeFileDetails) {
			details += this.formatFileDetailsHeader()
			const isDesktop = arePathsEqual(this.deps.cwd, getDesktopDir())
			if (isDesktop) {
				details += "(Desktop files not shown automatically. Use list_files to explore if needed.)"
			} else {
				const [files, didHitLimit] = await listFiles(this.deps.cwd, true, 200)
				const result = formatResponse.formatFilesList(
					this.deps.cwd,
					files,
					didHitLimit,
					this.deps.codemarieIgnoreController,
				)
				details += result
			}

			if (this.deps.workspaceManager) {
				const workspacesJson = await this.deps.workspaceManager.buildWorkspacesJson()
				if (workspacesJson) {
					details += `\n\n# Workspace Configuration\n${workspacesJson}`
				}
			}

			const { detectAvailableCliTools } = await import("./utils")
			const availableCliTools = await detectAvailableCliTools()
			if (availableCliTools.length > 0) {
				details += `\n\n# Detected CLI Tools\nThese are some of the tools on the user's machine, and may be useful if needed to accomplish the task: ${availableCliTools.join(
					", ",
				)}. This list is not exhaustive, and other tools may be available.`
			}
		}

		const { contextWindow } = getContextWindowInfo(this.deps.api)

		const getTotalTokensFromApiReqMessage = (msg: CodemarieMessage) => {
			if (!msg.text) return 0
			try {
				const { tokensIn, tokensOut, cacheWrites, cacheReads } = JSON.parse(msg.text)
				return (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
			} catch {
				return 0
			}
		}

		const codemarieMessages = this.deps.messageStateHandler.getCodemarieMessages()
		const modifiedMessages = combineApiRequests(combineCommandSequences(codemarieMessages.slice(1)))
		const lastApiReqMessage = findLast(modifiedMessages, (msg) => {
			if (msg.say !== "api_req_started") return false
			return getTotalTokensFromApiReqMessage(msg) > 0
		})

		const lastApiReqTotalTokens = lastApiReqMessage ? getTotalTokensFromApiReqMessage(lastApiReqMessage) : 0
		const usagePercentage = Math.round((lastApiReqTotalTokens / contextWindow) * 100)

		const currentModelId = this.deps.api.getModel().id
		const isNextGenModel = isClaude4PlusModelFamily(currentModelId) || isGPT5ModelFamily(currentModelId)

		let shouldShowContextWindow = true
		if (isNextGenModel) {
			const autoCondenseThreshold = 0.75
			const displayThreshold = autoCondenseThreshold - 0.15
			const currentUsageRatio = lastApiReqTotalTokens / contextWindow
			shouldShowContextWindow = currentUsageRatio >= displayThreshold
		}

		if (shouldShowContextWindow) {
			details += "\n\n# Context Window Usage"
			details += `\n${lastApiReqTotalTokens.toLocaleString()} / ${(
				contextWindow / 1000
			).toLocaleString()}K tokens used (${usagePercentage}%)`
		}

		details += "\n\n# Current Mode"
		const mode = this.deps.stateManager.getGlobalSettingsKey("mode")
		if (mode === "plan") {
			details += `\nPLAN MODE\n${formatResponse.planModeInstructions()}`
		} else {
			details += "\nACT MODE"
		}

		return `<environment_details>\n${details.trim()}\n</environment_details>`
	}

	private formatWorkspaceRootsSection(): string {
		const multiRootEnabled = isMultiRootEnabled(this.deps.stateManager)
		const roots = this.deps.workspaceManager ? this.deps.workspaceManager.getRoots() : []

		if (!multiRootEnabled || roots.length <= 1) {
			return ""
		}

		let section = "\n\n# Workspace Roots"

		for (const root of roots) {
			const name = root.name || path.basename(root.path)
			const vcs = root.vcs ? ` (${String(root.vcs)})` : ""
			section += `\n- ${name}: ${root.path}${vcs}`
		}

		const primary = this.deps.workspaceManager?.getPrimaryRoot()
		const primaryName = this.getPrimaryWorkspaceName(primary)
		section += `\n\nPrimary workspace: ${primaryName}`

		return section
	}

	private getPrimaryWorkspaceName(primary?: ReturnType<WorkspaceRootManager["getRoots"]>[0]): string {
		if (primary?.name) {
			return primary.name
		}
		if (primary?.path) {
			return path.basename(primary.path)
		}
		return path.basename(this.deps.cwd)
	}

	private formatFileDetailsHeader(): string {
		const multiRootEnabled = isMultiRootEnabled(this.deps.stateManager)
		const roots = this.deps.workspaceManager?.getRoots() || []

		if (multiRootEnabled && roots.length > 1) {
			const primary = this.deps.workspaceManager?.getPrimaryRoot()
			const primaryName = this.getPrimaryWorkspaceName(primary)
			return `\n\n# Current Working Directory (Primary: ${primaryName}) Files\n`
		}
		return `\n\n# Current Working Directory (${this.deps.cwd.toPosix()}) Files\n`
	}

	isProjectBlank(files: string[]): boolean {
		if (files.length === 0) return true

		const sourceExtensions = [
			".ts",
			".js",
			".tsx",
			".jsx",
			".py",
			".go",
			".rs",
			".cpp",
			".c",
			".h",
			".java",
			".rb",
			".php",
			".swift",
			".kt",
			".md",
			".mdx",
		]
		const scaffoldingFiles = [
			"package.json",
			"package-lock.json",
			"yarn.lock",
			"pnpm-lock.yaml",
			"tsconfig.json",
			".gitignore",
			".npmrc",
			".prettierrc",
			".eslintrc",
			"README.md",
			"LICENSE",
			".DS_Store",
		]

		return files.every((f) => {
			const basename = path.basename(f)
			const ext = path.extname(f).toLowerCase()

			if (sourceExtensions.includes(ext)) {
				if (basename.toLowerCase() === "readme.md") return true
				return false
			}

			if (scaffoldingFiles.includes(basename)) return true

			if (basename.startsWith(".")) return true

			return false
		})
	}
}
