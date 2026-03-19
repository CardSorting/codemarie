import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { StateManager } from "../../../core/storage/StateManager"
import { Logger } from "../../../shared/services/Logger"
import { OpenAiCodexOAuthManager } from "../oauth"

describe("OpenAiCodexOAuthManager Synchronous Auth", () => {
	let sandbox: sinon.SinonSandbox
	let manager: OpenAiCodexOAuthManager
	let mockStateManager: any

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		mockStateManager = {
			getSecretKey: sandbox.stub(),
		}
		sandbox.stub(StateManager, "get").returns(mockStateManager)
		sandbox.stub(Logger, "error")
		manager = new OpenAiCodexOAuthManager()
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should return false when no credentials are found", () => {
		mockStateManager.getSecretKey.withArgs("openai-codex-oauth-credentials").returns(undefined)
		expect(manager.isAuthenticated()).to.be.false
	})

	it("should return true when credentials are found and valid", () => {
		const validCreds = JSON.stringify({
			accessToken: "test-token",
			refreshToken: "test-refresh",
			email: "test@example.com",
			accountId: "test-id",
			expiresAt: Date.now() + 100000,
		})
		mockStateManager.getSecretKey.withArgs("openai-codex-oauth-credentials").returns(validCreds)

		expect(manager.isAuthenticated()).to.be.true

		// Should remain true without re-reading state if already loaded
		mockStateManager.getSecretKey.resetHistory()
		expect(manager.isAuthenticated()).to.be.true
		expect(mockStateManager.getSecretKey.called).to.be.false
	})

	it("should handle invalid JSON gracefully", () => {
		mockStateManager.getSecretKey.withArgs("openai-codex-oauth-credentials").returns("invalid-json")
		expect(manager.isAuthenticated()).to.be.false
		// @ts-expect-error
		expect(Logger.error.called).to.be.true
	})
})
