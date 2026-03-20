import os
import re

rows = [
    "ChatRow", "UserMessage", "CompletionOutputRow", "ErrorRow", "CommandOutputRow",
    "DiffEditRow", "HookMessage", "OrchestrationEventRow", "PlanCompletionOutputRow",
    "RequestStartRow", "SearchResultsDisplay", "SubagentStatusRow", "ThinkingRow",
    "WaveApprovalRow", "OutcomeMapper", "AlignmentGuard", "ClarificationHub",
    "GroundingHeader", "IntentDecomposition", "MarkdownRow", "NewTaskPreview",
    "OptionsButtons", "QuoteButton", "RedTeamAlerts", "ReportBugPreview",
    "ActionCheckboxes", "QuotedMessagePreview", "ExpandHandle", "TypewriterText",
    "TaskFeedbackButtons", "SwarmDashboard", "ChatErrorBoundary", "colors",
    "constants", "BrowserSessionRow", "CreditLimitError", "ErrorBlockTitle"
]

layout = [
    "ChatTextArea", "ContextMenu", "ServersToggleModal", "SlashCommandMenu"
]

chat_view = ["ChatView"]

def update_imports(file_path):
    with open(file_path, 'r') as f:
        content = f.read()

    new_content = content

    # Update Rows
    for component in rows:
        # Match "@/components/chat/ComponentName"
        pattern = r'("@/components/chat/' + component + r'")'
        replacement = r'"@/components/chat/chat-view/components/messages/rows/' + component + r'"'
        new_content = re.sub(pattern, replacement, new_content)
        
        pattern = r"('@/components/chat/" + component + r"')"
        replacement = r"'@/components/chat/chat-view/components/messages/rows/" + component + r"'"
        new_content = re.sub(pattern, replacement, new_content)

    # Update Layout
    for component in layout:
        pattern = r'("@/components/chat/' + component + r'")'
        replacement = r'"@/components/chat/chat-view/components/layout/' + component + r'"'
        new_content = re.sub(pattern, replacement, new_content)

        pattern = r"('@/components/chat/" + component + r"')"
        replacement = r"'@/components/chat/chat-view/components/layout/" + component + r"'"
        new_content = re.sub(pattern, replacement, new_content)

    # Update ChatView
    for component in chat_view:
        pattern = r'("@/components/chat/' + component + r'")'
        replacement = r'"@/components/chat/chat-view/' + component + r'"'
        new_content = re.sub(pattern, replacement, new_content)

        pattern = r"('@/components/chat/" + component + r"')"
        replacement = r"'@/components/chat/chat-view/" + component + r"'"
        new_content = re.sub(pattern, replacement, new_content)

    if new_content != content:
        with open(file_path, 'w') as f:
            f.write(new_content)
        print(f"Updated {file_path}")

def main():
    src_dir = "webview-ui/src"
    for root, dirs, files in os.walk(src_dir):
        for file in files:
            if file.endswith(('.ts', '.tsx')):
                update_imports(os.path.join(root, file))

if __name__ == "__main__":
    main()
