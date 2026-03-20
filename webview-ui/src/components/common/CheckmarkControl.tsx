import { flip, offset, shift, useFloating } from "@floating-ui/react"
import { CheckpointRestoreRequest } from "@shared/proto/codemarie/checkpoints"
import { Int64Request } from "@shared/proto/codemarie/common"
import { CodemarieCheckpointRestore } from "@shared/WebviewMessage"
import { BookmarkIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { Button } from "@/components/ui/button"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { CheckpointsServiceClient } from "@/services/protobus-client"

interface CheckmarkControlProps {
	messageTs?: number
	isCheckpointCheckedOut?: boolean
}

export const CheckmarkControl = ({ messageTs, isCheckpointCheckedOut }: CheckmarkControlProps) => {
	const [compareDisabled, setCompareDisabled] = useState(false)
	const [restoreTaskDisabled, setRestoreTaskDisabled] = useState(false)
	const [restoreWorkspaceDisabled, setRestoreWorkspaceDisabled] = useState(false)
	const [restoreBothDisabled, setRestoreBothDisabled] = useState(false)
	const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
	const [showMoreOptions, setShowMoreOptions] = useState(false)
	const { onRelinquishControl } = useExtensionState()

	// Debounce
	const closeMenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const scheduleCloseRestore = useCallback(() => {
		if (closeMenuTimeoutRef.current) {
			clearTimeout(closeMenuTimeoutRef.current)
		}
		closeMenuTimeoutRef.current = setTimeout(() => {
			setShowRestoreConfirm(false)
		}, 350)
	}, [])

	const cancelCloseRestore = useCallback(() => {
		if (closeMenuTimeoutRef.current) {
			clearTimeout(closeMenuTimeoutRef.current)
			closeMenuTimeoutRef.current = null
		}
	}, [])

	// Debounce cleanup
	useEffect(() => {
		return () => {
			if (closeMenuTimeoutRef.current) {
				clearTimeout(closeMenuTimeoutRef.current)
				closeMenuTimeoutRef.current = null
			}
		}
	}, [])

	// Clear "Restore Files" button when checkpoint is no longer checked out
	useEffect(() => {
		if (!isCheckpointCheckedOut && restoreWorkspaceDisabled) {
			setRestoreWorkspaceDisabled(false)
		}
	}, [isCheckpointCheckedOut, restoreWorkspaceDisabled])

	const { refs, floatingStyles, update, placement } = useFloating({
		placement: "bottom-end",
		middleware: [
			offset({
				mainAxis: 8,
				crossAxis: 10,
			}),
			flip(),
			shift(),
		],
	})

	useEffect(() => {
		const handleScroll = () => {
			update()
		}
		window.addEventListener("scroll", handleScroll, true)
		return () => window.removeEventListener("scroll", handleScroll, true)
	}, [update])

	useEffect(() => {
		if (showRestoreConfirm) {
			update()
		}
	}, [showRestoreConfirm, update])

	// Use the onRelinquishControl hook instead of message event
	useEffect(() => {
		return onRelinquishControl(() => {
			setCompareDisabled(false)
			setRestoreTaskDisabled(false)
			setRestoreWorkspaceDisabled(false)
			setRestoreBothDisabled(false)
			setShowRestoreConfirm(false)
			setShowMoreOptions(false)
		})
	}, [onRelinquishControl])

	const handleRestoreTask = async () => {
		setRestoreTaskDisabled(true)
		try {
			const restoreType: CodemarieCheckpointRestore = "task"
			await CheckpointsServiceClient.checkpointRestore(
				CheckpointRestoreRequest.create({
					number: messageTs,
					restoreType,
				}),
			)
		} catch (err) {
			console.error("Checkpoint restore task error:", err)
		} finally {
			setRestoreTaskDisabled(false)
		}
	}

	const handleRestoreWorkspace = async () => {
		setRestoreWorkspaceDisabled(true)
		try {
			const restoreType: CodemarieCheckpointRestore = "workspace"
			await CheckpointsServiceClient.checkpointRestore(
				CheckpointRestoreRequest.create({
					number: messageTs,
					restoreType,
				}),
			)
		} catch (err) {
			console.error("Checkpoint restore workspace error:", err)
		} finally {
			setRestoreWorkspaceDisabled(false)
		}
	}

	const handleRestoreBoth = async () => {
		setRestoreBothDisabled(true)
		try {
			const restoreType: CodemarieCheckpointRestore = "taskAndWorkspace"
			await CheckpointsServiceClient.checkpointRestore(
				CheckpointRestoreRequest.create({
					number: messageTs,
					restoreType,
				}),
			)
		} catch (err) {
			console.error("Checkpoint restore both error:", err)
		} finally {
			setRestoreBothDisabled(false)
		}
	}

	const handleMouseEnter = () => {
		cancelCloseRestore()
	}

	const handleMouseLeave = () => {
		scheduleCloseRestore()
	}

	const handleControlsMouseEnter = () => {
		cancelCloseRestore()
	}

	const handleControlsMouseLeave = () => {
		scheduleCloseRestore()
	}

	const dottedLineGradient = isCheckpointCheckedOut
		? "linear-gradient(to right, var(--vscode-textLink-foreground) 50%, transparent 50%)"
		: "linear-gradient(to right, var(--vscode-descriptionForeground) 50%, transparent 50%)"

	return (
		<div
			className={cn(
				"flex items-center pt-2 px-0 gap-1 relative min-w-0 min-h-[17px] -mt-[2px] mb-[1px] h-2 first:pt-0 hover:opacity-100 group",
				isCheckpointCheckedOut || showRestoreConfirm ? "opacity-100" : "opacity-50",
			)}
			onMouseEnter={handleControlsMouseEnter}
			onMouseLeave={handleControlsMouseLeave}>
			<BookmarkIcon
				className={cn("text-xs text-description shrink-0 size-2", {
					"text-link": isCheckpointCheckedOut,
				})}
			/>
			<div
				className={cn("flex-1 min-w-[5px] h-px bg-repeat-x group-hover:hidden", {
					hidden: showRestoreConfirm,
				})}
				style={{
					backgroundImage: dottedLineGradient,
					backgroundSize: "4px 1px",
				}}
			/>
			<div className={cn("hidden items-center gap-1 flex-1 group-hover:flex", { flex: showRestoreConfirm })}>
				<span
					className={cn("text-[9px] text-description shrink-0", {
						"text-link": isCheckpointCheckedOut,
					})}>
					{isCheckpointCheckedOut ? "Checkpoint (restored)" : "Checkpoint"}
				</span>
				<div
					className="flex-1 min-w-[5px] h-px bg-repeat-x"
					style={{
						backgroundImage: dottedLineGradient,
						backgroundSize: "4px 1px",
					}}
				/>
				<div className="flex items-center gap-1 shrink-0">
					<button
						className={cn(
							"border-none px-1.5 py-0.5 text-[9px] cursor-pointer relative rounded-sm transition-colors",
							compareDisabled
								? "bg-(--vscode-descriptionForeground) text-(--vscode-editor-background) cursor-wait"
								: "bg-transparent text-(--vscode-descriptionForeground) hover:bg-(--vscode-descriptionForeground) hover:text-(--vscode-editor-background)",
							{
								"text-(--vscode-textLink-foreground) hover:bg-(--vscode-textLink-foreground)":
									isCheckpointCheckedOut,
							},
						)}
						disabled={compareDisabled}
						onClick={async () => {
							setCompareDisabled(true)
							try {
								await CheckpointsServiceClient.checkpointDiff(
									Int64Request.create({
										value: messageTs,
									}),
								)
							} catch (err) {
								console.error("CheckpointDiff error:", err)
							} finally {
								setCompareDisabled(false)
							}
						}}>
						Compare
					</button>
					<div
						className="flex-none w-[5px] h-px bg-repeat-x"
						style={{
							backgroundImage: dottedLineGradient,
							backgroundSize: "4px 1px",
						}}
					/>
					<div ref={refs.setReference} style={{ position: "relative", marginTop: -2 }}>
						<button
							className={cn(
								"border-none px-1.5 py-0.5 text-[9px] cursor-pointer relative rounded-sm transition-colors",
								showRestoreConfirm
									? isCheckpointCheckedOut
										? "bg-(--vscode-textLink-foreground) text-(--vscode-editor-background)"
										: "bg-(--vscode-descriptionForeground) text-(--vscode-editor-background)"
									: "bg-transparent text-(--vscode-descriptionForeground) hover:bg-(--vscode-descriptionForeground) hover:text-(--vscode-editor-background)",
								{
									"text-(--vscode-textLink-foreground) hover:bg-(--vscode-textLink-foreground)":
										isCheckpointCheckedOut,
								},
							)}
							onClick={() => setShowRestoreConfirm(true)}>
							Restore
						</button>
						{showRestoreConfirm &&
							createPortal(
								<div
									className="fixed border border-(--vscode-editorGroup-border) p-3.5 rounded-md z-[1000] shadow-lg w-[min(calc(100vw-54px),200px)] before:content-[''] before:absolute before:-top-2 before:left-0 before:right-0 before:h-2 after:content-[''] after:absolute after:-top-1.5 after:right-6 after:w-2.5 after:after:h-2.5 after:border-l after:border-t after:border-(--vscode-editorGroup-border) after:rotate-45 after:z-[1]"
									data-placement={placement}
									onMouseEnter={handleMouseEnter}
									onMouseLeave={handleMouseLeave}
									ref={refs.setFloating}
									style={{
										...floatingStyles,
										backgroundColor: CODE_BLOCK_BG_COLOR,
									}}>
									<div className="mb-3">
										<Button
											className={cn("w-full justify-start gap-1.5", { "cursor-wait": restoreBothDisabled })}
											disabled={restoreBothDisabled}
											onClick={handleRestoreBoth}>
											<i className="codicon codicon-debug-restart" />
											Restore Files & Task
										</Button>
										<p className="mt-2 mb-0 text-(--vscode-descriptionForeground) text-[11px] leading-3.5 whitespace-normal break-words">
											Revert files and clear messages after this point
										</p>
									</div>

									<button
										className="w-full py-0.5 bg-transparent text-(--vscode-textLink-foreground) border-none text-[11px] cursor-pointer flex items-center justify-start transition-opacity duration-100 opacity-80 mb-[-4px] hover:opacity-100"
										onClick={() => setShowMoreOptions(!showMoreOptions)}>
										More options
										<i
											className={cn("ml-1 text-[10px] codicon", {
												"codicon-chevron-up": showMoreOptions,
												"codicon-chevron-down": !showMoreOptions,
											})}
										/>
									</button>

									{showMoreOptions && (
										<div className="pt-2 mt-1.5 border-t border-(--vscode-editorGroup-border) animate-in fade-in slide-in-from-top-1 duration-150">
											<div className="mb-3 last:mb-0">
												<Button
													className={cn("w-full justify-start gap-1.5", {
														"cursor-wait": restoreWorkspaceDisabled,
														"cursor-not-allowed": isCheckpointCheckedOut,
													})}
													disabled={restoreWorkspaceDisabled || isCheckpointCheckedOut}
													onClick={handleRestoreWorkspace}
													variant="secondary">
													<i className="codicon codicon-file-symlink-directory" />
													Restore Files Only
												</Button>
												<p className="mt-2 mb-0 text-(--vscode-descriptionForeground) text-[11px] leading-3.5 whitespace-normal break-words">
													Revert files to this checkpoint
												</p>
											</div>
											<div className="mb-3 last:mb-0">
												<Button
													className={cn("w-full justify-start gap-1.5", {
														"cursor-wait": restoreTaskDisabled,
													})}
													disabled={restoreTaskDisabled}
													onClick={handleRestoreTask}
													variant="secondary">
													<i className="codicon codicon-comment-discussion" />
													Restore Task Only
												</Button>
												<p className="mt-2 mb-0 text-(--vscode-descriptionForeground) text-[11px] leading-3.5 whitespace-normal break-words">
													Clear messages after this point
												</p>
											</div>
										</div>
									)}
								</div>,
								document.body,
							)}
					</div>
					<div
						className="flex-none w-[5px] h-px bg-repeat-x"
						style={{
							backgroundImage: dottedLineGradient,
							backgroundSize: "4px 1px",
						}}
					/>
				</div>
			</div>
		</div>
	)
}
