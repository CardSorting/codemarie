import { useEffect, useState } from "react"
import { detectMetaKeyChar, detectOS, unknown } from "../utils/platformUtils"

export const useMetaKeyDetection = (platform: string) => {
	const [metaKeyChar, setMetaKeyChar] = useState(unknown)
	const [os, setOs] = useState(unknown)

	useEffect(() => {
		const detectedMetaKeyChar = detectMetaKeyChar(platform)
		const detectedOs = detectOS(platform)
		setMetaKeyChar(detectedMetaKeyChar)
		setOs(detectedOs)
	}, [platform])

	return [os, metaKeyChar]
}
