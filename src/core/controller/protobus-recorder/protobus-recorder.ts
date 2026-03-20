import { ProtobusResponse } from "@shared/ExtensionMessage"
import { ProtobusRequest } from "@shared/WebviewMessage"
import { ILogFileHandler } from "@/core/controller/protobus-recorder/log-file-handler"
import { ProtobusRecorderBuilder } from "@/core/controller/protobus-recorder/protobus-recorder.builder"
import {
	IProtobusRecorder,
	ProtobusLogEntry,
	ProtobusPostRecordHook,
	ProtobusRequestFilter,
	ProtobusSessionLog,
	SessionStats,
} from "@/core/controller/protobus-recorder/types"
import { Logger } from "@/shared/services/Logger"

export class ProtobusRecorderNoops implements IProtobusRecorder {
	recordRequest(_request: ProtobusRequest): void {}
	recordResponse(_requestId: string, _response: ProtobusResponse): void {}
	recordError(_requestId: string, _error: string): void {}
	getSessionLog(): ProtobusSessionLog {
		return {
			startTime: "",
			entries: [],
		}
	}
	cleanupSyntheticEntries(): void {}
}

// Interface moved to types.ts

/**
 * Default implementation of a Protobus recorder.
 */
export class ProtobusRecorder implements IProtobusRecorder {
	private sessionLog: ProtobusSessionLog
	private pendingRequests: Map<string, { entry: ProtobusLogEntry; startTime: number }> = new Map()

	constructor(
		private fileHandler: ILogFileHandler,
		private requestFilters: ProtobusRequestFilter[] = [],
		private postRecordHooks: ProtobusPostRecordHook[] = [],
	) {
		this.sessionLog = {
			startTime: new Date().toISOString(),
			entries: [],
		}

		this.fileHandler.initialize(this.sessionLog).catch((error) => {
			Logger.error("Failed to initialize Protobus log file:", error)
		})
	}

	public static builder(): ProtobusRecorderBuilder {
		return new ProtobusRecorderBuilder()
	}

	/**
	 * Records a Protobus request.
	 */
	public recordRequest(request: ProtobusRequest, synthetic = false): void {
		if (this.shouldFilter(request)) {
			return
		}

		const entry: ProtobusLogEntry = {
			requestId: request.request_id,
			service: request.service,
			method: request.method,
			isStreaming: request.is_streaming || false,
			request: {
				message: request.message,
			},
			status: "pending",
			meta: { synthetic },
		}

		this.pendingRequests.set(request.request_id, {
			entry,
			startTime: Date.now(),
		})

		this.sessionLog.entries.push(entry)
		this.flushLogAsync()
	}

	public getSessionLog(): ProtobusSessionLog {
		return this.sessionLog
	}

	/**
	 * Records a Protobus response for a given request.
	 */
	public recordResponse(requestId: string, response: ProtobusResponse): void {
		const pendingRequest = this.pendingRequests.get(requestId)

		if (!pendingRequest) {
			Logger.warn(`No pending request found for response with ID: ${requestId}`)
			return
		}

		const { entry, startTime } = pendingRequest

		entry.response = {
			message: response?.message ? response.message : undefined,
			error: response?.error,
			isStreaming: response?.is_streaming,
			sequenceNumber: response?.sequence_number,
		}

		entry.duration = Date.now() - startTime
		entry.status = response?.error ? "error" : "completed"

		if (!response?.is_streaming) {
			this.pendingRequests.delete(requestId)
		}

		this.sessionLog.stats = this.getStats()

		this.flushLogAsync()

		this.runHooks(entry).catch((e) => Logger.error("Post-record hook failed:", e))
	}

	private async runHooks(entry: ProtobusLogEntry): Promise<void> {
		if (entry.meta?.synthetic) return
		for (const hook of this.postRecordHooks) {
			await hook(entry)
		}
	}

	public cleanupSyntheticEntries(): void {
		// Remove synthetic entries from session log
		this.sessionLog.entries = this.sessionLog.entries.filter((entry) => !entry.meta?.synthetic)

		// clean up from pending requests if needed
		for (const [requestId, pendingRequest] of this.pendingRequests.entries()) {
			if (pendingRequest.entry.meta?.synthetic) {
				this.pendingRequests.delete(requestId)
			}
		}

		this.sessionLog.stats = this.getStats()
		this.flushLogAsync()
	}

	/**
	 * Records an error for a given request.
	 */
	public recordError(requestId: string, error: string): void {
		const pendingRequest = this.pendingRequests.get(requestId)
		if (!pendingRequest) {
			Logger.warn(`No pending request found for error with ID: ${requestId}`)
			return
		}

		const { entry, startTime } = pendingRequest

		entry.response = {
			error: error,
		}
		entry.duration = Date.now() - startTime
		entry.status = "error"

		this.pendingRequests.delete(requestId)
		this.flushLogAsync()
	}

	private flushLogAsync(): void {
		setImmediate(() => {
			this.fileHandler.write(this.sessionLog).catch((error) => {
				Logger.error("Failed to flush Protobus log:", error)
			})
		})
	}

	public getStats(): SessionStats {
		const totalRequests = this.sessionLog.entries.length
		const pendingRequests = this.sessionLog.entries.filter((e) => e.status === "pending").length
		const completedRequests = this.sessionLog.entries.filter((e) => e.status === "completed").length
		const errorRequests = this.sessionLog.entries.filter((e) => e.status === "error").length

		return {
			totalRequests,
			pendingRequests,
			completedRequests,
			errorRequests,
		}
	}

	private shouldFilter(request: ProtobusRequest): boolean {
		return this.requestFilters.some((filter) => filter(request))
	}
}
