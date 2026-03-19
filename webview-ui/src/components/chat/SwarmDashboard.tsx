import { SwarmState, SwarmWorker } from "@shared/ExtensionMessage"
import { ActivityIcon, Loader2Icon, ZapIcon } from "lucide-react"
import { memo } from "react"

interface SwarmDashboardProps {
	state: SwarmState
}

const SwarmWorkerRow = memo(({ worker }: { worker: SwarmWorker }) => {
	return (
		<div className="flex items-center gap-2 py-1.5 px-3 mb-1 rounded-md bg-foreground/5 border border-foreground/10 animate-in fade-in slide-in-from-right-2 duration-300">
			<div className="shrink-0">
				<Loader2Icon className="size-3.5 text-link animate-spin" />
			</div>
			<div className="flex flex-col min-w-0">
				<div className="flex items-baseline gap-2">
					<span className="text-[11px] font-bold text-foreground truncate">{worker.name}</span>
					<span className="text-[9px] font-medium opacity-50 uppercase tracking-widest leading-none">
						{worker.status}
					</span>
				</div>
				<span className="text-[10px] opacity-60 truncate italic leading-tight">{worker.description}</span>
			</div>
			{worker.progress !== undefined && (
				<div className="ml-auto flex items-center gap-2 shrink-0">
					<div className="h-1 w-12 bg-foreground/10 rounded-full overflow-hidden">
						<div
							className="h-full bg-link transition-all duration-500 ease-out"
							style={{ width: `${worker.progress}%` }}
						/>
					</div>
					<span className="text-[9px] font-mono opacity-50">{Math.round(worker.progress)}%</span>
				</div>
			)}
		</div>
	)
})

const SwarmDashboard = memo(({ state }: SwarmDashboardProps) => {
	if (!state.isExecuting && state.activeWorkers.length === 0) return null

	return (
		<div className="sticky top-2 z-10 mx-4 my-2 p-3 rounded-lg border border-editor-group-border/40 backdrop-blur-md bg-secondary/20 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-500">
			<div className="absolute inset-0 bg-gradient-to-br from-link/5 via-transparent to-warning/5 pointer-events-none" />

			<div className="relative flex flex-col gap-3">
				<div className="flex items-center justify-between gap-4">
					<div className="flex items-center gap-2">
						<div className="p-1.5 rounded-full bg-warning/20 border border-warning/30 animate-pulse">
							<ZapIcon className="size-4 text-warning fill-warning/20" />
						</div>
						<div className="flex flex-col">
							<span className="text-[10px] font-bold uppercase tracking-wider opacity-60 leading-none mb-0.5">
								Swarm Active
							</span>
							<span className="font-mono text-[11px] font-semibold text-foreground/90 leading-none">
								{state.currentWaveId || "Synchronizing Wave..."}
							</span>
						</div>
					</div>

					<div className="flex flex-col items-end shrink-0">
						<span className="text-[10px] font-bold opacity-60 uppercase mb-1">Overall Progress</span>
						<div className="flex items-center gap-2">
							<div className="flex -space-x-1.5 overflow-hidden py-0.5">
								{state.activeWorkers.slice(0, 3).map((w, i) => (
									<div
										className="size-4 rounded-full bg-editor-background ring-1 ring-editor-group-border flex items-center justify-center"
										key={w.name}
										style={{ zIndex: 3 - i }}>
										<ActivityIcon className="size-2 text-link" />
									</div>
								))}
								{state.activeWorkers.length > 3 && (
									<div className="size-4 rounded-full bg-background-tertiary ring-1 ring-editor-group-border flex items-center justify-center text-[8px] font-bold z-0">
										+{state.activeWorkers.length - 3}
									</div>
								)}
							</div>
							<span className="text-[11px] font-bold font-mono text-warning">
								{state.completedTasks}/{state.totalTasks} Done
							</span>
						</div>
					</div>
				</div>

				<div className="relative h-1.5 w-full bg-foreground/10 rounded-full overflow-hidden shrink-0">
					<div
						className="h-full bg-gradient-to-r from-warning via-link to-success shadow-[0_0_12px_rgba(var(--warning-rgb),0.5)] transition-all duration-1000 ease-in-out"
						style={{ width: `${state.overallProgress}%` }}
					/>
				</div>

				{state.activeWorkers.length > 0 && (
					<div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto no-scrollbar py-1">
						{state.activeWorkers.map((worker) => (
							<SwarmWorkerRow key={worker.name} worker={worker} />
						))}
					</div>
				)}
			</div>
		</div>
	)
})

SwarmDashboard.displayName = "SwarmDashboard"
SwarmWorkerRow.displayName = "SwarmWorkerRow"

export default SwarmDashboard
