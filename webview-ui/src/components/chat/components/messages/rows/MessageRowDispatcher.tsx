import { COMMAND_OUTPUT_STRING } from "@shared/combineCommandSequences"
import {
	COMPLETION_RESULT_CHANGES_FLAG,
	CodemarieApiReqInfo,
	CodemarieAskQuestion,
	CodemarieAskUseMcpServer,
	CodemarieMessage,
	CodemariePlanModeResponse,
	CodemarieSayGenerateExplanation,
	CodemarieSayTool,
} from "@shared/ExtensionMessage"
import { BooleanRequest, StringRequest } from "@shared/proto/codemarie/common"
import { Mode } from "@shared/storage/types"
import {
	ArrowRightIcon,
	BellIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleSlashIcon,
	CircleXIcon,
	FileCode2Icon,
	FilePlus2Icon,
	FoldVerticalIcon,
	ImageUpIcon,
	LayersIcon,
	LightbulbIcon,
	Link2Icon,
	PencilIcon,
	RefreshCwIcon,
	SearchIcon,
	SettingsIcon,
	SquareArrowOutUpRightIcon,
	SquareMinusIcon,
	TerminalIcon,
	TriangleAlertIcon,
} from "lucide-react"
import type React from "react"
import { useMemo } from "react"
import { ActionCheckboxes } from "@/components/chat/components/messages/rows/ActionCheckboxes"
import { OptionsButtons } from "@/components/chat/components/messages/rows/OptionsButtons"
import { QuoteButtonState } from "@/components/chat/hooks/useQuoteButton"
import { CheckmarkControl } from "@/components/common/CheckmarkControl"
import McpResponseDisplay from "@/components/mcp/chat-display/McpResponseDisplay"
import McpResourceRow from "@/components/mcp/configuration/tabs/installed/server-row/McpResourceRow"
import McpToolRow from "@/components/mcp/configuration/tabs/installed/server-row/McpToolRow"
import { WithCopyButton } from "@/components/ui/copy-button"
import { useGlobalState } from "@/context/GlobalStateContext"
import { cn } from "@/lib/utils"
import { FileServiceClient, UiServiceClient } from "@/services/protobus-client"
import { findMatchingResourceOrTemplate, getMcpServerDisplayName } from "@/utils/mcp"
import CodeAccordian, { cleanPathPrefix } from "../../../../common/CodeAccordian"
import { AlignmentGuard } from "./AlignmentGuard"
import { ClarificationHub } from "./ClarificationHub"
import { CommandOutputContent, CommandOutputRow } from "./CommandOutputRow"
import { CompletionOutputRow } from "./CompletionOutputRow"
import { DiffEditRow } from "./DiffEditRow"
import ErrorRow from "./ErrorRow"
import { GroundingHeader } from "./GroundingHeader"
import HookMessage from "./HookMessage"
import { IntentDecomposition } from "./IntentDecomposition"
import { MarkdownRow } from "./MarkdownRow"
import NewTaskPreview from "./NewTaskPreview"
import OrchestrationEventRow from "./OrchestrationEventRow"
import { OutcomeMapper } from "./OutcomeMapper"
import PlanCompletionOutputRow from "./PlanCompletionOutputRow"
import QuoteButton from "./QuoteButton"
import { RedTeamAlerts } from "./RedTeamAlerts"
import ReportBugPreview from "./ReportBugPreview"
import { RequestStartRow } from "./RequestStartRow"
import SearchResultsDisplay from "./SearchResultsDisplay"
import SubagentStatusRow from "./SubagentStatusRow"
import { ThinkingRow } from "./ThinkingRow"
import UserMessage from "./UserMessage"
import WaveApprovalRow from "./WaveApprovalRow"

export const ProgressIndicator = () => <LoaderCircleIcon className="size-2 mr-2 animate-spin" />

import { LoaderCircleIcon } from "lucide-react"

const InvisibleSpacer = () => <div aria-hidden className="h-px" />

interface MessageRowDispatcherProps {
	message: CodemarieMessage
	isExpanded: boolean
	onToggleExpand: (ts: number) => void
	lastModifiedMessage?: CodemarieMessage
	isLast: boolean
	inputValue?: string
	sendMessageFromChatRow?: (text: string, images: string[], files: string[]) => void
	onCancelCommand?: () => void
	mode?: Mode
	isRequestInProgress?: boolean
	reasoningContent?: string
	responseStarted?: boolean

	// State from ChatRowContent
	seeNewChangesDisabled: boolean
	setSeeNewChangesDisabled: (val: boolean) => void
	explainChangesDisabled: boolean
	setExplainChangesDisabled: (val: boolean) => void
	selectedActions: string[]
	setSelectedActions: (val: string[]) => void
	quoteButtonState: QuoteButtonState
	handleQuoteClick: () => void
	handleMouseUp: (event: React.MouseEvent<HTMLDivElement>) => void
	contentRef: React.RefObject<HTMLDivElement>
	isOutputFullyExpanded: boolean
	setIsOutputFullyExpanded: (val: boolean) => void
}

const HEADER_CLASSNAMES = "flex items-center gap-2.5 mb-3"

const MessageRowDispatcher = ({
	message,
	isExpanded,
	onToggleExpand,
	lastModifiedMessage,
	isLast,
	inputValue,
	sendMessageFromChatRow,
	onCancelCommand,
	mode,
	isRequestInProgress,
	reasoningContent,
	responseStarted,
	seeNewChangesDisabled,
	setSeeNewChangesDisabled,
	explainChangesDisabled,
	setExplainChangesDisabled,
	selectedActions,
	setSelectedActions,
	quoteButtonState,
	handleQuoteClick,
	handleMouseUp,
	contentRef,
	isOutputFullyExpanded,
	setIsOutputFullyExpanded,
}: MessageRowDispatcherProps) => {
	const { backgroundEditEnabled, mcpServers, mcpMarketplaceCatalog, vscodeTerminalExecutionMode, codemarieMessages } =
		useGlobalState()

	const type = message.type === "ask" ? message.ask : message.say

	const isMcpServerResponding = isLast && lastModifiedMessage?.say === "mcp_server_request_started"

	const [icon, title] = useMemo(() => {
		switch (type) {
			case "error":
				return [
					<span className="codicon codicon-error text-error mb-[-1.5px]" key="error-icon" />,
					<span className="text-error font-bold text-sm" key="error-title">
						Error
					</span>,
				]
			case "mistake_limit_reached":
				return [
					<CircleXIcon className="text-error size-2" key="mistake-icon" />,
					<span className="text-error font-bold text-sm" key="mistake-title">
						Codemarie is having trouble...
					</span>,
				]
			case "command":
				return [
					<TerminalIcon className="text-foreground size-2" key="command-icon" />,
					<span className="font-bold text-foreground text-sm" key="command-title">
						Codemarie wants to execute this command:
					</span>,
				]
			case "use_mcp_server":
				const mcpServerUse = JSON.parse(message.text || "{}") as CodemarieAskUseMcpServer
				return [
					isMcpServerResponding ? (
						<ProgressIndicator key="mcp-progress" />
					) : (
						<span className="codicon codicon-server text-foreground mb-[-1.5px]" key="mcp-icon" />
					),
					<span className="ph-no-capture font-bold text-foreground break-words text-sm" key="mcp-title">
						Codemarie wants to {mcpServerUse.type === "use_mcp_tool" ? "use a tool" : "access a resource"} on the{" "}
						<code className="break-all text-xs">
							{getMcpServerDisplayName(mcpServerUse.serverName, mcpMarketplaceCatalog)}
						</code>{" "}
						MCP server:
					</span>,
				]
			case "completion_result":
				return [
					<span className="codicon codicon-check text-success mb-[-1.5px]" key="completion-icon" />,
					<span className="text-success font-bold text-sm" key="completion-title">
						Task Completed
					</span>,
				]
			case "api_req_started":
				return [null, null]
			case "followup":
				return [
					<span className="codicon codicon-question text-foreground mb-[-1.5px]" key="followup-icon" />,
					<span className="font-bold text-foreground text-sm" key="followup-title">
						Codemarie has a question:
					</span>,
				]
			case "wave_approval":
				return [
					<LayersIcon className="text-link size-2" key="wave-approval-icon" />,
					<span className="font-bold text-foreground text-sm" key="wave-approval-title">
						Swarm Wave Approval Required
					</span>,
				]
			default:
				return [null, null]
		}
	}, [type, isMcpServerResponding, message.text, mcpMarketplaceCatalog])

	const tool = useMemo(() => {
		if (message.ask === "tool" || message.say === "tool") {
			return JSON.parse(message.text || "{}") as CodemarieSayTool
		}
		return null
	}, [message.ask, message.say, message.text])

	const conditionalRulesInfo = useMemo(() => {
		if (message.say !== "conditional_rules_applied" || !message.text) return null
		try {
			const parsed = JSON.parse(message.text) as unknown
			if (!parsed || typeof parsed !== "object" || !("rules" in parsed) || !Array.isArray(parsed.rules)) {
				return null
			}
			return parsed as {
				rules: Array<{ name: string; matchedConditions: Record<string, string[]> }>
			}
		} catch {
			return null
		}
	}, [message.say, message.text])

	const handleToggle = () => {
		onToggleExpand(message.ts)
	}

	const isImageFile = (filePath: string): boolean => {
		const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"]
		const extension = filePath.toLowerCase().split(".").pop()
		return extension ? imageExtensions.includes(`.${extension}`) : false
	}

	const [cost, _apiReqCancelReason, apiReqStreamingFailedMessage] = useMemo(() => {
		if (message.text != null && message.say === "api_req_started") {
			const info: CodemarieApiReqInfo = JSON.parse(message.text)
			return [info.cost, info.cancelReason, info.streamingFailedMessage]
		}
		return [undefined, undefined, undefined]
	}, [message.text, message.say])

	const apiRequestFailedMessage =
		isLast && lastModifiedMessage?.ask === "api_req_failed" ? lastModifiedMessage?.text : undefined

	if (conditionalRulesInfo) {
		const names = conditionalRulesInfo.rules.map((r: { name: string }) => r.name).join(", ")
		return (
			<div className={HEADER_CLASSNAMES}>
				<span style={{ fontWeight: "bold" }}>Conditional rules applied:</span>
				<span className="ph-no-capture break-words whitespace-pre-wrap">{names}</span>
			</div>
		)
	}

	if (tool) {
		const colorMap = {
			red: "var(--vscode-errorForeground)",
			yellow: "var(--vscode-editorWarning-foreground)",
			green: "var(--vscode-charts-green)",
		}
		const toolIcon = (name: string, color?: string, rotation?: number, title?: string) => (
			<span
				className={`codicon codicon-${name} ph-no-capture`}
				style={{
					color: color ? colorMap[color as keyof typeof colorMap] || color : "var(--vscode-foreground)",
					marginBottom: "-1.5px",
					transform: rotation ? `rotate(${rotation}deg)` : undefined,
				}}
				title={title}
			/>
		)

		switch (tool.tool) {
			case "editedExistingFile":
				const content = tool?.content || ""
				const isApplyingPatch = content?.startsWith("%%bash") && !content.endsWith("*** End Patch\nEOF")
				const editToolTitle = isApplyingPatch
					? "Codemarie is creating patches to edit this file:"
					: "Codemarie wants to edit this file:"
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							<PencilIcon className="size-2" />
							{tool.operationIsLocatedInWorkspace === false &&
								toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
							<span style={{ fontWeight: "bold" }}>{editToolTitle}</span>
						</div>
						{backgroundEditEnabled && tool.path && tool.content ? (
							<DiffEditRow
								isLoading={message.partial}
								patch={tool.content}
								path={tool.path}
								startLineNumbers={tool.startLineNumbers}
							/>
						) : (
							<CodeAccordian
								code={tool.content}
								isExpanded={isExpanded}
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						)}
					</div>
				)
			case "fileDeleted":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							<SquareMinusIcon className="size-2" />
							{tool.operationIsLocatedInWorkspace === false &&
								toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
							<span style={{ fontWeight: "bold" }}>Codemarie wants to delete this file:</span>
						</div>
						<CodeAccordian
							code={tool.content}
							isExpanded={isExpanded}
							onToggleExpand={handleToggle}
							path={tool.path!}
						/>
					</div>
				)
			case "newFileCreated":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							<FilePlus2Icon className="size-2" />
							{tool.operationIsLocatedInWorkspace === false &&
								toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
							<span className="font-bold">Codemarie wants to create a new file:</span>
						</div>
						{backgroundEditEnabled && tool.path && tool.content ? (
							<DiffEditRow patch={tool.content} path={tool.path} startLineNumbers={tool.startLineNumbers} />
						) : (
							<CodeAccordian
								code={tool.content!}
								isExpanded={isExpanded}
								isLoading={message.partial}
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						)}
					</div>
				)
			case "readFile":
				const isImage = isImageFile(tool.path || "")
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							{isImage ? <ImageUpIcon className="size-2" /> : <FileCode2Icon className="size-2" />}
							{tool.operationIsLocatedInWorkspace === false &&
								toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
							<span className="font-bold">Codemarie wants to read this file:</span>
						</div>
						<div className="bg-code rounded-sm overflow-hidden border border-editor-group-border">
							<div
								className={cn("text-description flex items-center cursor-pointer select-none py-2 px-2.5", {
									"cursor-default select-text": isImage,
								})}
								onClick={() => {
									if (!isImage) {
										FileServiceClient.openFile(StringRequest.create({ value: tool.content })).catch((err) =>
											console.error("Failed to open file:", err),
										)
									}
								}}>
								{tool.path?.startsWith(".") && <span>.</span>}
								{tool.path && !tool.path.startsWith(".") && <span>/</span>}
								<span className="ph-no-capture whitespace-nowrap overflow-hidden text-ellipsis mr-2 text-left [direction: rtl]">
									{`${cleanPathPrefix(tool.path ?? "")}\u200E`}
								</span>
								<div className="grow" />
								{!isImage && <SquareArrowOutUpRightIcon className="size-2" />}
							</div>
						</div>
					</div>
				)
			case "listFilesTopLevel":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							{toolIcon("folder-opened")}
							{tool.operationIsLocatedInWorkspace === false &&
								toolIcon("sign-out", "yellow", -90, "This is outside of your workspace")}
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask"
									? "Codemarie wants to view the top level files in this directory:"
									: "Codemarie viewed the top level files in this directory:"}
							</span>
						</div>
						<CodeAccordian
							code={tool.content!}
							isExpanded={isExpanded}
							language="shell-session"
							onToggleExpand={handleToggle}
							path={tool.path!}
						/>
					</div>
				)
			case "listFilesRecursive":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							{toolIcon("folder-opened")}
							{tool.operationIsLocatedInWorkspace === false &&
								toolIcon("sign-out", "yellow", -90, "This is outside of your workspace")}
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask"
									? "Codemarie wants to recursively view all files in this directory:"
									: "Codemarie recursively viewed all files in this directory:"}
							</span>
						</div>
						<CodeAccordian
							code={tool.content!}
							isExpanded={isExpanded}
							language="shell-session"
							onToggleExpand={handleToggle}
							path={tool.path!}
						/>
					</div>
				)
			case "listCodeDefinitionNames":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							{toolIcon("file-code")}
							{tool.operationIsLocatedInWorkspace === false &&
								toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask"
									? "Codemarie wants to view source code definition names used in this directory:"
									: "Codemarie viewed source code definition names used in this directory:"}
							</span>
						</div>
						<CodeAccordian
							code={tool.content!}
							isExpanded={isExpanded}
							onToggleExpand={handleToggle}
							path={tool.path!}
						/>
					</div>
				)
			case "searchFiles":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							{toolIcon("search")}
							{tool.operationIsLocatedInWorkspace === false &&
								toolIcon("sign-out", "yellow", -90, "This is outside of your workspace")}
							<span className="font-bold">
								Codemarie wants to search this directory for <code className="break-all">{tool.regex}</code>:
							</span>
						</div>
						<SearchResultsDisplay
							content={tool.content!}
							filePattern={tool.filePattern}
							isExpanded={isExpanded}
							onToggleExpand={handleToggle}
							path={tool.path!}
						/>
					</div>
				)
			case "summarizeTask":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							<FoldVerticalIcon className="size-2" />
							<span className="font-bold">Codemarie is condensing the conversation:</span>
						</div>
						<div className="bg-code overflow-hidden border border-editor-group-border rounded-[3px]">
							<div
								aria-label={isExpanded ? "Collapse summary" : "Expand summary"}
								className="text-description py-2 px-2.5 cursor-pointer select-none"
								onClick={handleToggle}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault()
										e.stopPropagation()
										handleToggle()
									}
								}}>
								{isExpanded ? (
									<div>
										<div className="flex items-center mb-2">
											<span className="font-bold mr-1">Summary:</span>
											<div className="grow" />
											<ChevronDownIcon className="my-0.5 shrink-0 size-4" />
										</div>
										<span className="ph-no-capture break-words whitespace-pre-wrap">{tool.content}</span>
									</div>
								) : (
									<div className="flex items-center">
										<span className="ph-no-capture whitespace-nowrap overflow-hidden text-ellipsis text-left flex-1 mr-2 [direction:rtl]">
											{`${tool.content}\u200E`}
										</span>
										<ChevronRightIcon className="my-0.5 shrink-0 size-4" />
									</div>
								)}
							</div>
						</div>
					</div>
				)
			case "webFetch":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							<Link2Icon className="size-2" />
							{tool.operationIsLocatedInWorkspace === false &&
								toolIcon("sign-out", "yellow", -90, "This URL is external")}
							<span className="font-bold">
								{message.type === "ask"
									? "Codemarie wants to fetch content from this URL:"
									: "Codemarie fetched content from this URL:"}
							</span>
						</div>
						<div
							className="bg-code rounded-xs overflow-hidden border border-editor-group-border py-2 px-2.5 cursor-pointer select-none"
							onClick={() => {
								if (tool.path) {
									UiServiceClient.openUrl(StringRequest.create({ value: tool.path })).catch((err) => {
										console.error("Failed to open URL:", err)
									})
								}
							}}>
							<span className="ph-no-capture whitespace-nowrap overflow-hidden text-ellipsis mr-2 [direction:rtl] text-left text-link underline">
								{`${tool.path}\u200E`}
							</span>
						</div>
					</div>
				)
			case "webSearch":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							<SearchIcon className="size-2 rotate-90" />
							{tool.operationIsLocatedInWorkspace === false &&
								toolIcon("sign-out", "yellow", -90, "This search is external")}
							<span className="font-bold">
								{message.type === "ask"
									? "Codemarie wants to search the web for:"
									: "Codemarie searched the web for:"}
							</span>
						</div>
						<div className="bg-code border border-editor-group-border overflow-hidden rounded-xs select-text py-[9px] px-2.5">
							<span className="ph-no-capture whitespace-nowrap overflow-hidden text-ellipsis mr-2 text-left [direction:rtl]">
								{`${tool.path}\u200E`}
							</span>
						</div>
					</div>
				)
			case "useSkill":
				return (
					<div>
						<div className={HEADER_CLASSNAMES}>
							<LightbulbIcon className="size-2" />
							<span className="font-bold">Codemarie loaded the skill:</span>
						</div>
						<div className="bg-code border border-editor-group-border overflow-hidden rounded-xs py-[9px] px-2.5">
							<span className="ph-no-capture font-medium">{tool.path}</span>
						</div>
					</div>
				)
			default:
				return <InvisibleSpacer />
		}
	}

	if (message.ask === "command" || message.say === "command") {
		const isCommandMessage = type === "command"
		const commandHasOutput = message.text?.includes(COMMAND_OUTPUT_STRING) ?? false
		const isCommandExecuting = isCommandMessage && !message.commandCompleted && commandHasOutput
		const isCommandPending = isCommandMessage && isLast && !message.commandCompleted && !commandHasOutput
		const isCommandCompleted = isCommandMessage && message.commandCompleted === true

		return (
			<CommandOutputRow
				icon={icon}
				isBackgroundExec={vscodeTerminalExecutionMode === "backgroundExec"}
				isCommandCompleted={isCommandCompleted}
				isCommandExecuting={isCommandExecuting}
				isCommandPending={isCommandPending}
				isOutputFullyExpanded={isOutputFullyExpanded}
				message={message}
				onCancelCommand={onCancelCommand}
				setIsOutputFullyExpanded={setIsOutputFullyExpanded}
				title={title}
			/>
		)
	}

	if (message.ask === "use_subagents" || message.say === "use_subagents") {
		return <SubagentStatusRow isLast={isLast} lastModifiedMessage={lastModifiedMessage} message={message} />
	}

	if (message.ask === "use_mcp_server" || message.say === "use_mcp_server") {
		const useMcpServer = JSON.parse(message.text || "{}") as CodemarieAskUseMcpServer
		const server = mcpServers.find((server) => server.name === useMcpServer.serverName)
		return (
			<div>
				<div className={HEADER_CLASSNAMES}>
					{icon}
					{title}
				</div>

				<div className="bg-code rounded-xs py-2 px-2.5 mt-2">
					{useMcpServer.type === "access_mcp_resource" && (
						<McpResourceRow
							item={{
								...(findMatchingResourceOrTemplate(
									useMcpServer.uri || "",
									server?.resources,
									server?.resourceTemplates,
								) || {
									name: "",
									mimeType: "",
									description: "",
								}),
								uri: useMcpServer.uri || "",
							}}
						/>
					)}

					{useMcpServer.type === "use_mcp_tool" && (
						<div>
							<div onClick={(e) => e.stopPropagation()}>
								<McpToolRow
									serverName={useMcpServer.serverName}
									tool={{
										name: useMcpServer.toolName || "",
										description:
											server?.tools?.find((tool) => tool.name === useMcpServer.toolName)?.description || "",
										autoApprove:
											server?.tools?.find((tool) => tool.name === useMcpServer.toolName)?.autoApprove ||
											false,
									}}
								/>
							</div>
							{useMcpServer.arguments && useMcpServer.arguments !== "{}" && (
								<div className="mt-2">
									<div className="mb-1 opacity-80 uppercase">Arguments</div>
									<CodeAccordian
										code={useMcpServer.arguments}
										isExpanded={true}
										language="json"
										onToggleExpand={handleToggle}
									/>
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		)
	}

	switch (message.type) {
		case "say":
			switch (message.say) {
				case "api_req_started":
					return (
						<RequestStartRow
							apiReqStreamingFailedMessage={apiReqStreamingFailedMessage}
							apiRequestFailedMessage={apiRequestFailedMessage}
							codemarieMessages={codemarieMessages}
							cost={cost}
							handleToggle={handleToggle}
							isExpanded={isExpanded}
							message={message}
							mode={mode}
							reasoningContent={reasoningContent}
							responseStarted={responseStarted}
						/>
					)
				case "api_req_finished":
					return <InvisibleSpacer />
				case "mcp_server_response":
					return <McpResponseDisplay responseText={message.text || ""} />
				case "mcp_notification":
					return (
						<div className="flex items-start gap-2 py-2.5 px-3 bg-quote rounded-sm text-base text-foreground opacity-90 mb-2">
							<BellIcon className="mt-0.5 size-2 text-notification-foreground shrink-0" />
							<div className="break-words flex-1">
								<span className="font-medium">MCP Notification: </span>
								<span className="ph-no-capture">{message.text}</span>
							</div>
						</div>
					)
				case "text": {
					return (
						<WithCopyButton
							onMouseUp={handleMouseUp}
							position="bottom-right"
							ref={contentRef}
							textToCopy={message.text}>
							<div className="flex items-center">
								<div className={cn("flex-1 min-w-0 pl-1")}>
									<MarkdownRow markdown={message.text} showCursor={false} />
								</div>
							</div>
							{quoteButtonState.visible && (
								<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
							)}
						</WithCopyButton>
					)
				}
				case "reasoning": {
					const isReasoningStreaming = message.partial === true
					const hasReasoningText = !!message.text?.trim()
					return (
						<ThinkingRow
							isExpanded={(isReasoningStreaming && hasReasoningText) || isExpanded}
							isStreaming={isReasoningStreaming}
							isVisible={true}
							onToggle={isReasoningStreaming ? undefined : handleToggle}
							reasoningContent={message.text}
							showChevron={!isReasoningStreaming || hasReasoningText}
							showTitle={true}
							title={isReasoningStreaming ? "Thinking..." : "Thinking"}
						/>
					)
				}
				case "user_feedback":
					return (
						<UserMessage
							files={message.files}
							images={message.images}
							messageTs={message.ts}
							sendMessageFromChatRow={sendMessageFromChatRow}
							text={message.text}
						/>
					)
				case "user_feedback_diff":
					const tool = JSON.parse(message.text || "{}") as CodemarieSayTool
					return (
						<div className="w-full -mt-2.5">
							<CodeAccordian
								diff={tool.diff!}
								isExpanded={isExpanded}
								isFeedback={true}
								onToggleExpand={handleToggle}
							/>
						</div>
					)
				case "error":
					return <ErrorRow errorType="error" message={message} />
				case "diff_error":
					return <ErrorRow errorType="diff_error" message={message} />
				case "codemarieignore_error":
					return <ErrorRow errorType="codemarieignore_error" message={message} />
				case "checkpoint_created":
					return <CheckmarkControl isCheckpointCheckedOut={message.isCheckpointCheckedOut} messageTs={message.ts} />
				case "load_mcp_documentation":
					return (
						<div className="text-foreground flex items-center opacity-70 text-[12px] py-1 px-0">
							<i className="codicon codicon-book mr-1.5" />
							Loading MCP documentation
						</div>
					)
				case "generate_explanation": {
					let explanationInfo: CodemarieSayGenerateExplanation = {
						title: "code changes",
						fromRef: "",
						toRef: "",
						status: "generating",
					}
					try {
						if (message.text) {
							explanationInfo = JSON.parse(message.text)
						}
					} catch {
						// Use defaults if parsing fails
					}
					const wasCancelled =
						explanationInfo.status === "generating" &&
						(!isLast ||
							lastModifiedMessage?.ask === "resume_task" ||
							lastModifiedMessage?.ask === "resume_completed_task")
					const isGenerating = explanationInfo.status === "generating" && !wasCancelled
					const isError = explanationInfo.status === "error"
					return (
						<div className="bg-code flex flex-col border border-editor-group-border rounded-sm py-2.5 px-3">
							<div className="flex items-center">
								{isGenerating ? (
									<ProgressIndicator />
								) : isError ? (
									<CircleXIcon className="size-2 mr-2 text-error" />
								) : wasCancelled ? (
									<CircleSlashIcon className="size-2 mr-2" />
								) : (
									<CheckIcon className="size-2 mr-2 text-success" />
								)}
								<span className="font-semibold">
									{isGenerating
										? "Generating explanation"
										: isError
											? "Failed to generate explanation"
											: wasCancelled
												? "Explanation cancelled"
												: "Generated explanation"}
								</span>
							</div>
							{isError && explanationInfo.error && (
								<div className="opacity-80 ml-6 mt-1.5 text-error break-words">{explanationInfo.error}</div>
							)}
							{!isError && (explanationInfo.title || explanationInfo.fromRef) && (
								<div className="opacity-80 ml-6 mt-1.5">
									<div>{explanationInfo.title}</div>
									{explanationInfo.fromRef && (
										<div className="opacity-70 mt-1.5 break-all text-xs">
											<code className="bg-quote rounded-sm py-0.5 pr-1.5">{explanationInfo.fromRef}</code>
											<ArrowRightIcon className="inline size-2 mx-1" />
											<code className="bg-quote rounded-sm py-0.5 px-1.5">
												{explanationInfo.toRef || "working directory"}
											</code>
										</div>
									)}
								</div>
							)}
						</div>
					)
				}
				case "completion_result":
					const hasChanges = message.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG) ?? false
					const text = hasChanges ? message.text?.slice(0, -COMPLETION_RESULT_CHANGES_FLAG.length) : message.text

					return (
						<CompletionOutputRow
							explainChangesDisabled={explainChangesDisabled}
							handleQuoteClick={handleQuoteClick}
							headClassNames={HEADER_CLASSNAMES}
							messageTs={message.ts}
							quoteButtonState={quoteButtonState}
							seeNewChangesDisabled={seeNewChangesDisabled}
							setExplainChangesDisabled={setExplainChangesDisabled}
							setSeeNewChangesDisabled={setSeeNewChangesDisabled}
							showActionRow={message.partial !== true && hasChanges}
							text={text || ""}
						/>
					)
				case "shell_integration_warning":
					return (
						<div className="flex flex-col bg-warning/20 p-2 rounded-xs border border-error">
							<div className="flex items-center mb-1">
								<TriangleAlertIcon className="mr-2 size-2 stroke-3 text-error" />
								<span className="font-medium text-foreground">Shell Integration Unavailable</span>
							</div>
							<div className="text-foreground opacity-80">
								Codemarie may have trouble viewing the command's output. Please update VSCode (
								<code>CMD/CTRL + Shift + P</code> → "Update") and make sure you're using a supported shell: zsh,
								bash, fish, or PowerShell (<code>CMD/CTRL + Shift + P</code> → "Terminal: Select Default
								Profile").
								<a
									className="px-1"
									href="https://github.com/codemarie/codemarie/wiki/Troubleshooting-%E2%80%90-Shell-Integration-Unavailable">
									Still having trouble?
								</a>
							</div>
						</div>
					)
				case "error_retry":
					try {
						const retryInfo = JSON.parse(message.text || "{}")
						const { attempt, maxAttempts, delaySeconds, failed, errorMessage } = retryInfo
						const isFailed = failed === true

						return (
							<div className="flex flex-col gap-2">
								{errorMessage && (
									<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere text-xs">{errorMessage}</p>
								)}
								<div className="flex flex-col bg-quote p-0 rounded-[3px] text-[12px]">
									<div className="flex items-center mb-1">
										{isFailed && !isRequestInProgress ? (
											<TriangleAlertIcon className="mr-2 size-2" />
										) : (
											<RefreshCwIcon className="mr-2 size-2 animate-spin" />
										)}
										<span className="font-medium text-foreground">
											{isFailed ? "Auto-Retry Failed" : "Auto-Retry in Progress"}
										</span>
									</div>
									<div className="text-foreground opacity-80">
										{isFailed ? (
											<span>
												Auto-retry failed after <strong>{maxAttempts}</strong> attempts. Manual
												intervention required.
											</span>
										) : (
											<span>
												Attempt <strong>{attempt}</strong> of <strong>{maxAttempts}</strong> - Retrying in{" "}
												{delaySeconds} seconds...
											</span>
										)}
									</div>
								</div>
							</div>
						)
					} catch (_e) {
						return (
							<div className="text-foreground">
								<MarkdownRow markdown={message.text} />
							</div>
						)
					}
				case "hook_status":
					return <HookMessage CommandOutput={CommandOutputContent} message={message} />
				case "hook_output_stream":
					return <InvisibleSpacer />
				case "subagent":
					return <SubagentStatusRow isLast={isLast} lastModifiedMessage={lastModifiedMessage} message={message} />
				case "shell_integration_warning_with_suggestion":
					const isBackgroundModeEnabled = vscodeTerminalExecutionMode === "backgroundExec"
					return (
						<div className="p-2 bg-link/10 border border-link/30 rounded-xs">
							<div className="flex items-center mb-1">
								<LightbulbIcon className="mr-1.5 size-2 text-link" />
								<span className="font-medium text-foreground">Shell integration issues</span>
							</div>
							<div className="text-foreground opacity-90 mb-2">
								Since you're experiencing repeated shell integration issues, we recommend switching to Background
								Terminal mode for better reliability.
							</div>
							<button
								className={cn(
									"bg-button-background text-button-foreground border-0 rounded-xs py-1.5 px-3 text-[12px] flex items-center gap-1.5 cursor-pointer hover:bg-button-hover",
									{
										"cursor-default opacity-80 bg-success": isBackgroundModeEnabled,
									},
								)}
								disabled={isBackgroundModeEnabled}
								onClick={async () => {
									try {
										await UiServiceClient.setTerminalExecutionMode(BooleanRequest.create({ value: true }))
									} catch (error) {
										console.error("Failed to enable background terminal:", error)
									}
								}}
								type="button">
								<SettingsIcon className="size-2" />
								{isBackgroundModeEnabled
									? "Background Terminal Enabled"
									: "Enable Background Terminal (Recommended)"}
							</button>
						</div>
					)
				case "task_progress":
					return <InvisibleSpacer />
				default:
					return (
						<div>
							{title && (
								<div className={HEADER_CLASSNAMES}>
									{icon}
									{title}
								</div>
							)}
							<div className="pt-1">
								<MarkdownRow markdown={message.text} />
							</div>
						</div>
					)
			}
		case "ask":
			switch (message.ask) {
				case "mistake_limit_reached":
					return <ErrorRow errorType="mistake_limit_reached" message={message} />
				case "completion_result":
					if (message.text) {
						const hasChanges = message.text.endsWith(COMPLETION_RESULT_CHANGES_FLAG) ?? false
						const text = hasChanges ? message.text.slice(0, -COMPLETION_RESULT_CHANGES_FLAG.length) : message.text
						return (
							<CompletionOutputRow
								explainChangesDisabled={explainChangesDisabled}
								handleQuoteClick={handleQuoteClick}
								headClassNames={HEADER_CLASSNAMES}
								messageTs={message.ts}
								quoteButtonState={quoteButtonState}
								seeNewChangesDisabled={seeNewChangesDisabled}
								setExplainChangesDisabled={setExplainChangesDisabled}
								setSeeNewChangesDisabled={setSeeNewChangesDisabled}
								showActionRow={message.partial !== true && hasChanges}
								text={text || ""}
							/>
						)
					}
					return <InvisibleSpacer />
				case "followup":
					let question: string | undefined
					let options: string[] | undefined
					let selected: string | undefined
					let actions: CodemarieAskQuestion["actions"] | undefined
					let confidenceScore: number | undefined
					let ambiguityReasoning: string | undefined
					let verifiedEntities: string[] | undefined
					let risks: CodemarieAskQuestion["risks"] | undefined
					let intentDecomposition: CodemarieAskQuestion["intentDecomposition"] | undefined
					let constraints: string[] | undefined
					let constraintExplanations: Record<string, string> | undefined
					let architecturalLayers: CodemarieAskQuestion["architecturalLayers"] | undefined
					let policyCompliance: CodemarieAskQuestion["policyCompliance"] | undefined
					let outcomeMapping: CodemarieAskQuestion["outcomeMapping"] | undefined
					let adversarialCritique: CodemarieAskQuestion["adversarialCritique"] | undefined
					let interactiveClarifications: CodemarieAskQuestion["interactiveClarifications"] | undefined
					let swarmConsensus: CodemarieAskQuestion["swarmConsensus"] | undefined
					try {
						const parsedMessage = JSON.parse(message.text || "{}") as CodemarieAskQuestion
						question = parsedMessage.question
						options = parsedMessage.options
						selected = parsedMessage.selected
						actions = parsedMessage.actions
						confidenceScore = parsedMessage.confidenceScore
						ambiguityReasoning = parsedMessage.ambiguityReasoning
						verifiedEntities = parsedMessage.verifiedEntities
						risks = parsedMessage.risks
						intentDecomposition = parsedMessage.intentDecomposition
						constraints = parsedMessage.constraints
						constraintExplanations = parsedMessage.constraintExplanations
						architecturalLayers = parsedMessage.architecturalLayers
						policyCompliance = parsedMessage.policyCompliance
						outcomeMapping = parsedMessage.outcomeMapping
						adversarialCritique = parsedMessage.adversarialCritique
						interactiveClarifications = parsedMessage.interactiveClarifications
						swarmConsensus = parsedMessage.swarmConsensus
					} catch (_e) {
						question = message.text
					}

					return (
						<div>
							{title && (
								<div className={HEADER_CLASSNAMES}>
									{icon}
									{title}
								</div>
							)}
							<WithCopyButton
								className="pt-1"
								onMouseUp={handleMouseUp}
								position="bottom-right"
								ref={contentRef}
								textToCopy={question}>
								<MarkdownRow markdown={question} />
								{quoteButtonState.visible && (
									<QuoteButton
										left={quoteButtonState.left}
										onClick={handleQuoteClick}
										top={quoteButtonState.top}
									/>
								)}
							</WithCopyButton>
							{confidenceScore !== undefined && (
								<GroundingHeader
									ambiguityReasoning={ambiguityReasoning}
									confidenceScore={confidenceScore}
									constraintExplanations={constraintExplanations}
									constraints={constraints}
									hasActions={!!actions?.length}
									risks={risks}
									verifiedEntities={verifiedEntities}
								/>
							)}
							{intentDecomposition && <IntentDecomposition phases={intentDecomposition} />}
							{(policyCompliance || architecturalLayers) && (
								<AlignmentGuard architecturalLayers={architecturalLayers} policyCompliance={policyCompliance} />
							)}
							{outcomeMapping && <OutcomeMapper outcomeMapping={outcomeMapping} />}
							{adversarialCritique && <RedTeamAlerts adversarialCritique={adversarialCritique} />}
							{(interactiveClarifications || swarmConsensus) && (
								<ClarificationHub
									interactiveClarifications={interactiveClarifications}
									swarmConsensus={swarmConsensus}
								/>
							)}
							{actions && actions.length > 0 && (
								<ActionCheckboxes
									actions={actions.map((a) => ({
										...a,
										isChecked: selectedActions.includes(a.id),
									}))}
									onActionsChange={(updated) =>
										setSelectedActions(updated.filter((a) => a.isChecked).map((a) => a.id))
									}
								/>
							)}
							<div className="pt-3">
								<OptionsButtons
									inputValue={inputValue}
									isActive={
										(isLast && lastModifiedMessage?.ask === "followup") ||
										(!selected && options && options.length > 0)
									}
									options={options}
									selected={selected}
									selectedActions={selectedActions}
								/>
							</div>
						</div>
					)
				case "new_task":
					return (
						<div>
							<div className={HEADER_CLASSNAMES}>
								<FilePlus2Icon className="size-2" />
								<span className="text-foreground font-bold">Codemarie wants to start a new task:</span>
							</div>
							<NewTaskPreview context={message.text || ""} />
						</div>
					)
				case "condense":
					return (
						<div>
							<div className={HEADER_CLASSNAMES}>
								<FilePlus2Icon className="size-2" />
								<span className="text-foreground font-bold">Codemarie wants to condense your conversation:</span>
							</div>
							<NewTaskPreview context={message.text || ""} />
						</div>
					)
				case "report_bug":
					return (
						<div>
							<div className={HEADER_CLASSNAMES}>
								<FilePlus2Icon className="size-2" />
								<span className="text-foreground font-bold">Codemarie wants to create a Github issue:</span>
							</div>
							<ReportBugPreview data={message.text || ""} />
						</div>
					)
				case "wave_approval":
					return <WaveApprovalRow isLast={isLast} metadata={JSON.parse(message.text || "{}")} />
				case "orchestration_event":
					return <OrchestrationEventRow metadata={JSON.parse(message.text || "{}")} />
				case "plan_mode_respond": {
					let response: string | undefined
					let options: string[] | undefined
					let selected: string | undefined
					try {
						const parsedMessage = JSON.parse(message.text || "{}") as CodemariePlanModeResponse
						response = parsedMessage.response
						options = parsedMessage.options
						selected = parsedMessage.selected
					} catch (_e) {
						response = message.text
					}
					return (
						<div>
							<PlanCompletionOutputRow headClassNames={HEADER_CLASSNAMES} text={response || message.text || ""} />
							<OptionsButtons
								inputValue={inputValue}
								isActive={
									(isLast && lastModifiedMessage?.ask === "plan_mode_respond") ||
									(!selected && options && options.length > 0)
								}
								options={options}
								selected={selected}
							/>
						</div>
					)
				}
				default:
					return <InvisibleSpacer />
			}
	}
}

export default MessageRowDispatcher
