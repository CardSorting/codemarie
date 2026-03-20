import { ProtobusResponse } from "@/shared/ExtensionMessage"
import { ProtobusRequest } from "@/shared/WebviewMessage"

export type ProtobusPostRecordHook = (entry: ProtobusLogEntry, controller?: any) => Promise<void> | void

export type ProtobusRequestFilter = (request: ProtobusRequest) => boolean

export interface ProtobusLogEntry {
	requestId: string
	service: string
	method: string
	isStreaming: boolean
	request: {
		message: any
	}
	response?: {
		message?: any
		error?: string
		isStreaming?: boolean
		sequenceNumber?: number
	}
	duration?: number
	status: "pending" | "completed" | "error"
	meta?: { synthetic?: boolean }
}

export interface SessionStats {
	totalRequests: number
	pendingRequests: number
	completedRequests: number
	errorRequests: number
}

export interface ProtobusSessionLog {
	startTime: string
	stats?: SessionStats
	entries: ProtobusLogEntry[]
}

export interface IProtobusRecorder {
	recordRequest(request: ProtobusRequest, synthetic?: boolean): void
	recordResponse(requestId: string, response: ProtobusResponse): void
	recordError(requestId: string, error: string): void
	getSessionLog(): ProtobusSessionLog
	cleanupSyntheticEntries(): void
}
