export interface WebviewMessage {
	type: "protobus_request" | "protobus_request_cancel"
	protobus_request?: ProtobusRequest
	protobus_request_cancel?: ProtobusCancel
}

export type ProtobusRequest = {
	service: string
	method: string
	message: any // JSON serialized protobuf message
	request_id: string // For correlating requests and responses
	is_streaming: boolean // Whether this is a streaming request
}

export type ProtobusCancel = {
	request_id: string // ID of the request to cancel
}

export type CodemarieAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse"

export type CodemarieCheckpointRestore = "task" | "workspace" | "taskAndWorkspace"

export type TaskFeedbackType = "thumbs_up" | "thumbs_down"
