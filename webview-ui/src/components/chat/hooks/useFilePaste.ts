import type React from "react"
import { useCallback, useRef, useState } from "react"
import { CHAT_CONSTANTS } from "@/components/chat/constants"

const { MAX_IMAGES_AND_FILES_PER_MESSAGE } = CHAT_CONSTANTS

export const getImageDimensions = (dataUrl: string): Promise<{ width: number; height: number }> => {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => {
			if (img.naturalWidth > 7500 || img.naturalHeight > 7500) {
				reject(new Error("Image dimensions exceed maximum allowed size of 7500px."))
			} else {
				resolve({ width: img.naturalWidth, height: img.naturalHeight })
			}
		}
		img.onerror = (err) => {
			console.error("Failed to load image for dimension check:", err)
			reject(new Error("Failed to load image to check dimensions."))
		}
		img.src = dataUrl
	})
}

interface UseFilePasteProps {
	inputValue: string
	setInputValue: (value: string) => void
	cursorPosition: number
	setCursorPosition: (pos: number) => void
	setIntendedCursorPosition: (pos: number | null) => void
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	selectedFiles: string[]
	shouldDisableFilesAndImages: boolean
	setShowContextMenu: (show: boolean) => void
	textAreaRef: React.RefObject<HTMLTextAreaElement | null>
}

export const useFilePaste = ({
	inputValue,
	setInputValue,
	cursorPosition,
	setCursorPosition,
	setIntendedCursorPosition,
	selectedImages,
	setSelectedImages,
	selectedFiles,
	shouldDisableFilesAndImages,
	setShowContextMenu,
	textAreaRef,
}: UseFilePasteProps) => {
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

	const handlePaste = useCallback(
		async (e: React.ClipboardEvent) => {
			const items = e.clipboardData.items

			const pastedText = e.clipboardData.getData("text")
			// Check if the pasted content is a URL, add space after so user can easily delete if they don't want it
			const urlRegex = /^\S+:\/\/\S+$/
			if (urlRegex.test(pastedText.trim())) {
				e.preventDefault()
				const trimmedUrl = pastedText.trim()
				const newValue = `${inputValue.slice(0, cursorPosition) + trimmedUrl} ${inputValue.slice(cursorPosition)}`
				setInputValue(newValue)
				const newCursorPosition = cursorPosition + trimmedUrl.length + 1
				setCursorPosition(newCursorPosition)
				setIntendedCursorPosition(newCursorPosition)
				setShowContextMenu(false)

				// Scroll to new cursor position
				// https://stackoverflow.com/questions/29899364/how-do-you-scroll-to-the-position-of-the-cursor-in-a-textarea/40951875#40951875
				setTimeout(() => {
					if (textAreaRef.current) {
						textAreaRef.current.blur()
						textAreaRef.current.focus()
					}
				}, 0)
				return
			}

			const acceptedTypes = ["png", "jpeg", "webp"]
			const imageItems = Array.from(items).filter((item) => {
				const [type, subtype] = item.type.split("/")
				return type === "image" && acceptedTypes.includes(subtype)
			})
			if (!shouldDisableFilesAndImages && imageItems.length > 0) {
				e.preventDefault()
				const imagePromises = imageItems.map((item) => {
					return new Promise<string | null>((resolve) => {
						const blob = item.getAsFile()
						if (!blob) {
							resolve(null)
							return
						}
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
						reader.readAsDataURL(blob)
					})
				})
				const imageDataArray = await Promise.all(imagePromises)
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
		},
		[
			shouldDisableFilesAndImages,
			setSelectedImages,
			selectedImages,
			selectedFiles,
			cursorPosition,
			setInputValue,
			inputValue,
			showDimensionErrorMessage,
			setShowContextMenu,
			setIntendedCursorPosition,
			setCursorPosition,
			textAreaRef,
		],
	)

	return { handlePaste, showDimensionError }
}
