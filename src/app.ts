import express from 'express'
import passport from 'passport'
import type { AppDependencies } from './app.types.ts'
import { createCsrfMiddleware } from './auth/csrf.ts'
import { createSessionMiddleware } from './auth/session.ts'
import { sendError } from './http/errors.ts'
import { httpLogger } from './logger/http-logger.ts'
import { errorHandler } from './middlewares/error.middleware.ts'
import { notFoundHandler } from './middlewares/not-found.middleware.ts'
import { requestIdMiddleware } from './middlewares/request-id.middleware.ts'
import { createRoutes } from './routes/index.ts'
import { createCorsMiddleware } from './security/cors.ts'
import { createHelmetMiddleware } from './security/helmet.ts'
import { createApiRateLimit } from './security/rate-limit.ts'

const JSON_BODY_LIMIT = '1mb'
const URLENCODED_BODY_LIMIT = '100kb'

const createReadinessHandler = (deps: AppDependencies) => {
	return async (_req: express.Request, res: express.Response) => {
		if (!deps.isReady()) {
			sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Service unavailable')
			return
		}

		try {
			await Promise.all([deps.checkDb(), deps.checkRedis()])
			res.status(204).end()
		} catch {
			sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Service unavailable')
		}
	}
}

export const createApp = (deps: AppDependencies) => {
	const app = express()

	app.set('trust proxy', deps.config.auth.trustProxyHops)
	app.disable('x-powered-by')

	app.use(requestIdMiddleware)
	app.use(httpLogger)
	app.use(createHelmetMiddleware())
	app.use(createCorsMiddleware(deps.config.auth.corsAllowedOrigins))

	app.get('/health/live', (_req, res) => res.status(204).end())
	app.get('/health/ready', createReadinessHandler(deps))

	app.use('/api', createApiRateLimit(deps.redisClient, deps.config.isProduction))
	app.use('/api', express.json({ limit: JSON_BODY_LIMIT }))
	app.use('/api', express.urlencoded({ extended: true, limit: URLENCODED_BODY_LIMIT }))
	app.use('/api', deps.sessionMiddleware ?? createSessionMiddleware(deps))
	app.use('/api', passport.initialize())
	app.use('/api', passport.session())
	app.use('/api', createCsrfMiddleware(deps))
	app.use('/api', createRoutes(deps))

	app.use(notFoundHandler)
	app.use(errorHandler)

	return app
}

export type { AppDependencies } from './app.types.ts'
