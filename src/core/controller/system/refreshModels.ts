import { ApiProvider, Metadata, StringRequest } from "@shared/proto/codemarie/common"
import {
	OpenRouterCompatibleModelInfo,
	RefreshModelsRequest,
	RefreshModelsResponse,
	SapAiCoreModelsRequest,
} from "@shared/proto/codemarie/system"
import { toProtobufModels } from "../../../shared/proto-conversions/models/typeConversion"
import type { Controller } from "../index"
import { getLmStudioModels } from "./getLmStudioModels"
import { getOllamaModels } from "./getOllamaModels"
import { getSapAiCoreModels } from "./getSapAiCoreModels"
import { getVsCodeLmModels } from "./getVsCodeLmModels"
import { refreshBasetenModels } from "./refreshBasetenModels"
import { refreshGroqModels } from "./refreshGroqModels"
import { refreshLiteLlmModels } from "./refreshLiteLlmModels"
import { refreshOcaModels } from "./refreshOcaModels"
import { refreshOpenRouterModels } from "./refreshOpenRouterModels"
import { refreshVercelAiGatewayModels } from "./refreshVercelAiGatewayModels"

export async function refreshModels(controller: Controller, request: RefreshModelsRequest): Promise<RefreshModelsResponse> {
	// biome-ignore lint/suspicious/noExplicitAny: provider can be any string for model dispatch
	const provider = request.provider as any

	switch (provider) {
		case ApiProvider.OPENROUTER: {
			const models = await refreshOpenRouterModels(controller)
			return RefreshModelsResponse.fromPartial({
				compatibleModels: OpenRouterCompatibleModelInfo.fromPartial({
					models: toProtobufModels(models),
				}),
			})
		}
		case ApiProvider.LITELLM: {
			const models = await refreshLiteLlmModels()
			return RefreshModelsResponse.fromPartial({
				compatibleModels: OpenRouterCompatibleModelInfo.fromPartial({
					models: toProtobufModels(models),
				}),
			})
		}
		case ApiProvider.GROQ: {
			const models = await refreshGroqModels(controller)
			return RefreshModelsResponse.fromPartial({
				compatibleModels: OpenRouterCompatibleModelInfo.fromPartial({
					models: toProtobufModels(models),
				}),
			})
		}
		case ApiProvider.BASETEN: {
			const models = await refreshBasetenModels(controller)
			return RefreshModelsResponse.fromPartial({
				compatibleModels: OpenRouterCompatibleModelInfo.fromPartial({
					models: toProtobufModels(models),
				}),
			})
		}
		case ApiProvider.VERCEL_AI_GATEWAY: {
			const models = await refreshVercelAiGatewayModels(controller)
			return RefreshModelsResponse.fromPartial({
				compatibleModels: OpenRouterCompatibleModelInfo.fromPartial({
					models: toProtobufModels(models),
				}),
			})
		}
		case ApiProvider.VSCODE_LM: {
			const response = await getVsCodeLmModels(controller, {})
			return RefreshModelsResponse.fromPartial({
				vsCodeLmModels: response,
			})
		}
		case ApiProvider.SAPAICORE: {
			const response = await getSapAiCoreModels(
				controller,
				SapAiCoreModelsRequest.fromPartial({
					metadata: Metadata.fromPartial({}),
					clientId: request.clientId || "",
					clientSecret: request.clientSecret || "",
					tokenUrl: request.tokenUrl || "",
					baseUrl: request.baseUrl || "",
					resourceGroup: request.resourceGroup || "",
				}),
			)
			return RefreshModelsResponse.fromPartial({
				sapAiCoreModels: response,
			})
		}
		case ApiProvider.OLLAMA: {
			const response = await getOllamaModels(controller, StringRequest.fromPartial({ value: request.baseUrl || "" }))
			return RefreshModelsResponse.fromPartial({
				stringArrayModels: response,
			})
		}
		case ApiProvider.LMSTUDIO: {
			const response = await getLmStudioModels(controller, StringRequest.fromPartial({ value: request.baseUrl || "" }))
			return RefreshModelsResponse.fromPartial({
				stringArrayModels: response,
			})
		}
		case ApiProvider.OCA: {
			const response = await refreshOcaModels(controller, StringRequest.fromPartial({ value: request.baseUrl || "" }))
			return RefreshModelsResponse.fromPartial({
				ocaModels: response,
			})
		}
		default: {
			throw new Error(`RefreshModels not implemented for provider: ${provider}`)
		}
	}
}
