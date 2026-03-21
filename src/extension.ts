import assert from "node:assert"
import { DIFF_VIEW_URI_SCHEME } from "@hosts/vscode/VscodeDiffViewProvider"
import { UiEvent } from "@shared/proto/codemarie/system"
import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
import { broadcastUiEvent as sendUiEvent } from "./core/controller/system/SystemUpdatesEmitter"

const UiEventType = {
	SHOW_WELCOME: "SHOW_WELCOME",
	SETTINGS_BUTTON_CLICKED: "SETTINGS_BUTTON_CLICKED",
	CHAT_BUTTON_CLICKED: "CHAT_BUTTON_CLICKED",
	HISTORY_BUTTON_CLICKED: "HISTORY_BUTTON_CLICKED",
	MCP_BUTTON_CLICKED: "MCP_BUTTON_CLICKED",
	ACCOUNT_BUTTON_CLICKED: "ACCOUNT_BUTTON_CLICKED",
	WORKTREES_BUTTON_CLICKED: "WORKTREES_BUTTON_CLICKED",
}

import { WebviewProvider } from "./core/webview"
import { createCodemarieAPI } from "./exports"
import { initializeTestMode } from "./services/test/TestMode"
import "./utils/path" // necessary to have access to String.prototype.toPosix
import path from "node:path"
import type { ExtensionContext } from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { vscodeHostBridgeClient } from "@/hosts/vscode/hostbridge/client/host-protobus-client"
import { createStorageContext } from "@/shared/storage/storage-context"
import { readTextFromClipboard, writeTextToClipboard } from "@/utils/env"
import { initialize, tearDown } from "./common"
import { addToCodemarie } from "./core/controller/system/addToCodemarie"
import { explainWithCodemarie } from "./core/controller/system/explainWithCodemarie"
import { fixWithCodemarie } from "./core/controller/system/fixWithCodemarie"
import { improveWithCodemarie } from "./core/controller/system/improveWithCodemarie"
import {
	broadcastUiEvent as sendAddToInputEvent,
	broadcastUiEvent as sendShowWebviewEvent,
} from "./core/controller/system/SystemUpdatesEmitter"
import { HookDiscoveryCache } from "./core/hooks/HookDiscoveryCache"
import {
	cleanupMcpMarketplaceCatalogFromGlobalState,
	cleanupOldApiKey,
	migrateCustomInstructionsToGlobalRules,
	migrateTaskHistoryToFile,
	migrateWelcomeViewCompleted,
	migrateWorkspaceToGlobalStorage,
} from "./core/storage/state-migrations"
import { workspaceResolver } from "./core/workspace"
import { findMatchingNotebookCell, getContextForCommand, showWebview } from "./hosts/vscode/commandUtils"
import { abortCommitGeneration, generateCommitMsg } from "./hosts/vscode/commit-message-generator"
import { registerCodemarieOutputChannel } from "./hosts/vscode/hostbridge/env/debugLog"
import {
	disposeVscodeCommentReviewController,
	getVscodeCommentReviewController,
} from "./hosts/vscode/review/VscodeCommentReviewController"
import { VscodeTerminalManager } from "./hosts/vscode/terminal/VscodeTerminalManager"
import { VscodeDiffViewProvider } from "./hosts/vscode/VscodeDiffViewProvider"
import { VscodeWebviewProvider } from "./hosts/vscode/VscodeWebviewProvider"
import { exportVSCodeStorageToSharedFiles } from "./hosts/vscode/vscode-to-file-migration"
import { ExtensionRegistryInfo } from "./registry"
import { AuthService } from "./services/auth/AuthService"
import { LogoutReason } from "./services/auth/types"
import { telemetryService } from "./services/telemetry"
import { SharedUriHandler, TASK_URI_PATH } from "./services/uri/SharedUriHandler"
import { ShowMessageType } from "./shared/proto/host/window"
import { fileExistsAtPath } from "./utils/fs"

let isActivating = false

// This method is called when the VS Code extension is activated.
// NOTE: This is VS Code specific - services that should be registered
// for all-platform should be registered in common.ts.
export async function activate(context: vscode.ExtensionContext) {
	if (isActivating) {
		return
	}
	isActivating = true

	const activationStartTime = performance.now()

	try {
		// 1. Set up HostProvider for VSCode
		// IMPORTANT: This must be done before any service can be registered
		setupHostProvider(context)
		Logger.log("[Extension] Host provider setup complete")

		// 2. Register core command handlers as early as possible so they are available immediately.
		// These handlers wait for the WebviewProvider to be fully initialized if clicked early.
		const { commands } = ExtensionRegistryInfo
		context.subscriptions.push(
			vscode.commands.registerCommand(commands.PlusButton, async () => {
				const sidebarInstance = await WebviewProvider.getInstancePromise()
				await sidebarInstance.controller.clearTask()
				await sidebarInstance.controller.postStateToWebview()
				await sendUiEvent(UiEvent.fromPartial({ type: UiEventType.SHOW_WELCOME }))
			}),
		)
		context.subscriptions.push(
			vscode.commands.registerCommand(commands.SettingsButton, async () => {
				await WebviewProvider.getInstancePromise()
				await sendUiEvent(UiEvent.fromPartial({ type: UiEventType.SETTINGS_BUTTON_CLICKED }))
			}),
		)
		context.subscriptions.push(
			vscode.commands.registerCommand(commands.HistoryButton, async () => {
				const sidebarInstance = await WebviewProvider.getInstancePromise()
				await sidebarInstance.controller.requestTaskHistory()
				await sendUiEvent(UiEvent.fromPartial({ type: UiEventType.HISTORY_BUTTON_CLICKED }))
			}),
		)
		context.subscriptions.push(
			vscode.commands.registerCommand(commands.McpButton, async () => {
				await WebviewProvider.getInstancePromise()
				await sendUiEvent(UiEvent.fromPartial({ type: UiEventType.MCP_BUTTON_CLICKED }))
			}),
		)
		context.subscriptions.push(
			vscode.commands.registerCommand(commands.AccountButton, async () => {
				await WebviewProvider.getInstancePromise()
				await sendUiEvent(UiEvent.fromPartial({ type: UiEventType.ACCOUNT_BUTTON_CLICKED }))
			}),
		)
		context.subscriptions.push(
			vscode.commands.registerCommand(commands.WorktreesButton, async () => {
				await WebviewProvider.getInstancePromise()
				await sendUiEvent(UiEvent.fromPartial({ type: UiEventType.WORKTREES_BUTTON_CLICKED }))
			}),
		)
		Logger.log("[Extension] Core commands registered")

		// 2. Clean up legacy data patterns within VSCode's native storage.
		// Moves workspace→global keys, task history→file, custom instructions→rules, etc.
		// Must run BEFORE the file export so we copy clean state.
		await cleanupLegacyVSCodeStorage(context)
		Logger.log("[Extension] Legacy storage cleanup complete")

		// 3. One-time export of VSCode's native storage to shared file-backed stores.
		// After this, all platforms (VSCode, CLI, JetBrains) read from ~/.codemarie/data/.
		const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		const storageContext = createStorageContext({ workspacePath })
		await exportVSCodeStorageToSharedFiles(context, storageContext)
		Logger.log("[Extension] Storage export complete")

		// 5. Register services and perform common initialization
		// IMPORTANT: Must be done after host provider is setup and migrations are complete
		const webview = (await initialize(storageContext)) as VscodeWebviewProvider
		Logger.log("[Extension] Common initialization complete")

		// 5. Register services and commands specific to VS Code
		// Initialize test mode and add disposables to context
		// 6. Initialize test mode if needed (non-blocking)
		// This sets up file watchers for evals.env which is not required for the initial frame
		setTimeout(() => {
			initializeTestMode(webview).catch((err) => {
				Logger.error("Failed to initialize test mode:", err)
			})
		}, 1000)
		// Initialize hook discovery cache for performance optimization
		HookDiscoveryCache.getInstance().initialize(
			context as any, // Adapt VSCode ExtensionContext to generic interface
			(dir: string) => {
				try {
					const pattern = new vscode.RelativePattern(dir, "*")
					const watcher = vscode.workspace.createFileSystemWatcher(pattern)
					// Ensure watcher is disposed when extension is deactivated
					context.subscriptions.push(watcher)
					// Adapt VSCode FileSystemWatcher to generic interface
					return {
						onDidCreate: (listener: () => void) => watcher.onDidCreate(listener),
						onDidChange: (listener: () => void) => watcher.onDidChange(listener),
						onDidDelete: (listener: () => void) => watcher.onDidDelete(listener),
						dispose: () => watcher.dispose(),
					}
				} catch {
					return null
				}
			},
			(callback: () => void) => {
				// Adapt VSCode Disposable to generic interface
				const disposable = vscode.workspace.onDidChangeWorkspaceFolders(callback)
				context.subscriptions.push(disposable)
				return disposable
			},
		)

		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(VscodeWebviewProvider.SIDEBAR_ID, webview, {
				webviewOptions: { retainContextWhenHidden: true },
			}),
		)

		// NOTE: Commands must be added to the internal registry before registering them with VSCode
		// Registrations moved to start of activate for better responsiveness

		// --- Tier 6: Swarm Governance Commands ---
		context.subscriptions.push(
			vscode.commands.registerCommand("codemarie.approveWave", async (waveId: string) => {
				const OrchestrationController = (await import("./core/orchestration/OrchestrationController"))
					.OrchestrationController
				OrchestrationController.approveWave(waveId, true)
				vscode.window.showInformationMessage(`Swarm Wave Approved.`)
			}),
		)
		context.subscriptions.push(
			vscode.commands.registerCommand("codemarie.rejectWave", async (waveId: string) => {
				const OrchestrationController = (await import("./core/orchestration/OrchestrationController"))
					.OrchestrationController
				OrchestrationController.approveWave(waveId, false)
				vscode.window.showErrorMessage(`Swarm Wave Rejected.`)
			}),
		)
		// -----------------------------------------

		/*
		We use the text document content provider API to show the left side for diff view by creating a
		virtual document for the original content. This makes it readonly so users know to edit the right
		side if they want to keep their changes.

		- This API allows you to create readonly documents in VSCode from arbitrary sources, and works by
		claiming an uri-scheme for which your provider then returns text contents. The scheme must be
		provided when registering a provider and cannot change afterwards.
		- Note how the provider doesn't create uris for virtual documents - its role is to provide contents
		given such an uri. In return, content providers are wired into the open document logic so that
		providers are always considered.
		https://code.visualstudio.com/api/extension-guides/virtual-documents
		*/
		const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
			provideTextDocumentContent(uri: vscode.Uri): string {
				return Buffer.from(uri.query, "base64").toString("utf-8")
			}
		})()
		context.subscriptions.push(
			vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider),
		)

		const handleUri = async (uri: vscode.Uri) => {
			const url = decodeURIComponent(uri.toString())
			const isTaskUri = getUriPath(url) === TASK_URI_PATH

			if (isTaskUri) {
				await openCodemarieSidebarForTaskUri()
			}

			let success = await SharedUriHandler.handleUri(url)

			// Task deeplinks can race with first-time sidebar initialization.
			if (!success && isTaskUri) {
				await openCodemarieSidebarForTaskUri()
				success = await SharedUriHandler.handleUri(url)
			}

			if (!success) {
				Logger.warn("Extension URI handler: Failed to process URI:", uri.toString())
			}
		}
		context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

		// Register size testing commands in development mode
		if (IS_DEV) {
			vscode.commands.executeCommand("setContext", "codemarie.isDevMode", IS_DEV)
			// Use dynamic import to avoid loading the module in production
			import("./dev/commands/tasks")
				.then((module) => {
					const devTaskCommands = module.registerTaskCommands(webview.controller)
					context.subscriptions.push(...devTaskCommands)
					Logger.log("[Codemarie Dev] Dev mode activated & dev commands registered")
				})
				.catch((error) => {
					Logger.error(`[Codemarie Dev] Failed to register dev commands: ${error}`)
				})
		}

		context.subscriptions.push(
			vscode.commands.registerCommand(commands.TerminalOutput, async () => {
				const terminal = vscode.window.activeTerminal
				await sendUiEvent(UiEvent.fromPartial({ type: UiEventType.SHOW_WELCOME }))
				if (!terminal) {
					return
				}

				// Save current clipboard content
				const tempCopyBuffer = await readTextFromClipboard()

				try {
					// Copy the *existing* terminal selection (without selecting all)
					await vscode.commands.executeCommand("workbench.action.terminal.copySelection")

					// Get copied content
					const terminalContents = (await readTextFromClipboard()).trim()

					// Restore original clipboard content
					await writeTextToClipboard(tempCopyBuffer)

					if (!terminalContents) {
						// No terminal content was copied (either nothing selected or some error)
						return
					}
					// Ensure the sidebar view is visible but preserve editor focus
					await showWebview(true)

					await sendAddToInputEvent(
						UiEvent.fromPartial({
							type: "ADD_TO_INPUT",
							dataJson: JSON.stringify({ input: `Terminal output:\n\`\`\`\n${terminalContents}\n\`\`\`` }),
						}),
					)

					Logger.log("addSelectedTerminalOutputToChat", terminalContents, terminal.name)
				} catch (error) {
					// Ensure clipboard is restored even if an error occurs
					await writeTextToClipboard(tempCopyBuffer)
					Logger.error("Error getting terminal contents:", error)
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: "Failed to get terminal contents",
					})
				}
			}),
		)

		// Register code action provider
		context.subscriptions.push(
			vscode.languages.registerCodeActionsProvider(
				"*",
				new (class implements vscode.CodeActionProvider {
					public static readonly providedCodeActionKinds = [
						vscode.CodeActionKind.QuickFix,
						vscode.CodeActionKind.Refactor,
					]

					provideCodeActions(
						document: vscode.TextDocument,
						range: vscode.Range,
						actionContext: vscode.CodeActionContext,
					): vscode.CodeAction[] {
						const CONTEXT_LINES_TO_EXPAND = 3
						const actions: vscode.CodeAction[] = []
						const editor = vscode.window.activeTextEditor // Get active editor for selection check

						// Expand range to include surrounding 3 lines or use selection if broader
						const selection = editor?.selection
						let expandedRange = range
						if (
							editor &&
							selection &&
							!selection.isEmpty &&
							selection.contains(range.start) &&
							selection.contains(range.end)
						) {
							expandedRange = selection
						} else {
							expandedRange = new vscode.Range(
								Math.max(0, range.start.line - CONTEXT_LINES_TO_EXPAND),
								0,
								Math.min(document.lineCount - 1, range.end.line + CONTEXT_LINES_TO_EXPAND),
								document.lineAt(Math.min(document.lineCount - 1, range.end.line + CONTEXT_LINES_TO_EXPAND)).text
									.length,
							)
						}

						// Add to Codemarie (Always available)
						const addAction = new vscode.CodeAction("Add to Codemarie", vscode.CodeActionKind.QuickFix)
						addAction.command = {
							command: commands.AddToChat,
							title: "Add to Codemarie",
							arguments: [expandedRange, actionContext.diagnostics],
						}
						actions.push(addAction)

						// Explain with Codemarie (Always available)
						const explainAction = new vscode.CodeAction(
							"Explain with Codemarie",
							vscode.CodeActionKind.RefactorExtract,
						) // Using a refactor kind
						explainAction.command = {
							command: commands.ExplainCode,
							title: "Explain with Codemarie",
							arguments: [expandedRange],
						}
						actions.push(explainAction)

						// Improve with Codemarie (Always available)
						const improveAction = new vscode.CodeAction(
							"Improve with Codemarie",
							vscode.CodeActionKind.RefactorRewrite,
						) // Using a refactor kind
						improveAction.command = {
							command: commands.ImproveCode,
							title: "Improve with Codemarie",
							arguments: [expandedRange],
						}
						actions.push(improveAction)

						// Fix with Codemarie (Only if diagnostics exist)
						if (actionContext.diagnostics.length > 0) {
							const fixAction = new vscode.CodeAction("Fix with Codemarie", vscode.CodeActionKind.QuickFix)
							fixAction.isPreferred = true
							fixAction.command = {
								command: commands.FixWithCodemarie,
								title: "Fix with Codemarie",
								arguments: [expandedRange, actionContext.diagnostics],
							}
							actions.push(fixAction)
						}
						return actions
					}
				})(),
				{
					providedCodeActionKinds: [
						vscode.CodeActionKind.QuickFix,
						vscode.CodeActionKind.RefactorExtract,
						vscode.CodeActionKind.RefactorRewrite,
					],
				},
			),
		)

		// Register the command handlers
		context.subscriptions.push(
			vscode.commands.registerCommand(
				commands.AddToChat,
				async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
					const ctx = await getContextForCommand(range, diagnostics)
					if (ctx) await addToCodemarie(ctx.controller, ctx.commandContext)
				},
			),
		)
		context.subscriptions.push(
			vscode.commands.registerCommand(
				commands.FixWithCodemarie,
				async (range: vscode.Range, diagnostics: vscode.Diagnostic[]) => {
					const ctx = await getContextForCommand(range, diagnostics)
					if (ctx) await fixWithCodemarie(ctx.controller, ctx.commandContext)
				},
			),
		)
		context.subscriptions.push(
			vscode.commands.registerCommand(commands.ExplainCode, async (range: vscode.Range) => {
				const ctx = await getContextForCommand(range)
				if (ctx) await explainWithCodemarie(ctx.controller, ctx.commandContext)
			}),
		)
		context.subscriptions.push(
			vscode.commands.registerCommand(commands.ImproveCode, async (range: vscode.Range) => {
				const ctx = await getContextForCommand(range)
				if (ctx) await improveWithCodemarie(ctx.controller, ctx.commandContext)
			}),
		)

		context.subscriptions.push(
			vscode.commands.registerCommand(commands.FocusChatInput, async (preserveEditorFocus = false) => {
				const webviewProvider = WebviewProvider.getInstance() as VscodeWebviewProvider

				// Show the webview
				webviewProvider.getWebview()?.show(preserveEditorFocus)

				// Send show webview event with preserveEditorFocus flag
				sendShowWebviewEvent(
					UiEvent.fromPartial({
						type: "SHOW_WEBVIEW",
						dataJson: JSON.stringify({ preserveEditorFocus }),
					}),
				)
				telemetryService.captureButtonClick("command_focusChatInput", webviewProvider.controller?.task?.ulid)
			}),
		)

		// Register Jupyter Notebook command handlers
		const NOTEBOOK_EDIT_INSTRUCTIONS = `Special considerations for using replace_in_file on *.ipynb files:
* Jupyter notebook files are JSON format with specific structure for source code cells
* Source code in cells is stored as JSON string arrays ending with explicit \\n characters and commas
* Always match the exact JSON format including quotes, commas, and escaped newlines.`

		// Helper to get notebook context for Jupyter commands
		async function getNotebookCommandContext(range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) {
			const activeNotebook = vscode.window.activeNotebookEditor
			if (!activeNotebook) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "No active Jupyter notebook found. Please open a .ipynb file first.",
				})
				return null
			}

			const ctx = await getContextForCommand(range, diagnostics)
			if (!ctx) {
				return null
			}

			const filePath = ctx.commandContext.filePath || ""
			let cellJson: string | null = null
			if (activeNotebook.notebook.cellCount > 0) {
				const cellIndex = activeNotebook.notebook.cellAt(activeNotebook.selection.start).index
				cellJson = await findMatchingNotebookCell(filePath, cellIndex)
			}

			return { ...ctx, cellJson }
		}

		context.subscriptions.push(
			vscode.commands.registerCommand(
				commands.JupyterGenerateCell,
				async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
					const userPrompt = await showJupyterPromptInput(
						"Generate Notebook Cell",
						"Enter your prompt for generating notebook cell (press Enter to confirm & Esc to cancel)",
					)
					if (!userPrompt) return

					const ctx = await getNotebookCommandContext(range, diagnostics)
					if (!ctx) return

					const notebookContext = `User prompt: ${userPrompt}
Insert a new Jupyter notebook cell above or below the current cell based on user prompt.
${NOTEBOOK_EDIT_INSTRUCTIONS}

Current Notebook Cell Context (JSON, sanitized of image data):
\`\`\`json
${ctx.cellJson || "{}"}
\`\`\``

					await addToCodemarie(ctx.controller, ctx.commandContext, notebookContext)
				},
			),
		)

		context.subscriptions.push(
			vscode.commands.registerCommand(
				commands.JupyterExplainCell,
				async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
					const ctx = await getNotebookCommandContext(range, diagnostics)
					if (!ctx) return

					const notebookContext = ctx.cellJson
						? `\n\nCurrent Notebook Cell Context (JSON, sanitized of image data):\n\`\`\`json\n${ctx.cellJson}\n\`\`\``
						: undefined

					await explainWithCodemarie(ctx.controller, ctx.commandContext, notebookContext)
				},
			),
		)

		context.subscriptions.push(
			vscode.commands.registerCommand(
				commands.JupyterImproveCell,
				async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
					const userPrompt = await showJupyterPromptInput(
						"Improve Notebook Cell",
						"Enter your prompt for improving the current notebook cell (press Enter to confirm & Esc to cancel)",
					)
					if (!userPrompt) return

					const ctx = await getNotebookCommandContext(range, diagnostics)
					if (!ctx) return

					const notebookContext = `User prompt: ${userPrompt}
${NOTEBOOK_EDIT_INSTRUCTIONS}

Current Notebook Cell Context (JSON, sanitized of image data):
\`\`\`json
${ctx.cellJson || "{}"}
\`\`\``

					await improveWithCodemarie(ctx.controller, ctx.commandContext, notebookContext)
				},
			),
		)

		// Register the openWalkthrough command handler
		context.subscriptions.push(
			vscode.commands.registerCommand(commands.Walkthrough, async () => {
				await vscode.commands.executeCommand(
					"workbench.action.openWalkthrough",
					`${context.extension.id}#CodemarieWalkthrough`,
				)
				telemetryService.captureButtonClick("command_openWalkthrough")
			}),
		)

		// Register the reconstructTaskHistory command handler
		context.subscriptions.push(
			vscode.commands.registerCommand(commands.ReconstructTaskHistory, async () => {
				const { reconstructTaskHistory } = await import("./core/commands/reconstructTaskHistory")
				await reconstructTaskHistory()
				telemetryService.captureButtonClick("command_reconstructTaskHistory")
			}),
		)

		// Register the generateGitCommitMessage command handler
		context.subscriptions.push(
			vscode.commands.registerCommand(commands.GenerateCommit, async (scm) => {
				generateCommitMsg(webview.controller, scm)
			}),
			vscode.commands.registerCommand(commands.AbortCommit, () => {
				abortCommitGeneration()
			}),
		)

		// Listen for secrets changes (e.g., cross-window login/logout sync)
		const unsubSecrets = storageContext.secrets.onDidChange((event) => {
			if (event.key === "codemarie:codemarieAccountId") {
				const secretValue = storageContext.secrets.get<string>(event.key)
				const activeWebview = WebviewProvider.getVisibleInstance()
				const controller = activeWebview?.controller

				const authService = AuthService.getInstance(controller)
				if (secretValue) {
					// Secret was added or updated - restore auth info (login from another window)
					authService?.restoreRefreshTokenAndRetrieveAuthInfo()
				} else {
					// Secret was removed - handle logout for all windows
					authService?.handleDeauth(LogoutReason.CROSS_WINDOW_SYNC)
				}
			}
		})
		context.subscriptions.push({ dispose: unsubSecrets })

		Logger.log(`[Codemarie] extension activated in ${performance.now() - activationStartTime} ms`)

		return createCodemarieAPI(webview.controller)
	} catch (error) {
		isActivating = false
		Logger.error("[Extension] Activation failed:", error)
		vscode.window.showErrorMessage(`Codemarie failed to activate: ${error instanceof Error ? error.message : String(error)}`)
		throw error
	}
}

async function showJupyterPromptInput(title: string, placeholder: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		const quickPick = vscode.window.createQuickPick()
		quickPick.title = title
		quickPick.placeholder = placeholder
		quickPick.ignoreFocusOut = true

		// Allow free text input
		quickPick.canSelectMany = false

		let userInput = ""

		quickPick.onDidChangeValue((value) => {
			userInput = value
			// Update items to show the current input
			if (value) {
				quickPick.items = [
					{
						label: "$(check) Use this prompt",
						detail: value,
						alwaysShow: true,
					},
				]
			} else {
				quickPick.items = []
			}
		})

		quickPick.onDidAccept(() => {
			if (userInput) {
				resolve(userInput)
				quickPick.hide()
			}
		})

		quickPick.onDidHide(() => {
			if (!userInput) {
				resolve(undefined)
			}
			quickPick.dispose()
		})

		quickPick.show()
	})
}

function setupHostProvider(context: ExtensionContext) {
	const outputChannel = registerCodemarieOutputChannel(context)
	outputChannel.appendLine("[Codemarie] Setting up VS Code host...")

	const createWebview = () => new VscodeWebviewProvider(context)
	const createDiffView = () => new VscodeDiffViewProvider()
	const createCommentReview = () => getVscodeCommentReviewController()
	const createTerminalManager = () => new VscodeTerminalManager()

	const getCallbackUrl = async (path: string) => {
		const scheme = vscode.env.uriScheme || "vscode"
		const callbackUri = vscode.Uri.parse(`${scheme}://${context.extension.id}${path}`)

		if (vscode.env.uiKind === vscode.UIKind.Web) {
			// In VS Code Web (Codespaces, code serve-web), vscode:// URIs redirect to the
			// desktop app instead of staying in the browser. Use asExternalUri to convert
			// to a web-reachable HTTPS URL that routes back to the extension's URI handler.
			const externalUri = await vscode.env.asExternalUri(callbackUri)
			return externalUri.toString(true)
		}

		// In regular desktop VS Code, use the vscode:// URI protocol handler directly.
		return callbackUri.toString(true)
	}
	HostProvider.initialize(
		createWebview,
		createDiffView,
		createCommentReview,
		createTerminalManager,
		vscodeHostBridgeClient,
		() => {}, // No-op logger, logging is handled via HostProvider.env.debugLog
		getCallbackUrl,
		getBinaryLocation,
		context.extensionUri.fsPath,
		context.globalStorageUri.fsPath,
	)
}

function getUriPath(url: string): string | undefined {
	try {
		return new URL(url).pathname
	} catch {
		return undefined
	}
}

async function openCodemarieSidebarForTaskUri(): Promise<void> {
	const sidebarWaitTimeoutMs = 3000
	const sidebarWaitIntervalMs = 50

	await vscode.commands.executeCommand(`${ExtensionRegistryInfo.views.Sidebar}.focus`)

	const startedAt = Date.now()
	while (Date.now() - startedAt < sidebarWaitTimeoutMs) {
		try {
			if (WebviewProvider.getVisibleInstance()) {
				return
			}
		} catch (error) {
			Logger.error("Error checking for Codemarie sidebar visibility:", error)
			return // Exit loop on error to prevent infinite retries
		}
		await new Promise((resolve) => setTimeout(resolve, sidebarWaitIntervalMs))
	}

	Logger.warn("Task URI handling timed out waiting for Codemarie sidebar visibility")
}

async function getBinaryLocation(name: string): Promise<string> {
	// The only binary currently supported is the rg binary from the VSCode installation.
	if (!name.startsWith("rg")) {
		throw new Error(`Binary '${name}' is not supported`)
	}

	const checkPath = async (pkgFolder: string) => {
		const fullPathResult = workspaceResolver.resolveWorkspacePath(
			vscode.env.appRoot,
			path.join(pkgFolder, name),
			"Services.ripgrep.getBinPath",
		)
		const fullPath = typeof fullPathResult === "string" ? fullPathResult : fullPathResult.absolutePath
		return (await fileExistsAtPath(fullPath)) ? fullPath : undefined
	}

	const binPath =
		(await checkPath("node_modules/@vscode/ripgrep/bin/")) ||
		(await checkPath("node_modules/vscode-ripgrep/bin")) ||
		(await checkPath("node_modules.asar.unpacked/vscode-ripgrep/bin/")) ||
		(await checkPath("node_modules.asar.unpacked/@vscode/ripgrep/bin/"))
	if (!binPath) {
		throw new Error("Could not find ripgrep binary")
	}
	return binPath
}

// This method is called when your extension is deactivated
export async function deactivate() {
	// Dispose Non-VSCode-specific services
	tearDown()

	// VSCode-specific services
	disposeVscodeCommentReviewController()
}

// TODO: Find a solution for automatically removing DEV related content from production builds.
//  This type of code is fine in production to keep. We just will want to remove it from production builds
//  to bring down built asset sizes.
//
// This is a workaround to reload the extension when the source code changes
// since vscode doesn't support hot reload for extensions
const IS_DEV = process.env.IS_DEV === "true"
const DEV_WORKSPACE_FOLDER = process.env.DEV_WORKSPACE_FOLDER

// Set up development mode file watcher
if (IS_DEV) {
	assert(DEV_WORKSPACE_FOLDER, "DEV_WORKSPACE_FOLDER must be set in development")
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(DEV_WORKSPACE_FOLDER, "src/**/*"))

	let reloadTimeout: NodeJS.Timeout | null = null
	watcher.onDidChange(({ scheme, path }) => {
		// Ignore specific generated or state files to avoid reload loops
		if (path.includes(".log") || path.includes("history.json") || path.includes(".db")) {
			return
		}

		Logger.info(`${scheme} ${path} changed. Reloading VSCode in 1s...`)

		if (reloadTimeout) {
			clearTimeout(reloadTimeout)
		}
		reloadTimeout = setTimeout(() => {
			vscode.commands.executeCommand("workbench.action.reloadWindow")
		}, 1000)
	})
}

// VSCode-specific storage migrations
async function cleanupLegacyVSCodeStorage(context: ExtensionContext): Promise<void> {
	try {
		await cleanupOldApiKey(context)
		// Migrate is not done if the new storage does not have the lastShownAnnouncementId flag
		const hasMigrated = context.globalState.get("lastShownAnnouncementId")
		if (hasMigrated !== undefined) {
			return
		}

		Logger.info("[VS Code Storage Migrations] Starting")

		// Migrate custom instructions to global Codemarie rules (one-time cleanup)
		await migrateCustomInstructionsToGlobalRules(context)

		// Migrate welcomeViewCompleted setting based on existing API keys (one-time cleanup)
		await migrateWelcomeViewCompleted(context)

		// Migrate workspace storage values back to global storage (reverting previous migration)
		await migrateWorkspaceToGlobalStorage(context)

		// Ensure taskHistory.json exists and migrate legacy state (runs once)
		await migrateTaskHistoryToFile(context)

		// Clean up MCP marketplace catalog from global state (moved to disk cache)
		await cleanupMcpMarketplaceCatalogFromGlobalState(context)

		// lastShownAnnouncementId will be set when announcement is shown
		// after activation so we don't need to set it here.

		Logger.info("[VS Code Storage Migrations] Completed")
	} catch (error) {
		Logger.warn(`[VS Code Storage Migrations] Failed${error instanceof Error ? `: ${error.message}` : ""}`)
	}
}
