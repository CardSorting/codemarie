import { AuthService } from "@services/auth/AuthService"
import { OcaAuthService } from "@services/auth/oca/OcaAuthService"
import { AuthState } from "@/shared/proto/codemarie/account"
import { EmptyRequest } from "@/shared/proto/codemarie/common"
import { Controller } from ".."
import { StreamingResponseHandler } from "../protobus-handler"

export async function subscribeToAuthStatusUpdate(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler<AuthState>,
	requestId?: string,
): Promise<void> {
	const authService = AuthService.getInstance(controller)
	const ocaAuthService = OcaAuthService.getInstance()

	const sendCombinedUpdate = async () => {
		const authInfo = authService.getInfo()
		const ocaInfo = ocaAuthService.getInfo()

		await responseStream(
			AuthState.fromPartial({
				user: authInfo.user,
				ocaUser: ocaInfo.user
					? {
							user: ocaInfo.user,
						}
					: undefined,
			}),
			false,
		)
	}

	// Subscribe to both services
	// Note: We're reusing the streaming handlers but wrapping them
	await authService.subscribeToAuthStatusUpdate(controller, request, sendCombinedUpdate, requestId)
	await ocaAuthService.subscribeToAuthStatusUpdate(request, sendCombinedUpdate, requestId)
}
