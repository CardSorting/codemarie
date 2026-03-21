import type { EmptyRequest } from "@shared/proto/codemarie/common"
import { Empty } from "@shared/proto/codemarie/common"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Opens the Codemarie walkthrough in VSCode
 * @param controller The controller instance
 * @param request Empty request
 * @returns Empty response
 */
export async function openWalkthrough(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		await vscode.commands.executeCommand(
			// biome-ignore plugin: New usage of vscode.commands.executeCommand is not allowed. Replace this with methods from the host bridge provider.
			"workbench.action.openWalkthrough",
			`saoudrizwan.${ExtensionRegistryInfo.name}#CodemarieWalkthrough`,
		)
		telemetryService.captureButtonClick("webview_openWalkthrough")
		return Empty.create({})
	} catch (error) {
		Logger.error(`Failed to open walkthrough: ${error}`)
		throw error
	}
}
