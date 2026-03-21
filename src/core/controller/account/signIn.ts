import { SignInRequest } from "@shared/proto/codemarie/account"
import { ApiProvider, Empty } from "@shared/proto/codemarie/common"
import { ShowMessageType } from "@shared/proto/host/window"
import { HostProvider } from "@/hosts/host-provider"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"
import type { Controller } from "../index"

export async function signIn(controller: Controller, request: SignInRequest): Promise<Empty> {
	const provider = request.provider as ApiProvider

	switch (provider) {
		case ApiProvider.OPENROUTER: {
			const callbackUrl = await HostProvider.get().getCallbackUrl("/openrouter")
			const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}`
			await openExternal(authUrl)
			return {}
		}
		case ApiProvider.HICAP: {
			const callbackUrl = await HostProvider.get().getCallbackUrl("/hicap")
			const authUrl = new URL("https://dashboard.hicap.ai/setup")
			authUrl.searchParams.set("application", "codemarie")
			authUrl.searchParams.set("callback_url", callbackUrl)
			await openExternal(authUrl.toString())
			return {}
		}
		case ApiProvider.OPENAI_CODEX: {
			try {
				const authUrl = openAiCodexOAuthManager.startAuthorizationFlow()
				await openExternal(authUrl)
				openAiCodexOAuthManager
					.waitForCallback()
					.then(async () => {
						HostProvider.window.showMessage({
							type: ShowMessageType.INFORMATION,
							message: "Successfully signed in to OpenAI Codex",
						})
						await controller.postStateToWebview()
					})
					.catch((error) => {
						Logger.error("[signIn] OpenAI Codex OAuth callback failed:", error)
						openAiCodexOAuthManager.cancelAuthorizationFlow()
						const errorMessage = error instanceof Error ? error.message : String(error)
						if (!errorMessage.includes("timed out")) {
							HostProvider.window.showMessage({
								type: ShowMessageType.ERROR,
								message: `OpenAI Codex sign in failed: ${errorMessage}`,
							})
						}
					})
			} catch (error) {
				Logger.error("[signIn] Failed to start OpenAI Codex OAuth flow:", error)
				openAiCodexOAuthManager.cancelAuthorizationFlow()
				throw error
			}
			return {}
		}
		default:
			throw new Error(`SignIn not implemented for provider: ${provider}`)
	}
}
