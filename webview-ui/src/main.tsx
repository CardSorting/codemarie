import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./main.css"
import "./index.css"
import App from "./App.tsx"

console.log("[Webview] Bootstrapping React app...")

try {
	const rootElement = document.getElementById("root")
	if (!rootElement) {
		throw new Error("Failed to find root element")
	}

	createRoot(rootElement).render(
		<StrictMode>
			<App />
		</StrictMode>,
	)
	console.log("[Webview] React app rendered successfully")
} catch (error) {
	console.error("[Webview Crash]", error)
	const root = document.getElementById("root")
	if (root) {
		root.innerHTML = `<div style="padding: 20px; color: red;"><h1>Webview Crash</h1><pre>${error}</pre></div>`
	}
}
