import { ApiProvider, EmptyRequest, Metadata, StringRequest } from "@shared/proto/codemarie/common"
import {
	CodemarieRecommendedModel,
	CodemarieRecommendedModelsResponse,
	OpenRouterCompatibleModelInfo,
	RefreshModelsRequest,
	RefreshModelsResponse,
	SapAiCoreModelsRequest,
} from "@shared/proto/codemarie/system"
import { toProtobufModels } from "../../../shared/proto-conversions/models/typeConversion"
import type { Controller } from "../index"
import { getSapAiCoreModels } from "./getSapAiCoreModels"
import { getVsCodeLmModels } from "./getVsCodeLmModels"
import { refreshBasetenModels } from "./refreshBasetenModels"
import { refreshCodemarieModels } from "./refreshCodemarieModels"
import { CodemarieRecommendedModelsData, refreshCodemarieRecommendedModels } from "./refreshCodemarieRecommendedModels"
import { refreshGroqModels } from "./refreshGroqModels"
import { refreshHuggingFaceModels } from "./refreshHuggingFaceModels"
import { refreshLiteLlmModels } from "./refreshLiteLlmModels"
import { refreshOcaModels } from "./refreshOcaModels"
import { refreshOpenRouterModels } from "./refreshOpenRouterModels"
import { refreshRequestyModels } from "./refreshRequestyModels"
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
		case ApiProvider.CODEMARIE: {
			const models = await refreshCodemarieModels(controller)
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
		case ApiProvider.HUGGINGFACE: {
			const response = await refreshHuggingFaceModels(controller, EmptyRequest.create({}))
			return RefreshModelsResponse.fromPartial({
				compatibleModels: response,
			})
		}
		case ApiProvider.REQUESTY: {
			const protoApiConfiguration = {
				// biome-ignore lint/suspicious/noExplicitAny: request can be any for model options
				...(request as any).options,
				// biome-ignore lint/suspicious/noExplicitAny: request can be any for model secrets
				...(request as any).secrets,
			}
			const response = await refreshRequestyModels(controller, protoApiConfiguration)
			return RefreshModelsResponse.fromPartial({
				compatibleModels: response,
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
		case ApiProvider.OCA: {
			const response = await refreshOcaModels(controller, StringRequest.fromPartial({ value: request.baseUrl || "" }))
			return RefreshModelsResponse.fromPartial({
				ocaModels: response,
			})
		}
		default: {
			// Specific handling for recommended models if CODEMARIE is requested but we need free models
			// Note: This logic can be refined based on additional request flags if needed
			if (provider === ApiProvider.CODEMARIE) {
				const data = await refreshCodemarieRecommendedModels()
				return RefreshModelsResponse.fromPartial({
					recommendedModels: toProtoRecommendedModels(data),
				})
			}
			throw new Error(`RefreshModels not implemented for provider: ${provider}`)
		}
	}
}

function toProtoRecommendedModels(data: CodemarieRecommendedModelsData): CodemarieRecommendedModelsResponse {
	return CodemarieRecommendedModelsResponse.fromPartial({
		recommended: data.recommended.map((m) => CodemarieRecommendedModel.fromPartial(m)),
		free: data.free.map((m) => CodemarieRecommendedModel.fromPartial(m)),
	})
}
