import { describe, it } from "mocha"
import "should"
import { LogFileHandler } from "@/core/controller/protobus-recorder/log-file-handler"
import { ProtobusRecorderNoops } from "@/core/controller/protobus-recorder/protobus-recorder"
import { ProtobusRecorderBuilder } from "@/core/controller/protobus-recorder/protobus-recorder.builder"

describe("ProtobusRecorderBuilder", () => {
	describe("when not enabling", () => {
		it("should return ProtobusRecorderNoops when enableIf is false", () => {
			const builder = new ProtobusRecorderBuilder()
			const recorder = builder.enableIf(false).build()

			recorder.should.be.instanceOf(ProtobusRecorderNoops)
		})

		it("should return ProtobusRecorderNoops when enableIf is false even with log file handler", () => {
			const builder = new ProtobusRecorderBuilder()
			const logFileHandler = new LogFileHandler()
			const recorder = builder.withLogFileHandler(logFileHandler).enableIf(false).build()

			recorder.should.be.instanceOf(ProtobusRecorderNoops)
		})
	})

	describe("ProtobusRecorderNoops functionality", () => {
		it("should have no-op methods that don't throw errors", () => {
			const recorder = new ProtobusRecorderNoops()

			recorder.recordRequest({
				request_id: "test-id",
				service: "TestService",
				method: "testMethod",
				message: {},
				is_streaming: false,
			})

			recorder.recordResponse("test-id", {
				request_id: "test-id",
				message: {},
			})

			recorder.recordError("test-id", "test error")

			const sessionLog = recorder.getSessionLog()
			sessionLog.should.have.property("startTime").which.is.a.String()
			sessionLog.should.have.property("entries").which.is.an.Array()
			sessionLog.entries.should.have.length(0)
		})
	})
})
