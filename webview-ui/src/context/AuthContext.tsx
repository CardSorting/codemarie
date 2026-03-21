import { type AuthState, SignInRequest, SignOutRequest, type UserOrganization } from "@shared/proto/codemarie/account"
import { EmptyRequest } from "@shared/proto/codemarie/common"
import deepEqual from "fast-deep-equal"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { AccountServiceClient } from "../services/protobus-client"

export interface CodemarieUser {
	uid: string
	email?: string
	displayName?: string
	photoUrl?: string
	appBaseUrl?: string
}

export interface AuthContextType {
	user: CodemarieUser | null
	userOrganizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
	isLoginLoading: boolean
	setUser: React.Dispatch<React.SetStateAction<CodemarieUser | null>>
	getUserOrganizations: () => Promise<void>
	handleSignIn: () => void
	handleSignOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [user, setUser] = useState<CodemarieUser | null>(null)
	const [userOrganizations, setUserOrganizations] = useState<UserOrganization[] | null>(null)
	const [isLoginLoading, setIsLoginLoading] = useState(false)

	const getUserOrganizations = useCallback(async () => {
		try {
			const response = await AccountServiceClient.getUserOrganizations(EmptyRequest.create())
			setUserOrganizations((old) => {
				if (!deepEqual(response.organizations, old)) {
					return response.organizations
				}
				return old
			})
		} catch (error) {
			console.error("Failed to fetch user organizations:", error)
		}
	}, [])

	const activeOrganization = useMemo(() => {
		return userOrganizations?.find((org) => org.active) ?? null
	}, [userOrganizations])

	const handleSignIn = useCallback(() => {
		try {
			setIsLoginLoading(true)
			AccountServiceClient.signIn(SignInRequest.create({}))
				.catch((err: Error) => console.error("Failed to sign in:", err))
				.finally(() => {
					setIsLoginLoading(false)
				})
		} catch (error) {
			console.error("Error signing in:", error)
		}
	}, [])

	const handleSignOut = useCallback(async () => {
		try {
			await AccountServiceClient.signOut(SignOutRequest.create({})).catch((err: Error) =>
				console.error("Failed to logout:", err),
			)
		} catch (error) {
			console.error("Error signing out:", error)
			throw error
		}
	}, [])

	// Handle auth status update events
	useEffect(() => {
		const cancelSubscription = AccountServiceClient.subscribeToAuthStatusUpdate(EmptyRequest.create(), {
			onResponse: async (response: AuthState) => {
				setUser((oldUser) => {
					if (!response?.user?.uid) {
						return null
					}

					if (response?.user && oldUser?.uid !== response.user.uid) {
						// Once we have a new user, fetch organizations
						getUserOrganizations()
						return response.user
					}

					return oldUser
				})
			},
			onError: (error: Error) => {
				console.error("Error in auth callback subscription:", error)
			},
			onComplete: () => {
				console.log("Auth callback subscription completed")
			},
		})

		return () => {
			cancelSubscription()
		}
	}, [getUserOrganizations])

	return (
		<AuthContext.Provider
			value={{
				user,
				userOrganizations,
				activeOrganization,
				isLoginLoading,
				setUser,
				getUserOrganizations,
				handleSignIn,
				handleSignOut,
			}}>
			{children}
		</AuthContext.Provider>
	)
}

export const useAuth = () => {
	const context = useContext(AuthContext)
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider")
	}
	return context
}
