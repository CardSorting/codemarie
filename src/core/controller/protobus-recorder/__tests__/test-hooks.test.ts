import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { Controller } from "@core/controller"
import { ProtobusRecorderBuilder } from "@core/controller/protobus-recorder/protobus-recorder.builder"
import { testHooks } from "@core/controller/protobus-recorder/test-hooks"
import { IProtobusRecorder, ProtobusLogEntry } from "@core/controller/protobus-recorder/types"
import * as sinon from "sinon"

describe("test-hooks", () => {
	let cleanupSyntheticEntriesStub: sinon.SinonStub
	let recordRequestStub: sinon.SinonStub
	let recordResponseStub: sinon.SinonStub
	let getRecorderStub: sinon.SinonStub

	beforeEach(() => {
		cleanupSyntheticEntriesStub = sinon.stub()
		recordRequestStub = sinon.stub()
		recordResponseStub = sinon.stub()

		const mockRecorder: IProtobusRecorder = {
			cleanupSyntheticEntries: cleanupSyntheticEntriesStub,
			recordRequest: recordRequestStub,
			recordResponse: recordResponseStub,
			recordError: sinon.stub(),
			getSessionLog: sinon.stub().returns({ startTime: "", entries: [] }),
		}

		getRecorderStub = sinon.stub(ProtobusRecorderBuilder, "getRecorder").returns(mockRecorder)
	})

	afterEach(() => {
		sinon.restore()
	})

	it("should return an array of post-record hooks", () => {
		const mockController = {} as Controller
		const hooks = testHooks(mockController)

		hooks.should.be.an.Array()
		hooks.should.have.length(1)
		hooks[0].should.be.a.Function()
	})

	it("should execute hook and call recorder methods", async () => {
		const mockController = {
			getStateToPostToWebview: sinon.stub().returns({}),
			// biome-ignore lint/suspicious/noExplicitAny: test mock
		} as any as Controller

		const hooks = testHooks(mockController)

		const mockEntry: ProtobusLogEntry = {
			requestId: "test-request-id",
			service: "TestService",
			method: "testMethod",
			isStreaming: false,
			request: { message: {} },
			status: "pending",
		}

		await hooks[0](mockEntry)

		// Validate sinon stub calls
		sinon.assert.calledWith(getRecorderStub, mockController)
		sinon.assert.calledOnce(cleanupSyntheticEntriesStub)
		sinon.assert.calledOnce(recordRequestStub)
		sinon.assert.calledOnce(recordResponseStub)
	})
})
