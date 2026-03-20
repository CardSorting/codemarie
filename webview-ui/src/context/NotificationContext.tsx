import type React from "react"
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { UiServiceClient } from "../services/protobus-client"

export interface Notification {
	id: string
	type: "info" | "warning" | "error"
	message: string
}

export interface NotificationContextType {
	notifications: Notification[]
	addNotification: (type: "info" | "warning" | "error", message: string) => void
	dismissNotification: (id: string) => void
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined)

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [notifications, setNotifications] = useState<Notification[]>([])

	const addNotification = useCallback((type: "info" | "warning" | "error", message: string) => {
		setNotifications((prev) => [...prev, { id: crypto.randomUUID(), type, message }])
	}, [])

	const dismissNotification = useCallback((id: string) => {
		setNotifications((prev) => prev.filter((n) => n.id !== id))
	}, [])

	// Register the ProtoBus notification handler
	useEffect(() => {
		const ProtoBusClientBase = Object.getPrototypeOf(UiServiceClient)
		if (ProtoBusClientBase.setNotificationHandler) {
			ProtoBusClientBase.setNotificationHandler(addNotification)
		}
	}, [addNotification])

	return (
		<NotificationContext.Provider
			value={{
				notifications,
				addNotification,
				dismissNotification,
			}}>
			{children}
		</NotificationContext.Provider>
	)
}

export const useNotifications = () => {
	const context = useContext(NotificationContext)
	if (context === undefined) {
		throw new Error("useNotifications must be used within a NotificationProvider")
	}
	return context
}
