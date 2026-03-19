import { OrchestrationEventMetadata } from "@shared/ExtensionMessage"
import { CheckCircle2Icon, CircleAlertIcon, InfoIcon, PlayCircleIcon, Tally4Icon, ZapIcon } from "lucide-react"
import { memo } from "react"

interface OrchestrationEventRowProps {
	metadata: OrchestrationEventMetadata
}

const OrchestrationEventRow = memo(({ metadata }: OrchestrationEventRowProps) => {
	const getIcon = () => {
		switch (metadata.type) {
			case "wave_start":
				return <ZapIcon className="size-3 text-warning" />
			case "wave_complete":
				return <CheckCircle2Icon className="size-3 text-success" />
			case "worker_start":
				return <PlayCircleIcon className="size-3 text-link" />
			case "worker_complete":
				return <Tally4Icon className="size-3 text-success/80" />
			case "error":
				return <CircleAlertIcon className="size-3 text-error" />
			case "warning":
				return <CircleAlertIcon className="size-3 text-warning" />
			case "success":
				return <CheckCircle2Icon className="size-3 text-success" />
			default:
				return <InfoIcon className="size-3 text-foreground/50" />
		}
	}

	const getLabel = () => {
		if (metadata.workerName) return metadata.workerName
		return metadata.event
	}

	return (
		<div className="flex items-center gap-2 py-1 px-2 mb-1 rounded-xs bg-secondary/5 border border-editor-group-border/30 max-w-fit animate-in fade-in slide-in-from-left-2 duration-300">
			<div className="shrink-0">{getIcon()}</div>
			<div className="flex items-baseline gap-2 min-w-0">
				<span className="text-[10px] font-bold opacity-70 uppercase tracking-tight whitespace-nowrap">
					{metadata.type.replace("_", " ")}
				</span>
				<span className="text-[11px] font-medium truncate max-w-[200px]">{getLabel()}</span>
				{metadata.details && metadata.type !== "worker_start" && (
					<span className="text-[10px] opacity-50 truncate max-w-[300px] italic">{metadata.details}</span>
				)}
			</div>
			<div className="text-[9px] opacity-30 ml-auto whitespace-nowrap">
				{new Date(metadata.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
			</div>
		</div>
	)
})

OrchestrationEventRow.displayName = "OrchestrationEventRow"

export default OrchestrationEventRow
