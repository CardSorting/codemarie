import { createProtobusClient } from "@hosts/vscode/hostbridge/client/host-protobus-client-base"
import * as host from "@shared/proto/index.host"
import { HostBridgeClientProvider } from "@/hosts/host-provider-types"

export const vscodeHostBridgeClient: HostBridgeClientProvider = {
	workspaceClient: createProtobusClient(host.WorkspaceServiceDefinition),
	envClient: createProtobusClient(host.EnvServiceDefinition),
	windowClient: createProtobusClient(host.WindowServiceDefinition),
	diffClient: createProtobusClient(host.DiffServiceDefinition),
}
