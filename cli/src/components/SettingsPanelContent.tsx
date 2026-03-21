/**
 * Settings panel content for inline display in ChatView
 * Uses a tabbed interface: API, Auto Approve, Features, Other
 */

import { type AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { getProviderModelIdKey, isSettingsKey } from "@shared/storage"
import { isOpenaiReasoningEffort, type OpenaiReasoningEffort } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import { useInput } from "ink"
import React, { useCallback, useMemo, useState } from "react"
import type { Controller } from "@/core/controller"
import { refreshModels as refreshOcaModels } from "@/core/controller/system/refreshModels"
import { StateManager } from "@/core/storage/StateManager"
import { ApiProvider } from "@/shared/proto/codemarie/common"
import { version as CLI_VERSION } from "../../package.json"
import { useStdinContext } from "../context/StdinContext"
import { useOcaAuth } from "../hooks/useOcaAuth"
import { isMouseEscapeSequence } from "../utils/input"
import { applyProviderConfig } from "../utils/provider-config"
import { AccountSettingsTab } from "./AccountSettingsTab"
import { ApiKeyInput } from "./ApiKeyInput"
// Tab Components
import { ApiSettingsTab } from "./ApiSettingsTab"
import type { HookInfo, SkillInfo, WorkspaceHooks } from "./App"
import { AutoApproveSettingsTab } from "./AutoApproveSettingsTab"
import { FeaturesSettingsTab } from "./FeaturesSettingsTab"
import { HooksSettingsTab } from "./HooksSettingsTab"
import { McpSettingsTab } from "./McpSettingsTab"
import { ModelPicker } from "./ModelPicker"
import { OtherSettingsTab } from "./OtherSettingsTab"
import { Panel, PanelTab } from "./Panel"
import { getProviderLabel, ProviderPicker } from "./ProviderPicker"
import { SkillsSettingsTab } from "./SkillsSettingsTab"

interface SettingsPanelContentProps {
	onClose: () => void
	controller?: Controller
	initialMode?: "model-picker" | "featured-models"
	initialModelKey?: "actModelId" | "planModelId"
	// Hooks & Skills
	hooksEnabled?: boolean
	globalHooks?: HookInfo[]
	workspaceHooks?: WorkspaceHooks[]
	onToggleHook?: (isGlobal: boolean, hookName: string, enabled: boolean, workspaceName?: string) => void
	skillsEnabled?: boolean
	globalSkills?: SkillInfo[]
	localSkills?: SkillInfo[]
	onToggleSkill?: (isGlobal: boolean, skillPath: string, enabled: boolean) => void
}

type SettingsTab = "api" | "auto-approve" | "features" | "other" | "account" | "mcp" | "hooks" | "skills"

type ListItemType = "checkbox" | "readonly" | "editable" | "separator" | "header" | "spacer" | "action" | "cycle" | "toggle"

interface ListItem {
	key: string
	label: string
	type: ListItemType
	value: string | boolean
	description?: string
	isSubItem?: boolean
	parentKey?: string
}

function normalizeReasoningEffort(value: unknown): OpenaiReasoningEffort {
	if (isOpenaiReasoningEffort(value)) {
		return value
	}
	return "low"
}

const TABS: PanelTab[] = [
	{ key: "api", label: "API" },
	{ key: "auto-approve", label: "Auto-approve" },
	{ key: "features", label: "Features" },
	{ key: "mcp", label: "MCP" },
	{ key: "hooks", label: "Hooks" },
	{ key: "skills", label: "Skills" },
	{ key: "account", label: "Account" },
	{ key: "other", label: "Other" },
]

const FEATURE_SETTINGS = {
	subagents: { stateKey: "subagentsEnabled", label: "Subagents" },
	autoCondense: { stateKey: "useAutoCondense", label: "Auto-condense" },
	webTools: { stateKey: "codemarieWebToolsEnabled", label: "Web tools" },
	strictPlanMode: { stateKey: "strictPlanModeEnabled", label: "Strict plan mode" },
	nativeToolCall: { stateKey: "nativeToolCallEnabled", label: "Native tool call" },
	parallelToolCalling: { stateKey: "enableParallelToolCalling", label: "Parallel tool calling" },
	doubleCheckCompletion: { stateKey: "doubleCheckCompletionEnabled", label: "Double-check completion" },
} as const

type FeatureKey = keyof typeof FEATURE_SETTINGS

export const SettingsPanelContent: React.FC<SettingsPanelContentProps> = ({
	onClose,
	controller,
	initialMode,
	initialModelKey,
	globalHooks = [],
	workspaceHooks = [],
	globalSkills = [],
	localSkills = [],
}) => {
	const { isRawModeSupported } = useStdinContext()
	const stateManager = StateManager.get()

	// UI state
	const [currentTab, setCurrentTab] = useState<SettingsTab>("api")
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isPickingModel, setIsPickingModel] = useState(initialMode === "model-picker")
	const [pickingModelKey, setPickingModelKey] = useState<"actModelId" | "planModelId" | null>(
		initialMode ? (initialModelKey ?? "actModelId") : null,
	)
	const [isPickingProvider, setIsPickingProvider] = useState(false)
	const [isEnteringApiKey, setIsEnteringApiKey] = useState(false)
	const [apiKeyValue, setApiKeyValue] = useState("")

	// Settings state
	const features = useMemo<Record<FeatureKey, boolean>>(() => {
		const result: any = {}
		for (const [key, config] of Object.entries(FEATURE_SETTINGS)) {
			result[key] = isSettingsKey(config.stateKey)
				? stateManager.getGlobalSettingsKey(config.stateKey)
				: stateManager.getGlobalStateKey(config.stateKey)
		}
		return result
	}, [stateManager])

	const separateModels = useMemo<boolean>(
		() => stateManager.getGlobalSettingsKey("planActSeparateModelsSetting") ?? false,
		[stateManager],
	)
	const actThinkingEnabled = useMemo<boolean>(
		() => (stateManager.getGlobalSettingsKey("actModeThinkingBudgetTokens") ?? 0) > 0,
		[stateManager],
	)
	const planThinkingEnabled = useMemo<boolean>(
		() => (stateManager.getGlobalSettingsKey("planModeThinkingBudgetTokens") ?? 0) > 0,
		[stateManager],
	)
	const actReasoningEffort = useMemo<OpenaiReasoningEffort>(
		() => normalizeReasoningEffort(stateManager.getGlobalSettingsKey("actModeReasoningEffort")),
		[stateManager],
	)
	const planReasoningEffort = useMemo<OpenaiReasoningEffort>(
		() => normalizeReasoningEffort(stateManager.getGlobalSettingsKey("planModeReasoningEffort")),
		[stateManager],
	)

	const autoApproveSettings = useMemo<AutoApprovalSettings>(() => {
		return stateManager.getGlobalSettingsKey("autoApprovalSettings") ?? DEFAULT_AUTO_APPROVAL_SETTINGS
	}, [stateManager])

	const preferredLanguage = useMemo<string>(
		() => (stateManager.getGlobalSettingsKey("preferredLanguage") as string) || "English",
		[stateManager],
	)
	const telemetry = useMemo<TelemetrySetting>(
		() => (stateManager.getGlobalSettingsKey("telemetrySetting") as TelemetrySetting) || "unset",
		[stateManager],
	)

	const [provider, setProvider] = useState<string>(
		() => stateManager.getApiConfiguration().actModeApiProvider || "not configured",
	)
	const [_modelRefreshKey, setModelRefreshKey] = useState(0)
	const refreshModelIds = useCallback(() => setModelRefreshKey((k) => k + 1), [])

	const handleOcaAuthSuccess = useCallback(async () => {
		await applyProviderConfig({ providerId: "oca", controller })
		if (controller) await refreshOcaModels(controller, { provider: ApiProvider.OCA })
		setProvider("oca")
		refreshModelIds()
	}, [controller, refreshModelIds])

	const { startAuth: startOcaAuth } = useOcaAuth({ controller, onSuccess: handleOcaAuthSuccess })

	const { actModelId, planModelId } = useMemo(() => {
		const apiConfig = stateManager.getApiConfiguration()
		const actProvider = apiConfig.actModeApiProvider
		const planProvider = apiConfig.planModeApiProvider || apiConfig.actModeApiProvider

		const actKey = actProvider ? getProviderModelIdKey(actProvider, "act") : null
		const planKey = planProvider ? getProviderModelIdKey(planProvider, "plan") : null

		return {
			actModelId: actKey && isSettingsKey(actKey) ? (stateManager.getGlobalSettingsKey(actKey) as string) || "" : "",
			planModelId: planKey && isSettingsKey(planKey) ? (stateManager.getGlobalSettingsKey(planKey) as string) || "" : "",
		}
	}, [stateManager])

	const items: ListItem[] = useMemo(() => {
		switch (currentTab) {
			case "api":
				return [
					{ key: "provider", label: "Provider", type: "editable" as ListItemType, value: provider },
					...(separateModels
						? [
								{ key: "actModelId", label: "Act Model ID", type: "editable" as ListItemType, value: actModelId },
								{
									key: "planModelId",
									label: "Plan Model ID",
									type: "editable" as ListItemType,
									value: planModelId,
								},
							]
						: [{ key: "actModelId", label: "Model ID", type: "editable" as ListItemType, value: actModelId }]),
					{ key: "separateModels", label: "Separate Models", type: "checkbox" as ListItemType, value: separateModels },
				]
			case "auto-approve":
				return Object.keys(autoApproveSettings.actions).map((k) => ({
					key: k,
					label: k,
					type: "checkbox" as ListItemType,
					value: true,
				}))
			case "features":
				return Object.keys(FEATURE_SETTINGS).map((k) => ({
					key: k,
					label: k,
					type: "checkbox" as ListItemType,
					value: true,
				}))
			case "account":
				return [
					{ key: "login", label: "Login", type: "action" as ListItemType, value: "" },
					{ key: "logout", label: "Logout", type: "action" as ListItemType, value: "" },
				]
			default:
				return []
		}
	}, [currentTab, provider, actModelId, planModelId, separateModels, autoApproveSettings])

	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) return
			if (isPickingModel || isPickingProvider || isEnteringApiKey) return

			if (key.upArrow) setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1))
			if (key.downArrow) setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0))
			if (key.leftArrow || key.rightArrow) {
				const tabIdx = TABS.findIndex((t) => t.key === currentTab)
				const nextIdx = key.leftArrow
					? tabIdx > 0
						? tabIdx - 1
						: TABS.length - 1
					: tabIdx < TABS.length - 1
						? tabIdx + 1
						: 0
				setCurrentTab(TABS[nextIdx].key as SettingsTab)
				setSelectedIndex(0)
			}
			if (key.escape) onClose()

			if (key.return) {
				const item = items[selectedIndex]
				if (!item) return

				if (item.key === "provider") setIsPickingProvider(true)
				if (item.key === "actModelId") {
					setPickingModelKey("actModelId")
					setIsPickingModel(true)
				}
				if (item.key === "planModelId") {
					setPickingModelKey("planModelId")
					setIsPickingModel(true)
				}
			}
		},
		{ isActive: isRawModeSupported },
	)

	if (isPickingProvider) {
		return (
			<ProviderPicker
				onSelect={(p) => {
					setProvider(p)
					setIsPickingProvider(false)
					if (p === "oca") startOcaAuth()
					else if (p !== "codemarie") setIsEnteringApiKey(true)
				}}
			/>
		)
	}

	if (isEnteringApiKey) {
		return (
			<ApiKeyInput
				onCancel={() => setIsEnteringApiKey(false)}
				onChange={setApiKeyValue}
				onSubmit={async (key) => {
					await applyProviderConfig({ providerId: provider, apiKey: key, controller })
					setIsEnteringApiKey(false)
					refreshModelIds()
				}}
				providerName={getProviderLabel(provider)}
				value={apiKeyValue}
			/>
		)
	}

	if (isPickingModel && controller) {
		return (
			<ModelPicker
				controller={controller}
				onChange={() => {}}
				onSubmit={async (m) => {
					const key = getProviderModelIdKey(provider as any, pickingModelKey === "actModelId" ? "act" : "plan")
					if (key) stateManager.setGlobalState(key, m)
					setIsPickingModel(false)
					refreshModelIds()
				}}
				provider={provider}
			/>
		)
	}

	let tabContent: React.ReactNode
	switch (currentTab) {
		case "api":
			tabContent = (
				<ApiSettingsTab
					actModelId={actModelId}
					actReasoningEffort={actReasoningEffort}
					actThinkingEnabled={actThinkingEnabled}
					onChangeActReasoningEffort={() => {}}
					onChangePlanReasoningEffort={() => {}}
					onToggleActThinking={() => {}}
					onTogglePlanThinking={() => {}}
					onToggleSeparateModels={() => {}}
					planModelId={planModelId}
					planReasoningEffort={planReasoningEffort}
					planThinkingEnabled={planThinkingEnabled}
					provider={provider}
					separateModels={separateModels}
				/>
			)
			break
		case "auto-approve":
			tabContent = (
				<AutoApproveSettingsTab
					onToggleAction={() => {}}
					onToggleNotification={() => {}}
					settings={autoApproveSettings}
				/>
			)
			break
		case "features":
			tabContent = <FeaturesSettingsTab features={features} onToggle={() => {}} />
			break
		case "mcp":
			tabContent = <McpSettingsTab controller={controller} />
			break
		case "hooks":
			tabContent = <HooksSettingsTab globalHooks={globalHooks} workspaceHooks={workspaceHooks} />
			break
		case "skills":
			tabContent = <SkillsSettingsTab globalSkills={globalSkills} localSkills={localSkills} />
			break
		case "account":
			tabContent = <AccountSettingsTab controller={controller} />
			break
		case "other":
			tabContent = (
				<OtherSettingsTab
					onToggleTelemetry={() => {}}
					preferredLanguage={preferredLanguage}
					telemetry={telemetry}
					version={CLI_VERSION}
				/>
			)
			break
	}

	return (
		<Panel currentTab={currentTab} label="Settings" tabs={TABS}>
			{tabContent}
		</Panel>
	)
}
