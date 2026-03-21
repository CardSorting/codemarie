import { ApiProvider } from "@shared/proto/codemarie/common"
import { RefreshModelsRequest, type RefreshModelsResponse } from "@shared/proto/codemarie/system"
import { fromProtobufModels } from "@shared/proto-conversions/models/typeConversion"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { type ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../../src/shared/api"
import { SystemServiceClient } from "../services/protobus-client"

export interface ModelStateContextType {
	openRouterModels: Record<string, ModelInfo>
	openAiModels: string[]
	setOpenRouterModels: React.Dispatch<React.SetStateAction<Record<string, ModelInfo>>>
	refreshOpenRouterModels: () => void
}

const ModelStateContext = createContext<ModelStateContextType | undefined>(undefined)

export const ModelStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [openRouterModels, setOpenRouterModels] = useState<Record<string, ModelInfo>>({
		[openRouterDefaultModelId]: openRouterDefaultModelInfo,
	})
	const [openAiModels, _setOpenAiModels] = useState<string[]>([])

	const refreshOpenRouterModels = useCallback(() => {
		SystemServiceClient.refreshModels(RefreshModelsRequest.create({ provider: ApiProvider.OPENROUTER }))
			.then((response: RefreshModelsResponse) => {
				if (response.compatibleModels) {
					const models = fromProtobufModels(response.compatibleModels.models)
					setOpenRouterModels({
						[openRouterDefaultModelId]: openRouterDefaultModelInfo,
						...models,
					})
				}
			})
			.catch((error: Error) => console.error("Failed to refresh OpenRouter models:", error))
	}, [])

	useEffect(() => {
		if (!openRouterModels || Object.keys(openRouterModels).length <= 1) refreshOpenRouterModels()
	}, [refreshOpenRouterModels, openRouterModels])

	return (
		<ModelStateContext.Provider
			value={{
				openRouterModels,
				openAiModels,
				setOpenRouterModels,
				refreshOpenRouterModels,
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
