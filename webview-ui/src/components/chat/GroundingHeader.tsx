import styled from "styled-components"
import { Badge } from "@/components/ui/badge"

const HeaderContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-editorGroup-border);
  border-radius: 8px;
  margin-bottom: 16px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
`

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const Title = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--vscode-foreground);
`

const Reasoning = styled.p`
  margin: 0;
  font-size: 13px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.5;
`

const AlertBox = styled.div<{ type: "warning" | "info" | "danger" }>`
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
  background: ${(props) => {
		if (props.type === "danger") return "var(--vscode-inputValidation-errorBackground)"
		if (props.type === "warning") return "var(--vscode-inputValidation-warningBackground)"
		return "var(--vscode-infoAdapter-background)"
  }};
  border: 1px solid ${(props) => {
		if (props.type === "danger") return "var(--vscode-inputValidation-errorBorder)"
		if (props.type === "warning") return "var(--vscode-inputValidation-warningBorder)"
		return "var(--vscode-infoAdapter-border)"
  }};
  color: var(--vscode-foreground);
  display: flex;
  align-items: flex-start;
  gap: 10px;
  line-height: 1.4;
`

const MetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
`

const VerifiedBadge = styled(Badge)`
  font-size: 10px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
`

interface Risk {
	impact: "high" | "medium" | "low"
	description: string
}

interface GroundingHeaderProps {
	confidenceScore: number
	ambiguityReasoning?: string
	hasActions: boolean
	risks?: Risk[]
	verifiedEntities?: string[]
}

export const GroundingHeader = ({
	confidenceScore,
	ambiguityReasoning,
	hasActions,
	risks,
	verifiedEntities,
}: GroundingHeaderProps) => {
	const percentage = Math.round(confidenceScore * 100)

	const getConfidenceVariant = (score: number) => {
		if (score >= 0.8) return "success"
		if (score >= 0.5) return "warning"
		return "danger"
	}

	const highRisk = risks?.find((r) => r.impact === "high")

	return (
		<HeaderContainer>
			<TitleRow>
				<Title>Task Grounding</Title>
				<Badge variant={getConfidenceVariant(confidenceScore)}>{percentage}% Confidence</Badge>
			</TitleRow>

			{ambiguityReasoning && <Reasoning>{ambiguityReasoning}</Reasoning>}

			{verifiedEntities && verifiedEntities.length > 0 && (
				<MetaRow>
					<span className="text-[11px] font-bold text-description uppercase">Verified Path(s):</span>
					{verifiedEntities.slice(0, 3).map((entity) => (
						<VerifiedBadge key={entity}>{entity}</VerifiedBadge>
					))}
					{verifiedEntities.length > 3 && <VerifiedBadge>+{verifiedEntities.length - 3} more</VerifiedBadge>}
				</MetaRow>
			)}

			{highRisk && (
				<AlertBox type="danger">
					<span className="codicon codicon-error pt-0.5" />
					<div>
						<span className="font-bold">High Risk Detected:</span> {highRisk.description}
					</div>
				</AlertBox>
			)}

			{!highRisk && confidenceScore < 0.7 && (
				<AlertBox type="warning">
					<span className="codicon codicon-warning pt-0.5" />
					<span>Confidence is low. Please review the proposed actions and provide clarification if needed.</span>
				</AlertBox>
			)}

			{hasActions && confidenceScore >= 0.7 && !highRisk && (
				<AlertBox type="info">
					<span className="codicon codicon-info pt-0.5" />
					<span>I've structured a plan based on your request. Please confirm the steps below to proceed.</span>
				</AlertBox>
			)}
		</HeaderContainer>
	)
}
