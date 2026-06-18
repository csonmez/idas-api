import { Router } from 'express'
import type { AppDependencies } from '../app.types.ts'
import { issueCsrfToken } from '../auth/csrf.ts'

export const createRoutes = (_deps: AppDependencies) => {
	const router = Router()

	router.get('/csrf-token', (req, res) => {
		const token = issueCsrfToken(req)
		res.status(200).json({ token })
	})

	return router
}
