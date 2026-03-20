import { useCallback, useEffect, useState } from "react"

interface UseTextAreaHeightProps {
	selectedImages: string[]
	selectedFiles: string[]
	onHeightChange?: (height: number) => void
}

export const useTextAreaHeight = ({ selectedImages, selectedFiles, onHeightChange }: UseTextAreaHeightProps) => {
	const [thumbnailsHeight, setThumbnailsHeight] = useState(0)
	const [textAreaBaseHeight, setTextAreaBaseHeight] = useState<number | undefined>(undefined)

	const handleThumbnailsHeightChange = useCallback((height: number) => {
		setThumbnailsHeight(height)
	}, [])

	useEffect(() => {
		if (selectedImages.length === 0 && selectedFiles.length === 0) {
			setThumbnailsHeight(0)
		}
	}, [selectedImages, selectedFiles])

	const handleTextAreaHeightChange = useCallback(
		(height: number) => {
			if (textAreaBaseHeight === undefined || height < textAreaBaseHeight) {
				setTextAreaBaseHeight(height)
			}
			onHeightChange?.(height)
		},
		[textAreaBaseHeight, onHeightChange],
	)

	return {
		thumbnailsHeight,
		textAreaBaseHeight,
		handleThumbnailsHeightChange,
		handleTextAreaHeightChange,
	}
}
