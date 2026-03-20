import { RelativePathsRequest } from "@shared/proto/codemarie/file"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { CHAT_CONSTANTS } from "@/components/chat/constants"
import { FileServiceClient } from "@/services/protobus-client"
import { getImageDimensions } from "./useFilePaste"

const { MAX_IMAGES_AND_FILES_PER_MESSAGE } = CHAT_CONSTANTS

interface UseFileDragAndDropProps {
	inputValue: string
	setInputValue: (value: string) => void
	cursorPosition: number
	setCursorPosition: (pos: number) => void
	setIntendedCursorPosition: (pos: number | null) => void
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	selectedFiles: string[]
	shouldDisableFilesAndImages: boolean
	setPendingInsertions: React.Dispatch<React.SetStateAction<string[]>>
	textAreaRef: React.RefObject<HTMLTextAreaElement | null>
}

export const useFileDragAndDrop = ({
	inputValue,
	setInputValue,
	cursorPosition,
	setCursorPosition,
	setIntendedCursorPosition,
	selectedImages,
	setSelectedImages,
	selectedFiles,
	shouldDisableFilesAndImages,
	setPendingInsertions,
	textAreaRef,
}: UseFileDragAndDropProps) => {
	const [isDraggingOver, setIsDraggingOver] = useState(false)
	const [showUnsupportedFileError, setShowUnsupportedFileError] = useState(false)
	const unsupportedFileTimerRef = useRef<NodeJS.Timeout | null>(null)
	const [showDimensionError, setShowDimensionError] = useState(false)
	const dimensionErrorTimerRef = useRef<NodeJS.Timeout | null>(null)

	const showDimensionErrorMessage = useCallback(() => {
		setShowDimensionError(true)
		if (dimensionErrorTimerRef.current) {
			clearTimeout(dimensionErrorTimerRef.current)
		}
		dimensionErrorTimerRef.current = setTimeout(() => {
			setShowDimensionError(false)
			dimensionErrorTimerRef.current = null
		}, 3000)
	}, [])

	const showUnsupportedFileErrorMessage = useCallback(() => {
		setShowUnsupportedFileError(true)
		if (unsupportedFileTimerRef.current) {
			clearTimeout(unsupportedFileTimerRef.current)
		}
		unsupportedFileTimerRef.current = setTimeout(() => {
			setShowUnsupportedFileError(false)
			unsupportedFileTimerRef.current = null
		}, 3000)
	}, [])

	const handleDragEnter = (e: React.DragEvent) => {
		e.preventDefault()
		setIsDraggingOver(true)

		if (e.dataTransfer.types.includes("Files")) {
			const items = Array.from(e.dataTransfer.items)
			const hasNonImageFile = items.some((item) => {
				if (item.kind === "file") {
					const type = item.type.split("/")[0]
					return type !== "image"
				}
				return false
			})

			if (hasNonImageFile) {
				showUnsupportedFileErrorMessage()
			}
		}
	}

	const onDragOver = (e: React.DragEvent) => {
		e.preventDefault()
		if (!isDraggingOver) {
			setIsDraggingOver(true)
		}
	}

	const handleDragLeave = (e: React.DragEvent) => {
		e.preventDefault()
		const dropZone = e.currentTarget as HTMLElement
		if (!dropZone.contains(e.relatedTarget as Node)) {
			setIsDraggingOver(false)
		}
	}

	useEffect(() => {
		const handleGlobalDragEnd = () => {
			setIsDraggingOver(false)
		}

		document.addEventListener("dragend", handleGlobalDragEnd)

		return () => {
			document.removeEventListener("dragend", handleGlobalDragEnd)
		}
	}, [])

	const handleTextDrop = useCallback(
		(text: string) => {
			const newValue = inputValue.slice(0, cursorPosition) + text + inputValue.slice(cursorPosition)
			setInputValue(newValue)
			const newCursorPosition = cursorPosition + text.length
			setCursorPosition(newCursorPosition)
			setIntendedCursorPosition(newCursorPosition)
		},
		[inputValue, cursorPosition, setInputValue, setCursorPosition, setIntendedCursorPosition],
	)

	const readImageFiles = useCallback(
		(imageFiles: File[]): Promise<(string | null)[]> => {
			return Promise.all(
				imageFiles.map(
					(file) =>
						new Promise<string | null>((resolve) => {
							const reader = new FileReader()
							reader.onloadend = async () => {
								if (reader.error) {
									console.error("Error reading file:", reader.error)
									resolve(null)
								} else {
									const result = reader.result
									if (typeof result === "string") {
										try {
											await getImageDimensions(result)
											resolve(result)
										} catch (error) {
											console.warn((error as Error).message)
											showDimensionErrorMessage()
											resolve(null)
										}
									} else {
										resolve(null)
									}
								}
							}
							reader.readAsDataURL(file)
						}),
				),
			)
		},
		[showDimensionErrorMessage],
	)

	const onDrop = async (e: React.DragEvent) => {
		e.preventDefault()
		setIsDraggingOver(false)

		setShowUnsupportedFileError(false)
		if (unsupportedFileTimerRef.current) {
			clearTimeout(unsupportedFileTimerRef.current)
			unsupportedFileTimerRef.current = null
		}

		let uris: string[] = []
		const resourceUrlsData = e.dataTransfer.getData("resourceurls")
		const vscodeUriListData = e.dataTransfer.getData("application/vnd.code.uri-list")

		if (resourceUrlsData) {
			try {
				uris = JSON.parse(resourceUrlsData)
				uris = uris.map((uri) => decodeURIComponent(uri))
			} catch (error) {
				console.error("Failed to parse resourceurls JSON:", error)
				uris = []
			}
		}

		if (uris.length === 0 && vscodeUriListData) {
			uris = vscodeUriListData.split("\n").map((uri) => uri.trim())
		}

		const validUris = uris.filter(
			(uri) => uri && (uri.startsWith("vscode-file:") || uri.startsWith("file:") || uri.startsWith("vscode-remote:")),
		)

		if (validUris.length > 0) {
			setPendingInsertions([])
			let initialCursorPos = inputValue.length
			if (textAreaRef.current) {
				initialCursorPos = textAreaRef.current.selectionStart
			}
			setIntendedCursorPosition(initialCursorPos)

			FileServiceClient.getRelativePaths(RelativePathsRequest.create({ uris: validUris }))
				.then((response) => {
					if (response.paths.length > 0) {
						setPendingInsertions((prev) => [...prev, ...response.paths])
					}
				})
				.catch((error) => {
					console.error("Error getting relative paths:", error)
				})
			return
		}

		const text = e.dataTransfer.getData("text")
		if (text) {
			handleTextDrop(text)
			return
		}

		const files = Array.from(e.dataTransfer.files)
		const acceptedTypes = ["png", "jpeg", "webp"]
		const imageFiles = files.filter((file) => {
			const [type, subtype] = file.type.split("/")
			return type === "image" && acceptedTypes.includes(subtype)
		})

		if (shouldDisableFilesAndImages || imageFiles.length === 0) {
			return
		}

		const imageDataArray = await readImageFiles(imageFiles)
		const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

		if (dataUrls.length > 0) {
			const filesAndImagesLength = selectedImages.length + selectedFiles.length
			const availableSlots = MAX_IMAGES_AND_FILES_PER_MESSAGE - filesAndImagesLength

			if (availableSlots > 0) {
				const imagesToAdd = Math.min(dataUrls.length, availableSlots)
				setSelectedImages((prevImages) => [...prevImages, ...dataUrls.slice(0, imagesToAdd)])
			}
		} else {
			console.warn("No valid images were processed")
		}
	}

	return {
		handleDragEnter,
		onDragOver,
		handleDragLeave,
		onDrop,
		isDraggingOver,
		showUnsupportedFileError,
		showDimensionError,
	}
}
