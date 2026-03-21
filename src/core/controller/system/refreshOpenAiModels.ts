import { StringArray } from "@shared/proto/codemarie/common"
import { RefreshModelsRequest } from "@shared/proto/codemarie/system"
import type { AxiosRequestConfig } from "axios"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Fetches available models from the OpenAI API
 * @param controller The controller instance
 * @param request Request containing the base URL and API key
 * @returns Array of model names
 */
export async function refreshOpenAiModels(_controller: Controller, request: RefreshModelsRequest): Promise<StringArray> {
	try {
		if (!request.baseUrl) {
			return StringArray.create({ values: [] })
		}

		if (!URL.canParse(request.baseUrl)) {
			return StringArray.create({ values: [] })
		}

		const config: AxiosRequestConfig = {}
		if (request.apiKey) {
			config.headers = { Authorization: `Bearer ${request.apiKey}` }
		}

		const response = await axios.get(`${request.baseUrl}/models`, { ...config, ...getAxiosSettings() })
		// biome-ignore lint/suspicious/noExplicitAny: OpenAI API returns model objects
		const modelsArray = response.data?.data?.map((model: any) => model.id) || []
		const models = [...new Set<string>(modelsArray)]

		return StringArray.create({ values: models })
	} catch (error) {
		Logger.error("Error fetching OpenAI models:", error)
		return StringArray.create({ values: [] })
	}
}
