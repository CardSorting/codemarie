import { SignOutRequest } from "@shared/proto/codemarie/account"
import { ApiProvider, Empty } from "@shared/proto/codemarie/common"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

export async function signOut(controller: Controller, request: SignOutRequest): Promise<Empty> {
	const provider = request.provider as ApiProvider

	switch (provider) {
		case ApiProvider.OPENAI_CODEX: {
			try {
				await openAiCodexOAuthManager.clearCredentials()
				openAiCodexOAuthManager.cancelAuthorizationFlow()
				await controller.postStateToWebview()
			} catch (error) {
				Logger.error("[signOut] OpenAI Codex sign out failed:", error)
				throw error
			}
			return {}
		}
		case ApiProvider.OPENROUTER: {
			await controller.stateManager.setSecret("openRouterApiKey", "")
			await controller.postStateToWebview()
			return {}
		}
		case ApiProvider.REQUESTY: {
			await controller.stateManager.setSecret("requestyApiKey", "")
			await controller.postStateToWebview()
			return {}
		}
		default:
			// For other providers, we might just clear keys if needed,
			// but currently only these have specific signOut logic.
			return {}
	}
}
