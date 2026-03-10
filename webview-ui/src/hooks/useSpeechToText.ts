import { useCallback, useEffect, useRef, useState } from "react"

export interface SpeechToTextHook {
	isListening: boolean
	startListening: () => void
	stopListening: () => void
	transcript: string
	interimTranscript: string
	error: string | null
	volume: number
}

export const useSpeechToText = (onResult?: (transcript: string) => void): SpeechToTextHook => {
	const [isListening, setIsListening] = useState(false)
	const [transcript, setTranscript] = useState("")
	const [interimTranscript, setInterimTranscript] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [volume, setVolume] = useState(0)

	const recognitionRef = useRef<any>(null)
	const audioContextRef = useRef<AudioContext | null>(null)
	const analyserRef = useRef<AnalyserNode | null>(null)
	const animationFrameRef = useRef<number | null>(null)
	const streamRef = useRef<MediaStream | null>(null)

	const cleanupAudio = useCallback(() => {
		if (animationFrameRef.current) {
			cancelAnimationFrame(animationFrameRef.current)
			animationFrameRef.current = null
		}
		if (audioContextRef.current) {
			audioContextRef.current.close().catch(console.error)
			audioContextRef.current = null
		}
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((track) => track.stop())
			streamRef.current = null
		}
		setVolume(0)
	}, [])

	const startAudioMonitoring = useCallback(async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
			streamRef.current = stream

			const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext
			const audioContext = new AudioContextClass()
			audioContextRef.current = audioContext

			const analyser = audioContext.createAnalyser()
			analyser.fftSize = 256
			analyserRef.current = analyser

			const source = audioContext.createMediaStreamSource(stream)
			source.connect(analyser)

			const dataArray = new Uint8Array(analyser.frequencyBinCount)
			const updateVolume = () => {
				if (!analyserRef.current) return
				analyserRef.current.getByteFrequencyData(dataArray)
				let sum = 0
				for (let i = 0; i < dataArray.length; i++) {
					sum += dataArray[i]
				}
				const average = sum / dataArray.length
				setVolume(Math.min(100, Math.round((average / 128) * 100)))
				animationFrameRef.current = requestAnimationFrame(updateVolume)
			}
			updateVolume()
		} catch (err) {
			console.error("Error starting audio monitoring:", err)
		}
	}, [])

	useEffect(() => {
		const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
		if (!SpeechRecognition) {
			setError("Speech recognition is not supported in this browser.")
			return
		}

		const recognition = new SpeechRecognition()
		recognition.continuous = true
		recognition.interimResults = true
		recognition.lang = "en-US"

		recognition.onstart = () => {
			setIsListening(true)
			setError(null)
			startAudioMonitoring()
		}

		recognition.onresult = (event: any) => {
			let currentInterim = ""
			let currentFinal = ""

			for (let i = event.resultIndex; i < event.results.length; ++i) {
				const result = event.results[i]
				if (result.isFinal) {
					currentFinal += result[0].transcript
				} else {
					currentInterim += result[0].transcript
				}
			}

			setInterimTranscript(currentInterim)
			if (currentFinal) {
				setTranscript((prev) => prev + currentFinal)
				if (onResult) {
					onResult(currentFinal)
				}
			}
		}

		recognition.onerror = (event: any) => {
			console.error("Speech recognition error:", event.error)
			setError(event.error)
			setIsListening(false)
			cleanupAudio()
		}

		recognition.onend = () => {
			setIsListening(false)
			setInterimTranscript("")
			cleanupAudio()
		}

		recognitionRef.current = recognition

		return () => {
			if (recognitionRef.current) {
				recognitionRef.current.stop()
			}
			cleanupAudio()
		}
	}, [onResult, startAudioMonitoring, cleanupAudio])

	const startListening = useCallback(() => {
		if (recognitionRef.current && !isListening) {
			setTranscript("") // Clear transcript for new session
			setInterimTranscript("")
			recognitionRef.current.lang = navigator.language || "en-US"
			try {
				recognitionRef.current.start()
			} catch (err) {
				console.error("Failed to start speech recognition:", err)
			}
		}
	}, [isListening])

	const stopListening = useCallback(() => {
		if (recognitionRef.current && isListening) {
			recognitionRef.current.stop()
		}
	}, [isListening])

	return {
		isListening,
		startListening,
		stopListening,
		transcript,
		interimTranscript,
		error,
		volume,
	}
}
