import React, { ErrorInfo, ReactNode } from "react"

interface Props {
	children: ReactNode
	fallback?: ReactNode
}

interface State {
	hasError: boolean
	error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
	constructor(props: Props) {
		super(props)
		this.state = { hasError: false, error: null }
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error }
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error("Uncaught error:", error, errorInfo)
	}

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback
			}

			return (
				<div className="p-4 m-4 border border-destructive bg-destructive/10 rounded-sm text-foreground">
					<h2 className="text-lg font-bold mb-2">Something went wrong</h2>
					<p className="text-sm opacity-90 mb-4">{this.state.error?.message || "An unexpected error occurred."}</p>
					<button
						className="px-3 py-1 bg-foreground text-background rounded-sm text-sm font-medium hover:opacity-90 transition-opacity"
						onClick={() => window.location.reload()}
						type="button">
						Reload Webview
					</button>
				</div>
			)
		}

		return this.props.children
	}
}
