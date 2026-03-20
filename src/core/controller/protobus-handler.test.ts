import { Controller } from "@core/controller"
import { serviceHandlers } from "@generated/hosts/vscode/protobus-services"
import { ProtobusCancel, ProtobusRequest } from "@shared/WebviewMessage"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { getProtobusRequestRegistry, handleProtobusRequest, handleProtobusRequestCancel } from "./protobus-handler"

describe("protobus-handler", () => {
	let sandbox: sinon.SinonSandbox
	let mockController: Controller
	let mockPostMessageToWebview: sinon.SinonStub

	let mockUnaryHandler: sinon.SinonStub
	let mockUnaryFailingHandler: sinon.SinonStub
	let mockStreamingHandler: sinon.SinonStub
	let mockStreamingFailingHandler: sinon.SinonStub

	const serviceName = "codemarie.TestService"
	const mockResponse = { result: "result-1234" }

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Create a mock controller
		mockController = {} as any
		mockPostMessageToWebview = sandbox.stub().resolves()

		// Create mock service handlers
		mockUnaryHandler = sandbox.stub().resolves(mockResponse)
		mockStreamingHandler = sandbox.stub().resolves()
		mockUnaryFailingHandler = sandbox.stub().rejects(new Error("Test error unary"))
		mockStreamingFailingHandler = sandbox.stub().rejects(new Error("Stream error"))
		serviceHandlers[serviceName] = {
			testUnary: mockUnaryHandler,
			testUnaryFailing: mockUnaryFailingHandler,
			testStreaming: mockStreamingHandler,
			testStreamingFailing: mockStreamingFailingHandler,
		}
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("handleProtobusRequest", () => {
		describe("Unary requests", () => {
			it("should handle successful unary requests", async () => {
				const request: ProtobusRequest = {
					service: serviceName,
					method: "testUnary",
					message: { input: "test" },
					request_id: "test-123",
					is_streaming: false,
				}

				await handleProtobusRequest(mockController, mockPostMessageToWebview, request)

				// Verify the handler was called
				expect(mockUnaryHandler.calledOnce).to.be.true
				expect(mockUnaryHandler.firstCall.args[0]).to.equal(mockController)
				expect(mockUnaryHandler.firstCall.args[1]).to.deep.equal({ input: "test" })

				// Verify the response was sent
				expect(mockPostMessageToWebview.calledOnce).to.be.true
				const sentMessage = mockPostMessageToWebview.firstCall.args[0]
				expect(sentMessage).to.deep.equal({
					type: "protobus_response",
					protobus_response: {
						message: mockResponse,
						request_id: "test-123",
					},
				})
			})

			it("should handle errors in unary requests", async () => {
				const request: ProtobusRequest = {
					service: serviceName,
					method: "testUnaryFailing",
					message: { input: "test" },
					request_id: "test-456",
					is_streaming: false,
				}

				await handleProtobusRequest(mockController, mockPostMessageToWebview, request)

				// Verify the error response was sent
				expect(mockPostMessageToWebview.calledOnce).to.be.true
				const sentMessage = mockPostMessageToWebview.firstCall.args[0]
				expect(sentMessage).to.deep.equal({
					type: "protobus_response",
					protobus_response: {
						error: "Test error unary",
						request_id: "test-456",
						is_streaming: false,
					},
				})
			})

			it("should handle unknown service errors", async () => {
				const request: ProtobusRequest = {
					service: "UnknownService",
					method: "someMethod",
					message: {},
					request_id: "test-789",
					is_streaming: false,
				}

				await handleProtobusRequest(mockController, mockPostMessageToWebview, request)

				// Verify the error response was sent
				expect(mockPostMessageToWebview.calledOnce).to.be.true
				const sentMessage = mockPostMessageToWebview.firstCall.args[0]
				expect(sentMessage.type).to.equal("protobus_response")
				expect(sentMessage.protobus_response?.error).to.include("Unknown service: UnknownService")
				expect(sentMessage.protobus_response?.request_id).to.equal("test-789")
			})

			it("should handle unknown method errors", async () => {
				const request: ProtobusRequest = {
					service: serviceName,
					method: "unknownMethod",
					message: {},
					request_id: "test-999",
					is_streaming: false,
				}

				await handleProtobusRequest(mockController, mockPostMessageToWebview, request)

				// Verify the error response was sent
				expect(mockPostMessageToWebview.calledOnce).to.be.true
				const sentMessage = mockPostMessageToWebview.firstCall.args[0]
				expect(sentMessage.type).to.equal("protobus_response")
				expect(sentMessage.protobus_response?.error).to.include("Unknown rpc: codemarie.TestService.unknownMethod")
				expect(sentMessage.protobus_response?.request_id).to.equal("test-999")
			})
		})
		describe("Streaming requests", () => {
			it("should handle successful streaming requests", async () => {
				// Set up a streaming handler that sends multiple responses
				const request: ProtobusRequest = {
					service: serviceName,
					method: "testStreaming",
					message: { input: "stream" },
					request_id: "stream-123",
					is_streaming: true,
				}

				// Reset the mock and set up the handler using callsFake
				mockStreamingHandler.reset()
				mockStreamingHandler.callsFake(
					async (_controller: any, _message: any, responseStream: any, _requestId: string) => {
						// Simulate streaming multiple messages
						await responseStream({ value: 1 }, false, 0)
						await responseStream({ value: 2 }, false, 1)
						await responseStream({ value: 3 }, true, 2) // Last message
					},
				)

				await handleProtobusRequest(mockController, mockPostMessageToWebview, request)

				// Verify the handler was called
				expect(mockStreamingHandler.calledOnce).to.be.true
				expect(mockStreamingHandler.firstCall.args[0]).to.equal(mockController)
				expect(mockStreamingHandler.firstCall.args[1]).to.deep.equal({ input: "stream" })
				expect(mockStreamingHandler.firstCall.args[3]).to.equal("stream-123")

				// Verify all streaming responses were sent
				expect(mockPostMessageToWebview.callCount).to.equal(3)

				// Check all responses
				expect(mockPostMessageToWebview.firstCall.args[0]).to.deep.equal({
					type: "protobus_response",
					protobus_response: {
						message: { value: 1 },
						request_id: "stream-123",
						is_streaming: true,
						sequence_number: 0,
					},
				})
				expect(mockPostMessageToWebview.secondCall.args[0]).to.deep.equal({
					type: "protobus_response",
					protobus_response: {
						message: { value: 2 },
						request_id: "stream-123",
						is_streaming: true,
						sequence_number: 1,
					},
				})
				expect(mockPostMessageToWebview.thirdCall.args[0]).to.deep.equal({
					type: "protobus_response",
					protobus_response: {
						message: { value: 3 },
						request_id: "stream-123",
						is_streaming: false, // Last message has is_streaming: false
						sequence_number: 2,
					},
				})
			})

			it("should handle errors in streaming requests", async () => {
				const request: ProtobusRequest = {
					service: serviceName,
					method: "testStreamingFailing",
					message: { input: "stream" },
					request_id: "stream-456",
					is_streaming: true,
				}

				await handleProtobusRequest(mockController, mockPostMessageToWebview, request)

				// Verify the error response was sent
				expect(mockPostMessageToWebview.calledOnce).to.be.true
				const sentMessage = mockPostMessageToWebview.firstCall.args[0]
				expect(sentMessage).to.deep.equal({
					type: "protobus_response",
					protobus_response: {
						error: "Stream error",
						request_id: "stream-456",
						is_streaming: false,
					},
				})
			})

			it("should handle streaming with message, error, then another message", async () => {
				const request: ProtobusRequest = {
					service: serviceName,
					method: "testStreaming",
					message: { input: "stream-with-error" },
					request_id: "stream-error-mid",
					is_streaming: true,
				}

				// Reset the mock and set up the handler to throw an error after being called
				mockStreamingHandler.reset()
				mockStreamingHandler.callsFake(
					async (_controller: any, _message: any, responseStream: any, _requestId: string) => {
						// Send first message successfully
						await responseStream({ value: "first" }, false, 0)
						// Throw an error
						throw new Error("Mid-stream error")
					},
				)

				await handleProtobusRequest(mockController, mockPostMessageToWebview, request)

				// Verify the handler was called
				expect(mockStreamingHandler.calledOnce).to.be.true

				// Verify that we got the first message and then the error
				expect(mockPostMessageToWebview.callCount).to.equal(2)

				// Check first message was sent successfully
				expect(mockPostMessageToWebview.firstCall.args[0]).to.deep.equal({
					type: "protobus_response",
					protobus_response: {
						message: { value: "first" },
						request_id: "stream-error-mid",
						is_streaming: true,
						sequence_number: 0,
					},
				})

				// Check error response was sent
				expect(mockPostMessageToWebview.secondCall.args[0]).to.deep.equal({
					type: "protobus_response",
					protobus_response: {
						error: "Mid-stream error",
						request_id: "stream-error-mid",
						is_streaming: false,
					},
				})

				// Try to send another message after the error
				const responseStream = mockStreamingHandler.firstCall.args[2]
				await responseStream({ value: "after-error" }, false, 1)

				// Verify we now have 3 total calls
				expect(mockPostMessageToWebview.callCount).to.equal(3)

				expect(mockPostMessageToWebview.thirdCall.args[0]).to.deep.equal({
					type: "protobus_response",
					protobus_response: {
						message: { value: "after-error" },
						request_id: "stream-error-mid",
						is_streaming: true,
						sequence_number: 1,
					},
				})
			})
		})

		describe("handleProtobusRequestCancel", () => {
			it("should cancel an active request", async () => {
				// Register a request in the registry
				const registry = getProtobusRequestRegistry()
				const cleanupStub = sandbox.stub()
				registry.registerRequest("cancel-123", cleanupStub)

				const cancelRequest: ProtobusCancel = {
					request_id: "cancel-123",
				}

				await handleProtobusRequestCancel(mockPostMessageToWebview, cancelRequest)

				// Verify the cleanup was called
				expect(cleanupStub.calledOnce).to.be.true

				// Verify the cancellation confirmation was sent
				expect(mockPostMessageToWebview.calledOnce).to.be.true
				const sentMessage = mockPostMessageToWebview.firstCall.args[0]
				expect(sentMessage).to.deep.equal({
					type: "protobus_response",
					protobus_response: {
						message: { cancelled: true },
						request_id: "cancel-123",
						is_streaming: false,
					},
				})

				// Verify the request was removed from the registry
				expect(registry.hasRequest("cancel-123")).to.be.false
			})

			it("should handle cancellation of non-existent request", async () => {
				const cancelRequest: ProtobusCancel = {
					request_id: "non-existent",
				}

				await handleProtobusRequestCancel(mockPostMessageToWebview, cancelRequest)

				// Verify no message was sent (request not found)
				expect(mockPostMessageToWebview.called).to.be.false
			})

			it("should handle cleanup errors gracefully", async () => {
				// Register a request with a failing cleanup
				const registry = getProtobusRequestRegistry()
				const cleanupStub = sandbox.stub().throws(new Error("Cleanup failed"))
				registry.registerRequest("cancel-error", cleanupStub)

				const cancelRequest: ProtobusCancel = {
					request_id: "cancel-error",
				}

				// Should not throw
				await handleProtobusRequestCancel(mockPostMessageToWebview, cancelRequest)

				// Verify the cleanup was attempted
				expect(cleanupStub.calledOnce).to.be.true

				// Verify the cancellation confirmation was still sent
				expect(mockPostMessageToWebview.calledOnce).to.be.true

				// Verify the request was removed despite the error
				expect(registry.hasRequest("cancel-error")).to.be.false
			})
		})

		describe("Concurrent requests", () => {
			it("should handle concurrent requests", async () => {
				// Set up handlers
				mockUnaryHandler.resolves({ result: "unary" })
				mockStreamingHandler.callsFake(async (_controller: any, _message: any, responseStream: any) => {
					await responseStream({ value: "stream1" }, false, 0)
					await responseStream({ value: "stream2" }, true, 1)
				})

				// Send multiple requests concurrently
				const requests = [
					handleProtobusRequest(mockController, mockPostMessageToWebview, {
						service: serviceName,
						method: "testUnary",
						message: { id: 1 },
						request_id: "concurrent-1",
						is_streaming: false,
					}),
					handleProtobusRequest(mockController, mockPostMessageToWebview, {
						service: serviceName,
						method: "testStreaming",
						message: { id: 2 },
						request_id: "concurrent-2",
						is_streaming: true,
					}),
					handleProtobusRequest(mockController, mockPostMessageToWebview, {
						service: serviceName,
						method: "testUnary",
						message: { id: 3 },
						request_id: "concurrent-3",
						is_streaming: false,
					}),
				]

				await Promise.all(requests)

				// Verify all handlers were called
				expect(mockUnaryHandler.callCount).to.equal(2)
				expect(mockStreamingHandler.callCount).to.equal(1)

				// Verify all responses were sent (2 unary + 2 streaming)
				expect(mockPostMessageToWebview.callCount).to.equal(4)
			})
		})
	})
})
