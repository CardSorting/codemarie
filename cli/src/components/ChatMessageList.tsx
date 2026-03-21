import type { CodemarieMessage } from "@shared/ExtensionMessage"
import { Box, Static } from "ink"
import React from "react"
import { ChatMessage } from "./ChatMessage"

interface ChatMessageListProps {
	messages: CodemarieMessage[]
}

export const ChatMessageList: React.FC<ChatMessageListProps> = ({ messages }) => {
	// Separate completed and current messages for Static optimization
	const completedMessages = messages.slice(0, -1)
	const currentMessage = messages[messages.length - 1]

	return (
		<Box flexDirection="column" width="100%">
			<Static items={completedMessages}>
				{(message, idx) => (
					<Box key={idx} width="100%">
						<ChatMessage message={message} />
					</Box>
				)}
			</Static>
			{currentMessage && (
				<Box width="100%">
					<ChatMessage isStreaming={true} message={currentMessage} />
				</Box>
			)}
		</Box>
	)
}
