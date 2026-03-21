import { EmptyRequest } from "@shared/proto/codemarie/common"
import type { OpenRouterCompatibleModelInfo } from "@shared/proto/codemarie/models"
import { fromProtobufModels } from "@shared/proto-conversions/models/typeConversion"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import {
	basetenDefaultModelId,
	basetenModels,
	groqDefaultModelId,
	groqModels,
	type ModelInfo,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
} from "../../../src/shared/api"
import { SystemServiceClient } from "../services/protobus-client"
import { useGlobalState } from "./GlobalStateContext"

export interface ModelStateContextType {
	codemarieModels: Record<string, ModelInfo> | null
	openRouterModels: Record<string, ModelInfo>
	vercelAiGatewayModels: Record<string, ModelInfo>
	hicapModels: Record<string, ModelInfo>
	liteLlmModels: Record<string, ModelInfo>
	requestyModels: Record<string, ModelInfo>
	groqModels: Record<string, ModelInfo>
	basetenModels: Record<string, ModelInfo>
	huggingFaceModels: Record<string, ModelInfo>
	openAiModels: string[]
	setCodemarieModels: React.Dispatch<React.SetStateAction<Record<string, ModelInfo> | null>>
	setOpenRouterModels: React.Dispatch<React.SetStateAction<Record<string, ModelInfo>>>
	setVercelAiGatewayModels: React.Dispatch<React.SetStateAction<Record<string, ModelInfo>>>
	setHicapModels: React.Dispatch<React.SetStateAction<Record<string, ModelInfo>>>
	setLiteLlmModels: React.Dispatch<React.SetStateAction<Record<string, ModelInfo>>>
	setRequestyModels: React.Dispatch<React.SetStateAction<Record<string, ModelInfo>>>
	setGroqModels: React.Dispatch<React.SetStateAction<Record<string, ModelInfo>>>
	setBasetenModels: React.Dispatch<React.SetStateAction<Record<string, ModelInfo>>>
	setHuggingFaceModels: React.Dispatch<React.SetStateAction<Record<string, ModelInfo>>>
	refreshCodemarieModels: () => void
	refreshOpenRouterModels: () => void
	refreshVercelAiGatewayModels: () => void
	refreshHicapModels: () => void
	refreshLiteLlmModels: () => Promise<void>
}

const ModelStateContext = createContext<ModelStateContextType | undefined>(undefined)

export const ModelStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const state = useGlobalState()
	const [codemarieModels, setCodemarieModels] = useState<Record<string, ModelInfo> | null>(null)
	const [openRouterModels, setOpenRouterModels] = useState<Record<string, ModelInfo>>({
		[openRouterDefaultModelId]: openRouterDefaultModelInfo,
	})
	const [vercelAiGatewayModels, setVercelAiGatewayModels] = useState<Record<string, ModelInfo>>({})
	const [hicapModels, setHicapModels] = useState<Record<string, ModelInfo>>({})
	const [liteLlmModels, setLiteLlmModels] = useState<Record<string, ModelInfo>>({})
	const [requestyModels, setRequestyModels] = useState<Record<string, ModelInfo>>({
		[requestyDefaultModelId]: requestyDefaultModelInfo,
	})
	const [groqModelsState, setGroqModels] = useState<Record<string, ModelInfo>>({
		[groqDefaultModelId]: groqModels[groqDefaultModelId],
	})
	const [basetenModelsState, setBasetenModels] = useState<Record<string, ModelInfo>>({
		...basetenModels,
		[basetenDefaultModelId]: basetenModels[basetenDefaultModelId],
	})
	const [huggingFaceModels, setHuggingFaceModels] = useState<Record<string, ModelInfo>>({})
	const [openAiModels, _setOpenAiModels] = useState<string[]>([])

	const refreshOpenRouterModels = useCallback(() => {
		SystemServiceClient.refreshOpenRouterModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setOpenRouterModels({
					[openRouterDefaultModelId]: openRouterDefaultModelInfo,
					...models,
				})
			})
			.catch((error: Error) => console.error("Failed to refresh OpenRouter models:", error))
	}, [])

	const refreshHicapModels = useCallback(() => {
		SystemServiceClient.refreshHicapModels(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				setHicapModels({ ...response.models })
			})
			.catch((error: Error) => console.error("Failed to refresh Hicap models:", error))
	}, [])

	const refreshLiteLlmModels = useCallback(() => {
		return SystemServiceClient.refreshLiteLlmModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				setLiteLlmModels(fromProtobufModels(response.models))
			})
			.catch((error: Error) => console.error("Failed to refresh LiteLLM models:", error))
	}, [])

	const refreshBasetenModels = useCallback(() => {
		SystemServiceClient.refreshBasetenModelsRpc(EmptyRequest.create({}))
			.then((response) => {
				setBasetenModels({
					[basetenDefaultModelId]: basetenModels[basetenDefaultModelId],
					...fromProtobufModels(response.models),
				})
			})
			.catch((err) => console.error("Failed to refresh Baseten models:", err))
	}, [])

	const refreshVercelAiGatewayModels = useCallback(() => {
		SystemServiceClient.refreshVercelAiGatewayModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				setVercelAiGatewayModels(fromProtobufModels(response.models))
			})
			.catch((error: Error) => console.error("Failed to refresh Vercel AI Gateway models:", error))
	}, [])

	const refreshCodemarieModels = useCallback(() => {
		SystemServiceClient.refreshCodemarieModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setCodemarieModels((prev) => (Object.keys(models).length > 0 ? models : (prev ?? null)))
			})
			.catch((error: Error) => console.error("Failed to refresh Codemarie models:", error))
	}, [])

	useEffect(() => {
		if (!openRouterModels || Object.keys(openRouterModels).length <= 1) refreshOpenRouterModels()
		if (!vercelAiGatewayModels || Object.keys(vercelAiGatewayModels).length === 0) refreshVercelAiGatewayModels()
		if (state.apiConfiguration?.basetenApiKey) refreshBasetenModels()
		if (state.apiConfiguration?.liteLlmApiKey) refreshLiteLlmModels()
	}, [
		refreshOpenRouterModels,
		refreshVercelAiGatewayModels,
		state?.apiConfiguration?.basetenApiKey,
		refreshBasetenModels,
		state?.apiConfiguration?.liteLlmApiKey,
		refreshLiteLlmModels,
		openRouterModels,
		vercelAiGatewayModels,
	])

	useEffect(() => {
		const hasCodemarieProvider =
			state.apiConfiguration?.actModeApiProvider === "codemarie" ||
			state.apiConfiguration?.planModeApiProvider === "codemarie"
		if (hasCodemarieProvider && codemarieModels === null) {
			refreshCodemarieModels()
		}
	}, [
		state.apiConfiguration?.actModeApiProvider,
		state.apiConfiguration?.planModeApiProvider,
		codemarieModels,
		refreshCodemarieModels,
	])

	return (
		<ModelStateContext.Provider
			value={{
				codemarieModels,
				openRouterModels,
				vercelAiGatewayModels,
				hicapModels,
				liteLlmModels,
				requestyModels,
				groqModels: groqModelsState,
				basetenModels: basetenModelsState,
				huggingFaceModels,
				openAiModels,
				setCodemarieModels,
				setOpenRouterModels,
				setVercelAiGatewayModels,
				setHicapModels,
				setLiteLlmModels,
				setRequestyModels,
				setGroqModels,
				setBasetenModels,
				setHuggingFaceModels,
				refreshCodemarieModels,
				refreshOpenRouterModels,
				refreshVercelAiGatewayModels,
				refreshHicapModels,
				refreshLiteLlmModels,
			}}>
			{children}
		</ModelStateContext.Provider>
	)
}

export const useModels = () => {
	const context = useContext(ModelStateContext)
	if (context === undefined) {
		throw new Error("useModels must be used within a ModelStateProvider")
	}
	return context
}
