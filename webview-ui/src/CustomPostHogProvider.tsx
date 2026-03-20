import { posthogConfig } from "@shared/services/config/posthog-config"
import { type ReactNode, useEffect, useState } from "react"
import { useExtensionState } from "./context/ExtensionStateContext"

export function CustomPostHogProvider({ children }: { children: ReactNode }) {
	const { distinctId, version, userInfo, environment, telemetrySetting } = useExtensionState()

	// Skip PostHog entirely in self-hosted mode or when environment is unknown (safety fallback)
	const isSelfHostedOrUnknown = !environment || environment === "selfHosted"

	// Match telemetry setting logic from backend
	const isTelemetryEnabled = telemetrySetting !== "disabled"
	const [isActive, setIsActive] = useState(false)
	// biome-ignore lint/suspicious/noExplicitAny: PostHog types are dynamic
	const [PostHogProvider, setPostHogProvider] = useState<any>(null)
	// biome-ignore lint/suspicious/noExplicitAny: PostHog types are dynamic
	const [posthogInstance, setPosthogInstance] = useState<any>(null)

	useEffect(() => {
		if (isSelfHostedOrUnknown || isActive || !isTelemetryEnabled || !posthogConfig.apiKey) {
			return
		}

		// Dynamically import posthog-js
		const initPostHog = async () => {
			try {
				const [posthogModule, posthogReactModule] = await Promise.all([import("posthog-js"), import("posthog-js/react")])

				const posthog = posthogModule.default
				const apiKey = posthogConfig.apiKey as string
				posthog.init(apiKey, {
					api_host: posthogConfig.host,
					ui_host: posthogConfig.uiHost,
					disable_session_recording: true,
					capture_pageview: false,
					capture_dead_clicks: true,
					// Feature flags should work regardless of telemetry opt-out
					advanced_disable_decide: false,
					// Autocapture should respect telemetry settings
					autocapture: false,
				})

				setPosthogInstance(posthog)
				setPostHogProvider(() => posthogReactModule.PostHogProvider)
				setIsActive(true)
			} catch (error) {
				console.error("Failed to initialize PostHog:", error)
			}
		}

		initPostHog()
	}, [isSelfHostedOrUnknown, isActive, isTelemetryEnabled])

	useEffect(() => {
		if (!isTelemetryEnabled || !isActive || !distinctId || !version || !posthogInstance) {
			return
		}

		posthogInstance.set_config({
			// biome-ignore lint/suspicious/noExplicitAny: PostHog payload type is complex
			before_send: (payload: any) => {
				// Only filter out events if telemetry is disabled, but allow feature flag requests
				if (!isTelemetryEnabled && payload?.event !== "$feature_flag_called") {
					return null
				}

				if (payload?.properties) {
					payload.properties.extension_version = version
					payload.properties.distinct_id = distinctId
				}
				return payload
			},
		})

		const optedIn = posthogInstance.has_opted_in_capturing()
		const optedOut = posthogInstance.has_opted_out_capturing()
		const args = {
			email: userInfo?.email,
			name: userInfo?.displayName,
		}
		if (isTelemetryEnabled && !optedIn) {
			posthogInstance.opt_in_capturing()
			posthogInstance.identify(distinctId, args)
		} else if (!isTelemetryEnabled && !optedOut) {
			// For feature flags to work, we need to identify the user even when telemetry is disabled
			posthogInstance.identify(distinctId, args)
			// Then opt out of capturing other events
			posthogInstance.opt_out_capturing()
		}
	}, [isActive, distinctId, version, userInfo?.displayName, userInfo?.email, posthogInstance, isTelemetryEnabled])

	if (PostHogProvider && posthogInstance) {
		return <PostHogProvider client={posthogInstance}>{children}</PostHogProvider>
	}

	return <>{children}</>
}
