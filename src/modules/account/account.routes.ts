import { Router } from 'express'
import { validateBody } from '../../http/request-validation.ts'
import type { RedisClient } from '../../redis/client.ts'
import { requireAuth } from '../authorization/authorization.middleware.ts'
import { createAccountController } from './account.controller.ts'
import {
	createPasswordResetCompletionLimiter,
	createPasswordResetRequestLimiters,
	createSessionCreationLimiters
} from './account.limiter.ts'
import {
	createCompletePasswordResetBodySchema,
	createPasswordResetRequestBodySchema,
	createSessionBodySchema
} from './account.schemas.ts'
import type { AccountService } from './account.service.ts'

type AccountRoutesDeps = {
	service: AccountService
	redisClient: RedisClient
	passwordMinLength: number
	rateLimit: {
		session: { windowMs: number; ipEmailMax: number; ipMax: number }
		resetRequest: { windowMs: number; ipEmailMax: number; ipMax: number }
		resetCompletion: { windowMs: number; ipRouteMax: number }
	}
}

export const createAccountRoutes = ({ service, redisClient, passwordMinLength, rateLimit }: AccountRoutesDeps) => {
	const controller = createAccountController(service)
	const router = Router()

	const sessionLimiters = createSessionCreationLimiters(redisClient, rateLimit.session)
	router.post('/session', ...sessionLimiters, validateBody(createSessionBodySchema), controller.createSession)
	router.get('/session', requireAuth(), controller.getSession)
	router.delete('/session', requireAuth(), controller.deleteSession)

	const resetRequestLimiters = createPasswordResetRequestLimiters(redisClient, rateLimit.resetRequest)
	router.post(
		'/password-reset-requests',
		...resetRequestLimiters,
		validateBody(createPasswordResetRequestBodySchema),
		controller.createPasswordResetRequest
	)

	const resetCompletionLimiter = createPasswordResetCompletionLimiter(redisClient, rateLimit.resetCompletion)
	router.post(
		'/password-resets',
		resetCompletionLimiter,
		validateBody(createCompletePasswordResetBodySchema(passwordMinLength)),
		controller.completePasswordReset
	)

	return router
}
