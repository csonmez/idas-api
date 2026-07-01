import { Router } from 'express'
import type { AppDependencies } from '../app.types.ts'
import { issueCsrfToken } from '../auth/csrf.ts'
import { createAccountRoutes } from '../modules/account/account.routes.ts'
import { createAccountService } from '../modules/account/account.service.ts'
import { createFakePasswordResetNotifier } from '../modules/account/password-reset-notifier.ts'

export const createRoutes = (deps: AppDependencies) => {
	const router = Router()

	router.get('/csrf-token', (req, res) => {
		const token = issueCsrfToken(req)
		res.status(200).json({ token })
	})

	const notifier = deps.passwordResetNotifier ?? createFakePasswordResetNotifier()
	const accountService = createAccountService({
		db: deps.db,
		redisClient: deps.redisClient,
		config: deps.config,
		passwordResetNotifier: notifier
	})
	router.use('/account', createAccountRoutes({
		service: accountService,
		redisClient: deps.redisClient,
		passwordMinLength: deps.config.auth.passwordMinLength,
		rateLimit: deps.config.auth.rateLimit
	}))

	return router
}
