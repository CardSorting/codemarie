import React, { createContext } from "react"
import { useExtensionState } from "./ExtensionStateContext"

export interface CodemarieAuthContextType {
	codemarieUser: any
	organizations: any[] | null
	activeOrganization: any | null
	isLoginLoading: boolean
	handleSignIn: () => void
	handleSignOut: () => Promise<void>
}

export const CodemarieAuthContext = createContext<CodemarieAuthContextType | undefined>(undefined)

export const useCodemarieAuth = () => {
	const { codemarieUser, organizations, activeOrganization } = useExtensionState()
	return { codemarieUser, organizations, activeOrganization }
}

export const useCodemarieSignIn = () => {
	const { isLoginLoading, handleSignIn } = useExtensionState()
	return { isLoginLoading, handleSignIn }
}

export const CodemarieAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { codemarieUser, organizations, activeOrganization, isLoginLoading, handleSignIn, handleSignOut } = useExtensionState()

	return (
		<CodemarieAuthContext.Provider
			value={{
				codemarieUser,
				organizations,
				activeOrganization,
				isLoginLoading,
				handleSignIn,
				handleSignOut,
			}}>
			{children}
		</CodemarieAuthContext.Provider>
	)
}
