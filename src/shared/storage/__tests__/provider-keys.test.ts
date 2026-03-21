import { anthropicDefaultModelId } from "@shared/api"
import { expect } from "chai"
import { describe, it } from "mocha"
import { getProviderDefaultModelId, getProviderModelIdKey } from "../provider-keys"

describe("Provider key mapping", () => {
	it("returns Anthropic default model ID", () => {
		expect(getProviderDefaultModelId("anthropic")).to.equal(anthropicDefaultModelId)
	})

	it("uses generic model key for Anthropic", () => {
		expect(getProviderModelIdKey("anthropic", "act")).to.equal("actModeApiModelId")
		expect(getProviderModelIdKey("anthropic", "plan")).to.equal("planModeApiModelId")
	})

	it("keeps provider-specific model key behavior for OpenRouter", () => {
		expect(getProviderModelIdKey("openrouter", "act")).to.equal("actModeOpenRouterModelId")
		expect(getProviderModelIdKey("openrouter", "plan")).to.equal("planModeOpenRouterModelId")
	})
})
