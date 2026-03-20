import { AlertCircleIcon, AlertTriangleIcon, InfoIcon } from "lucide-react"
import React from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useNotifications } from "@/context/NotificationContext"

export const NotificationCenter: React.FC = () => {
	const { notifications, dismissNotification } = useNotifications()

	if (notifications.length === 0) {
		return null
	}

	return (
		<div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
			{notifications.map((n) => {
				const Icon = n.type === "info" ? InfoIcon : n.type === "warning" ? AlertTriangleIcon : AlertCircleIcon
				const variant = n.type === "info" ? "default" : n.type === "warning" ? "warning" : "danger"

				return (
					<Alert
						className="pointer-events-auto shadow-lg"
						icon={<Icon className="size-4" />}
						id={n.id}
						key={n.id}
						onClose={() => dismissNotification(n.id)}
						title={n.type.toUpperCase()}
						variant={variant}>
						<AlertDescription>{n.message}</AlertDescription>
					</Alert>
				)
			})}
		</div>
	)
}
