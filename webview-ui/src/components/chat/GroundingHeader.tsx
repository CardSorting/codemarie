import styled from "styled-components"
import { Badge } from "@/components/ui/badge"

const HeaderContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-editorGroup-border);
  border-radius: 6px;
  margin-bottom: 12px;
`

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const Title = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--vscode-foreground);
`

const Reasoning = styled.p`
  margin: 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.4;
`

const AlertBox = styled.div<{ type: "warning" | "info" }>`
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
  background: ${(props) => (props.type === "warning" ? "var(--vscode-inputValidation-warningBackground)" : "var(--vscode-infoAdapter-background)")};
  border: 1px solid ${(props) => (props.type === "warning" ? "var(--vscode-inputValidation-warningBorder)" : "var(--vscode-infoAdapter-border)")};
  color: var(--vscode-foreground);
  display: flex;
  align-items: center;
  gap: 8px;
`

interface GroundingHeaderProps {
	confidenceScore: number
	ambiguityReasoning?: string
	hasActions: boolean
}

export const GroundingHeader = ({ confidenceScore, ambiguityReasoning, hasActions }: GroundingHeaderProps) => {
	const percentage = Math.round(confidenceScore * 100)

	const getConfidenceVariant = (score: number) => {
		if (score >= 0.8) return "success"
		if (score >= 0.5) return "warning"
		return "danger"
	}

	return (
		<HeaderContainer>
			<TitleRow>
				<Title>Task Grounding</Title>
				<Badge variant={getConfidenceVariant(confidenceScore)}>{percentage}% Confidence</Badge>
			</TitleRow>

			{ambiguityReasoning && <Reasoning>{ambiguityReasoning}</Reasoning>}

			{confidenceScore < 0.7 && (
				<AlertBox type="warning">
					<span className="codicon codicon-warning" />
					<span>Confidence is low. Please review the proposed actions and provide clarification if needed.</span>
				</AlertBox>
			)}

			{hasActions && confidenceScore >= 0.7 && (
				<AlertBox type="info">
					<span className="codicon codicon-info" />
					<span>I've structured a plan based on your request. Please confirm the steps below to proceed.</span>
				</AlertBox>
			)}
		</HeaderContainer>
	)
}
