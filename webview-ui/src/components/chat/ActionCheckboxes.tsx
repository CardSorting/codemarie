import { useState } from "react"
import styled from "styled-components"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

const ActionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
  margin-bottom: 16px;
  padding: 16px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-editorGroup-border);
  border-radius: 6px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
`

const ActionItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px;
  border-radius: 4px;
  transition: background 0.1s ease;
  &:hover {
    background: var(--vscode-list-hoverBackground);
  }
`

const ActionDetails = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  flex: 1;
`

const ActionHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const ActionLabel = styled(Label)`
  font-weight: 600;
  cursor: pointer;
  line-height: 1.4;
  font-size: 13px;
`

const ActionRationale = styled.span`
  font-size: 11px;
  color: var(--vscode-textLink-foreground);
  font-style: italic;
  opacity: 0.9;
`

const ActionDescription = styled.span`
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.5;
`

const PriorityBadge = ({ priority }: { priority: "critical" | "recommended" | "optional" }) => {
	const variants = {
		critical: "danger",
		recommended: "default",
		optional: "outline",
	} as const
	return (
		<Badge className="text-[9px] uppercase px-1.5 py-0 h-4" variant={variants[priority]}>
			{priority}
		</Badge>
	)
}

interface Action {
	id: string
	label: string
	description?: string
	rationale?: string
	priority: "critical" | "recommended" | "optional"
	isChecked: boolean
}

interface ActionCheckboxesProps {
	actions: Action[]
	onActionsChange: (actions: Action[]) => void
}

export const ActionCheckboxes = ({ actions, onActionsChange }: ActionCheckboxesProps) => {
	const [localActions, setLocalActions] = useState<Action[]>(actions)

	const handleToggle = (id: string) => {
		const updated = localActions.map((a) => (a.id === id ? { ...a, isChecked: !a.isChecked } : a))
		setLocalActions(updated)
		onActionsChange(updated)
	}

	return (
		<ActionList>
			<div className="flex items-center justify-between mb-2">
				<div className="text-[11px] font-bold text-description uppercase tracking-wider">Proposed Actions</div>
				<div className="text-[11px] text-description italic">
					{localActions.filter((a) => a.isChecked).length} of {localActions.length} selected
				</div>
			</div>
			{localActions.map((action) => (
				<ActionItem className={cn({ "opacity-75": !action.isChecked })} key={action.id}>
					<div className="pt-0.5">
						<Switch
							checked={action.isChecked}
							id={`action-${action.id}`}
							onCheckedChange={() => handleToggle(action.id)}
						/>
					</div>
					<ActionDetails onClick={() => handleToggle(action.id)}>
						<ActionHeader>
							<ActionLabel htmlFor={`action-${action.id}`}>{action.label}</ActionLabel>
							<PriorityBadge priority={action.priority} />
						</ActionHeader>
						{action.rationale && <ActionRationale>Rationale: {action.rationale}</ActionRationale>}
						{action.description && <ActionDescription>{action.description}</ActionDescription>}
					</ActionDetails>
				</ActionItem>
			))}
		</ActionList>
	)
}
