import { AuthService } from "@services/auth/AuthService"

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

	const sendCombinedUpdate = async () => {
		const authInfo = authService.getInfo()

		await responseStream(
			AuthState.fromPartial({
				user: authInfo.user,
			}),
			false,
		)
	}

	// Subscribe to auth service
	await authService.subscribeToAuthStatusUpdate(controller, request, sendCombinedUpdate, requestId)
}
