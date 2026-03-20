import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { StateServiceClient } from "@/services/protobus-client"

/**
 * Updates auto approval settings using the Protobus/Protobus client
 * @param settings The auto approval settings to update
 * @throws Error if the update fails
 */
export async function updateAutoApproveSettings(settings: AutoApprovalSettings) {
	try {
		await StateServiceClient.updateAutoApprovalSettings({ metadata: {}, ...settings })
	} catch (error) {
		console.error("Failed to update auto approval settings:", error)
		throw error
	}
}
