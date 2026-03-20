import { IProtobusRecorder, ProtobusPostRecordHook, ProtobusRequestFilter } from "@core/controller/protobus-recorder/types"
import { Controller } from "@/core/controller"
import { LogFileHandler, LogFileHandlerNoops } from "@/core/controller/protobus-recorder/log-file-handler"
import { ProtobusRecorder, ProtobusRecorderNoops } from "@/core/controller/protobus-recorder/protobus-recorder"
import { testHooks } from "@/core/controller/protobus-recorder/test-hooks"

/**
 * A builder class for constructing a Protobus recorder instance.
 */
export class ProtobusRecorderBuilder {
	private fileHandler: LogFileHandler | null = null
	private enabled = true
	private filters: ProtobusRequestFilter[] = []
	private hooks: ProtobusPostRecordHook[] = []

	public withLogFileHandler(handler: LogFileHandler): this {
		this.fileHandler = handler
		return this
	}

	public enableIf(condition: boolean): this {
		this.enabled = condition
		return this
	}

	public withFilters(...filters: ProtobusRequestFilter[]): this {
		this.filters.push(...filters)
		return this
	}

	public withPostRecordHooks(...hooks: ProtobusPostRecordHook[]): this {
		this.hooks.push(...hooks)
		return this
	}

	// Initialize the recorder as a singleton
	private static recorder: IProtobusRecorder

	/**
	 * Gets or creates the ProtobusRecorder instance
	 */
	static getRecorder(controller: Controller): IProtobusRecorder {
		if (!ProtobusRecorderBuilder.recorder) {
			ProtobusRecorderBuilder.recorder = ProtobusRecorder.builder()
				.enableIf(
					process.env.PROTOBUS_RECORDER_ENABLED === "true" &&
						(process.env.CODEMARIE_ENVIRONMENT === "local" || process.env.CLINE_ENVIRONMENT === "local"),
				)
				.withLogFileHandler(new LogFileHandler())
				.build(controller)
		}
		return ProtobusRecorderBuilder.recorder
	}

	public build(controller?: Controller): IProtobusRecorder {
		if (!this.enabled) {
			return new ProtobusRecorderNoops()
		}

		let filters: ProtobusRequestFilter[] = filtersFromEnv()
		if (this.filters.length > 0) {
			filters = filters.concat(this.filters)
		}

		let hooks: ProtobusPostRecordHook[] = hooksFromEnv(controller)
		if (this.hooks.length > 0) {
			hooks = hooks.concat(this.hooks)
		}

		const handler = this.fileHandler ?? new LogFileHandlerNoops()
		return new ProtobusRecorder(handler, filters, hooks)
	}
}

function filtersFromEnv(): ProtobusRequestFilter[] {
	const filters: ProtobusRequestFilter[] = []

	if (process.env.PROTOBUS_RECORDER_TESTS_FILTERS_ENABLED === "true") {
		filters.push(...testFilters())
	}

	return filters
}

function testFilters(): ProtobusRequestFilter[] {
	/*
	 * Ignores streaming messages and unwanted services messages
	 * that record more than expected.
	 */
	return [
		(req) => req.is_streaming,
		(req) => ["codemarie.UiService", "codemarie.McpService", "codemarie.WebService"].includes(req.service),
		(req) =>
			[
				"refreshOpenRouterModels",
				"getAvailableTerminalProfiles",
				"showTaskWithId",
				"deleteTasksWithIds",
				"getTotalTasksSize",
				"cancelTask",
			].includes(req.method),
	]
}

function hooksFromEnv(controller?: Controller): ProtobusPostRecordHook[] {
	const hooks: ProtobusPostRecordHook[] = []

	if (controller && process.env.PROTOBUS_RECORDER_TESTS_FILTERS_ENABLED === "true") {
		hooks.push(...testHooks(controller))
	}

	return hooks
}
