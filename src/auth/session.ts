import { RedisStore } from 'connect-redis'
import session from 'express-session'
import type { AppDependencies } from '../app.types.ts'
import type { RedisClient } from '../redis/client.ts'

const SESSION_STORE_PREFIX = 'idas:sess:'

export const createSessionMiddleware = (deps: AppDependencies) => {
	const store = new RedisStore({
		client: deps.redisClient as RedisClient,
		prefix: SESSION_STORE_PREFIX,
		ttl: Math.floor(deps.config.auth.sessionMaxAgeMs / 1_000)
	})

	return session({
		name: deps.config.auth.sessionCookieName,
		secret: deps.config.auth.sessionSecret,
		resave: false,
		saveUninitialized: false,
		store,
		cookie: {
			httpOnly: true,
			secure: deps.config.auth.sessionCookieSecure,
			sameSite: deps.config.auth.sessionCookieSameSite,
			maxAge: deps.config.auth.sessionMaxAgeMs
		}
	})
}
