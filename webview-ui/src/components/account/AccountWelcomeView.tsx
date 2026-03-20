import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useAuth } from "@/context/AuthContext"
import { useGlobalState } from "@/context/GlobalStateContext"
import CodemarieLogoVariable from "../../assets/CodemarieLogoVariable"

export const AccountWelcomeView = () => {
	const { environment } = useGlobalState()
	const { isLoginLoading, handleSignIn } = useAuth()

	return (
		<div className="flex flex-col items-center gap-2.5">
			<CodemarieLogoVariable className="size-16 mb-4" environment={environment} />

			<p>
				Sign up for an account to get access to the latest models, billing dashboard to view usage and credits, and more
				upcoming features.
			</p>

			<VSCodeButton className="w-full mb-4" disabled={isLoginLoading} onClick={handleSignIn}>
				Sign up with Codemarie
				{isLoginLoading && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh" />
					</span>
				)}
			</VSCodeButton>

			<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">
				By continuing, you agree to the <VSCodeLink href="https://codemarie.bot/tos">Terms of Service</VSCodeLink> and{" "}
				<VSCodeLink href="https://codemarie.bot/privacy">Privacy Policy.</VSCodeLink>
			</p>
		</div>
	)
}
