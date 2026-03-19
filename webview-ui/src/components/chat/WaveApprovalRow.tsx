import { WaveApprovalMetadata } from "@shared/ExtensionMessage"
import { CheckCircle2Icon, ChevronDownIcon, ChevronRightIcon, LayersIcon, XCircleIcon } from "lucide-react"
import { memo, useState } from "react"
import { cn } from "@/lib/utils"

interface WaveApprovalRowProps {
	metadata: WaveApprovalMetadata
	isLast: boolean
}

const WaveApprovalRow = memo(({ metadata, isLast }: WaveApprovalRowProps) => {
	const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({})

	const toggleTask = (taskId: string) => {
		setExpandedTasks((prev) => ({
			...prev,
			[taskId]: !prev[taskId],
		}))
	}

	return (
		<div className="flex flex-col gap-3 p-3 bg-editor-background/40 backdrop-blur-[2px] rounded-sm border border-editor-group-border shadow-[0_2px_8px_rgba(0,0,0,0.15)] animate-in fade-in zoom-in-95 duration-300">
			{/* Header */}
			<div className="flex items-center gap-2 mb-1">
				<LayersIcon className="size-4 text-link" />
				<span className="font-bold text-base">Swarm Wave: {metadata.waveId}</span>
			</div>

			<p className="text-sm opacity-80 decoration-description">
				The following tasks are planned for parallel execution in this wave. Please review the actions and approve to
				proceed.
			</p>

			{/* Task List */}
			<div className="flex flex-col gap-2.5 mt-2">
				{metadata.tasks.map((task) => {
					const isExpanded = expandedTasks[task.id]
					const hasAudit = !!task.audit
					const auditApproved = task.audit?.approved

					return (
						<div className="border border-description/20 rounded-xs overflow-hidden bg-background/40" key={task.id}>
							<div
								className="flex items-center gap-2 p-2 cursor-pointer hover:bg-secondary/20 transition-colors"
								onClick={() => toggleTask(task.id)}>
								{isExpanded ? (
									<ChevronDownIcon className="size-3.5" />
								) : (
									<ChevronRightIcon className="size-3.5" />
								)}
								<span className="font-medium text-sm flex-1 truncate">{task.description}</span>

								{hasAudit && (
									<div
										className={cn(
											"flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border",
											auditApproved
												? "bg-success/10 border-success/30 text-success"
												: "bg-error/10 border-error/30 text-error",
										)}>
										{auditApproved ? (
											<CheckCircle2Icon className="size-3" />
										) : (
											<XCircleIcon className="size-3" />
										)}
										{auditApproved ? "AUDIT PASSED" : "AUDIT FAILED"}
									</div>
								)}
							</div>

							{isExpanded && (
								<div className="p-2 pt-0 border-t border-description/10">
									<div className="mt-2 text-xs flex flex-col gap-1.5 px-1 pb-2">
										<div className="uppercase opacity-60 font-bold text-[10px] tracking-wider mb-0.5">
											Planned Actions
										</div>
										{task.plan.actions.map((action, idx) => (
											<div className="flex flex-col gap-0.5" key={idx}>
												<div className="flex items-center gap-1.5">
													<span className="capitalize font-semibold text-link">{action.type}:</span>
													<code className="text-[11px] bg-secondary/30 px-1 rounded-xs truncate">
														{action.file}
													</code>
												</div>
												<div className="text-xs opacity-70 ml-2 border-l-2 border-description/10 pl-2 py-0.5">
													{action.description}
												</div>
											</div>
										))}
									</div>

									{!task.plan.actions.length && (
										<div className="text-xs opacity-50 italic p-2 text-center">
											No structural changes planned
										</div>
									)}

									{task.audit && !task.audit.approved && (
										<div className="mt-2 bg-error/5 border border-error/20 rounded-xs p-2">
											<div className="text-[10px] font-bold text-error uppercase mb-1">
												Audit Violations
											</div>
											<ul className="list-disc list-inside text-xs text-error/90 space-y-0.5">
												{task.audit.violations.map((v, i) => (
													<li key={i}>{v}</li>
												))}
											</ul>
											{task.audit.suggestion && (
												<div className="mt-1.5 text-xs opacity-80 border-t border-error/10 pt-1.5 italic">
													Suggestion: {task.audit.suggestion}
												</div>
											)}
										</div>
									)}
								</div>
							)}
						</div>
					)
				})}
			</div>

			{/* Simple Footer Tip */}
			{isLast && (
				<div className="mt-2 pt-2 border-t border-description/10 flex justify-center">
					<div className="text-[10px] opacity-40 uppercase tracking-widest flex items-center gap-1.5">
						<div className="h-px w-8 bg-description/20" />
						Awaiting Decision
						<div className="h-px w-8 bg-description/20" />
					</div>
				</div>
			)}
		</div>
	)
})

WaveApprovalRow.displayName = "WaveApprovalRow"

export default WaveApprovalRow
