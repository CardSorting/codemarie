import { RefObject, useEffect, useRef, useState } from "react"

export const useWindowSize = () => {
	const [state, setState] = useState<{ width: number; height: number }>({
		width: window.innerWidth,
		height: window.innerHeight,
	})

	useEffect(() => {
		const handler = () => {
			setState({
				width: window.innerWidth,
				height: window.innerHeight,
			})
		}
		window.addEventListener("resize", handler)
		return () => window.removeEventListener("resize", handler)
	}, [])

	return state
}

const defaultEvents = ["mousedown", "touchstart"]

export const useClickAway = <E extends Event = Event>(
	ref: RefObject<HTMLElement | null>,
	onClickAway: (event: E) => void,
	events: string[] = defaultEvents,
) => {
	const savedCallback = useRef(onClickAway)

	useEffect(() => {
		savedCallback.current = onClickAway
	}, [onClickAway])

	useEffect(() => {
		const handler = (event: any) => {
			const { current: el } = ref
			el && !el.contains(event.target) && savedCallback.current(event)
		}

		for (const eventName of events) {
			document.addEventListener(eventName, handler)
		}

		return () => {
			for (const eventName of events) {
				document.removeEventListener(eventName, handler)
			}
		}
	}, [events, ref])
}
