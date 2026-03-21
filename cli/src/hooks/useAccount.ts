import { useCallback, useEffect, useState } from "react"
import { Controller } from "@/core/controller"
import { CodemarieAccountService } from "@/services/account/CodemarieAccountService"
import { AuthService, CodemarieAccountOrganization } from "@/services/auth/AuthService"
import { applyProviderConfig } from "../utils/provider-config"

export interface UseAccountReturn {
	email: string | null
	balance: number | null
	organization: CodemarieAccountOrganization | null
	organizations: CodemarieAccountOrganization[] | null
	isLoading: boolean
	isWaitingForAuth: boolean
	fetchInfo: () => Promise<void>
	login: () => void
	logout: () => Promise<void>
	switchOrganization: (orgId: string | null) => Promise<void>
}

export function useAccount(controller: Controller | undefined): UseAccountReturn {
	const [email, setEmail] = useState<string | null>(null)
	const [balance, setBalance] = useState<number | null>(null)
	const [organization, setOrganization] = useState<CodemarieAccountOrganization | null>(null)
	const [organizations, setOrganizations] = useState<CodemarieAccountOrganization[] | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [isWaitingForAuth, setIsWaitingForAuth] = useState(false)
	const [hasChecked, setHasChecked] = useState(false)

	const fetchInfo = useCallback(async () => {
		if (!controller) return

		try {
			setIsLoading(true)
			const authService = AuthService.getInstance(controller)

			// Wait for auth to be restored
			let authInfo = authService.getInfo()
			let attempts = 0
			const maxAttempts = 20
			while (!authInfo?.user?.uid && attempts < maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, 100))
				authInfo = authService.getInfo()
				attempts++
			}

			if (authInfo?.user?.email) {
				setEmail(authInfo.user.email)
			} else {
				setEmail(null)
				setIsLoading(false)
				return
			}

			const accountService = CodemarieAccountService.getInstance()
			const fetchedOrgs = await accountService.fetchUserOrganizationsRPC()

			if (fetchedOrgs) {
				setOrganizations(fetchedOrgs)
				const activeOrg = fetchedOrgs.find((org) => org.active)
				setOrganization(activeOrg || null)

				const orgId = activeOrg?.organizationId
				try {
					const balanceData = orgId
						? await accountService.fetchOrganizationCreditsRPC(orgId)
						: await accountService.fetchBalanceRPC()

					if (balanceData?.balance !== undefined) {
						setBalance(balanceData.balance)
					}
				} catch (err) {
					console.error("Error fetching balance:", err)
				}
			}
		} catch (err) {
			console.error("Error fetching account info:", err)
		} finally {
			setIsLoading(false)
			setHasChecked(true)
		}
	}, [controller])

	const login = useCallback(() => {
		if (!controller) return
		setIsWaitingForAuth(true)
		AuthService.getInstance(controller)
			.createAuthRequest()
			.catch(() => setIsWaitingForAuth(false))
	}, [controller])

	const logout = useCallback(async () => {
		if (!controller) return
		await AuthService.getInstance(controller).handleDeauth()
		setEmail(null)
		setBalance(null)
		setOrganization(null)
		setOrganizations(null)
		setHasChecked(true)
	}, [controller])

	const switchOrganization = useCallback(
		async (orgId: string | null) => {
			if (!controller) return
			try {
				await CodemarieAccountService.getInstance().switchAccount(orgId || undefined)
				await fetchInfo()
			} catch (err) {
				console.error("Error switching organization:", err)
			}
		},
		[controller, fetchInfo],
	)

	// Automatically fetch info on mount or when controller changes if not already checked
	useEffect(() => {
		if (controller && !hasChecked && !isLoading && !isWaitingForAuth) {
			fetchInfo()
		}
	}, [controller, hasChecked, isLoading, isWaitingForAuth, fetchInfo])

	// Subscribe to auth status updates
	useEffect(() => {
		if (!isWaitingForAuth || !controller) return

		let cancelled = false
		const authService = AuthService.getInstance(controller)

		const responseHandler = async (authState: { user?: { email?: string } }) => {
			if (cancelled) return
			if (authState.user?.email) {
				setIsWaitingForAuth(false)
				setHasChecked(false) // Trigger re-fetch
				await applyProviderConfig({ providerId: "codemarie", controller })
				fetchInfo()
			}
		}

		const subscriptionId = `useAccount-auth-${Date.now()}`
		authService.subscribeToAuthStatusUpdate(controller, {}, responseHandler, subscriptionId)

		return () => {
			cancelled = true
		}
	}, [isWaitingForAuth, controller, fetchInfo])

	return {
		email,
		balance,
		organization,
		organizations,
		isLoading,
		isWaitingForAuth,
		fetchInfo,
		login,
		logout,
		switchOrganization,
	}
}
