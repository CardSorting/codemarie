import { requestyDefaultModelId, requestyDefaultModelInfo } from "@shared/api"
import { toRequestyServiceUrl } from "@shared/clients/requesty"
import { EmptyRequest } from "@shared/proto/codemarie/common"
import { Mode } from "@shared/storage/types"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Fzf } from "fzf"
import React, { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import styled from "styled-components"
import { useMount } from "@/hooks/useLifecycle"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { SystemServiceClient } from "../../services/protobus-client"
import { highlight } from "../history/HistoryView"
import { ModelInfoView } from "./common/ModelInfoView"
import ThinkingBudgetSlider from "./ThinkingBudgetSlider"
import { getModeSpecificFields, normalizeApiConfiguration } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

export interface RequestyModelPickerProps {
	isPopup?: boolean
	baseUrl?: string
	currentMode: Mode
}

const RequestyModelPicker: React.FC<RequestyModelPickerProps> = ({ isPopup, baseUrl, currentMode }) => {
	const { apiConfiguration, requestyModels, setRequestyModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.requestyModelId || requestyDefaultModelId)
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const resolvedUrl = toRequestyServiceUrl(baseUrl)
	const requestyModelListUrl = resolvedUrl != null ? new URL("models", resolvedUrl) : undefined

	const handleModelChange = (newModelId: string) => {
		// could be setting invalid model id/undefined info but validation will catch it

		handleModeFieldsChange(
			{
				requestyModelId: {
					plan: "planModeRequestyModelId",
					act: "actModeRequestyModelId",
				},
				requestyModelInfo: {
					plan: "planModeRequestyModelInfo",
					act: "actModeRequestyModelInfo",
				},
			},
			{
				requestyModelId: newModelId,
				requestyModelInfo: requestyModels[newModelId],
			},
			currentMode,
		)
		setSearchTerm(newModelId)
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration, currentMode)
	}, [apiConfiguration, currentMode])

	useMount(() => {
		SystemServiceClient.refreshRequestyModels(EmptyRequest.create({}))
			.then((response) => {
				setRequestyModels({
					[requestyDefaultModelId]: requestyDefaultModelInfo,
					...response.models,
				})
			})
			.catch((err) => {
				console.error("Failed to refresh Requesty models:", err)
			})
	})

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [])

	const modelIds = useMemo(() => {
		return Object.keys(requestyModels).sort((a, b) => a.localeCompare(b))
	}, [requestyModels])

	const searchableItems = useMemo(() => {
		return modelIds.map((id) => ({
			id,
			html: id,
		}))
	}, [modelIds])

	const fzf = useMemo(() => {
		return new Fzf(searchableItems, {
			selector: (item) => item.html,
		})
	}, [searchableItems])

	const modelSearchResults = useMemo(() => {
		return searchTerm ? highlight(fzf.find(searchTerm), "html", "model-item-highlight") : searchableItems
	}, [searchableItems, searchTerm, fzf])

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) {
			return
		}

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setSelectedIndex((prev) => (prev < modelSearchResults.length - 1 ? prev + 1 : prev))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
				break
			case "Enter":
				event.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < modelSearchResults.length) {
					handleModelChange(modelSearchResults[selectedIndex].id)
					setIsDropdownVisible(false)
				}
				break
			case "Escape":
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
				break
		}
	}

	const hasInfo = useMemo(() => {
		try {
			return modelIds.some((id) => id.toLowerCase() === searchTerm.toLowerCase())
		} catch {
			return false
		}
	}, [modelIds, searchTerm])

	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0
		}
	}, [])

	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			})
		}
	}, [selectedIndex])

	const showBudgetSlider = useMemo(() => {
		return selectedModelId?.includes("claude-3-7-sonnet")
	}, [selectedModelId])

	return (
		<div style={{ width: "100%" }}>
			<style>
				{`
				.model-item-highlight {
					background-color: var(--vscode-editor-findMatchHighlightBackground);
					color: inherit;
				}
				`}
			</style>
			<div style={{ display: "flex", flexDirection: "column" }}>
				<label htmlFor="model-search">
					<span style={{ fontWeight: 500 }}>Model</span>
				</label>
				<DropdownWrapper ref={dropdownRef}>
					<VSCodeTextField
						id="model-search"
						onFocus={() => setIsDropdownVisible(true)}
						onInput={(e) => {
							handleModelChange((e.target as HTMLInputElement)?.value?.toLowerCase())
							setIsDropdownVisible(true)
						}}
						onKeyDown={handleKeyDown}
						placeholder="Search and select a model..."
						role="combobox"
						style={{
							width: "100%",
							zIndex: REQUESTY_MODEL_PICKER_Z_INDEX,
							position: "relative",
						}}
						value={searchTerm}>
						{searchTerm && (
							<div
								aria-label="Clear search"
								className="input-icon-button codicon codicon-close"
								onClick={() => {
									handleModelChange("")
									setIsDropdownVisible(true)
								}}
								slot="end"
								style={{
									display: "flex",
									justifyContent: "center",
									alignItems: "center",
									height: "100%",
								}}
							/>
						)}
					</VSCodeTextField>
					{isDropdownVisible && (
						<div
							className="absolute top-[calc(100%-3px)] left-0 w-[calc(100%-2px)] max-h-[200px] overflow-y-auto bg-(--vscode-dropdown-background) border border-(--vscode-list-activeSelectionBackground) z-999 rounded-b-[3px]"
							ref={dropdownListRef}
							role="listbox">
							{modelSearchResults.map((item, index) => (
								<div
									className={`p-[5px_10px] cursor-pointer break-all whitespace-normal ${
										index === selectedIndex ? "bg-(--vscode-list-activeSelectionBackground)" : ""
									} hover:bg-(--vscode-list-activeSelectionBackground)`}
									dangerouslySetInnerHTML={{
										__html: item.html,
									}}
									key={item.id}
									onClick={() => {
										handleModelChange(item.id)
										setIsDropdownVisible(false)
									}}
									onMouseEnter={() => setSelectedIndex(index)}
									ref={(el: HTMLDivElement | null) => (itemRefs.current[index] = el)}
									role="option"
								/>
							))}
						</div>
					)}
				</DropdownWrapper>
			</div>

			{hasInfo ? (
				<>
					{showBudgetSlider && <ThinkingBudgetSlider currentMode={currentMode} />}
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			) : (
				<p
					style={{
						fontSize: "12px",
						marginTop: 0,
						color: "var(--vscode-descriptionForeground)",
					}}>
					The extension automatically fetches the latest list of models available on{" "}
					<VSCodeLink href={requestyModelListUrl?.toString()} style={{ display: "inline", fontSize: "inherit" }}>
						Requesty.
					</VSCodeLink>
					If you're unsure which model to choose, Codemarie works best with{" "}
					<VSCodeLink
						onClick={() => handleModelChange("anthropic/claude-3-7-sonnet-latest")}
						style={{ display: "inline", fontSize: "inherit" }}>
						anthropic/claude-3-7-sonnet-latest.
					</VSCodeLink>
				</p>
			)}
		</div>
	)
}

export default RequestyModelPicker

// Dropdown

const DropdownWrapper = styled.div`
  position: relative;
  width: 100%;
`

export const REQUESTY_MODEL_PICKER_Z_INDEX = 1_000
