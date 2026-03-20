import { ReactElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

export type Size = { width: number; height: number }

export const useSize = (
	element: ReactElement | ((state: Size) => ReactElement),
	{ width = 0, height = 0 }: Partial<Size> = {},
): [ReactElement, Size] => {
	const [state, setState] = useState<Size>({ width, height })

	const ref = useRef<HTMLElement | null>(null)

	const observer = useMemo(
		() =>
			new ResizeObserver((entries) => {
				const entry = entries[0]
				if (entry) {
					const { width, height } = entry.contentRect
					setState({ width, height })
				}
			}),
		[],
	)

	useLayoutEffect(() => {
		const { current: el } = ref
		if (el) {
			observer.observe(el)
			return () => observer.disconnect()
		}
	}, [observer])

	const patchedElement = useMemo(() => {
		const el = typeof element === "function" ? element(state) : element
		const { ref: originalRef } = el as any

		return {
			...el,
			ref: (node: HTMLElement | null) => {
				ref.current = node
				if (typeof originalRef === "function") {
					originalRef(node)
				} else if (originalRef) {
					originalRef.current = node
				}
			},
		}
	}, [element, state])

	return [patchedElement, state]
}

export const useEvent = (
	name: string,
	handler: (...args: any[]) => void,
	target: EventTarget | Window = window,
	options?: boolean | AddEventListenerOptions,
) => {
	useEffect(() => {
		if (!target) return
		target.addEventListener(name, handler, options)
		return () => {
			target.removeEventListener(name, handler, options)
		}
	}, [name, handler, target, options])
}
