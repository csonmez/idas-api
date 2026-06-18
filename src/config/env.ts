import { z } from 'zod'

const SESSION_COOKIE_NAME = 'idas.sid'
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1_000
const CSRF_HEADER_NAME = 'x-csrf-token' as const

const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	PORT: z.coerce.number().int().default(3000),
	DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
	REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
	SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters')
})

export type AppConfig = {
	nodeEnv: 'development' | 'test' | 'production'
	isProduction: boolean
	port: number
	databaseUrl: string
	redisUrl: string
	auth: {
		sessionSecret: string
		sessionCookieName: string
		sessionMaxAgeMs: number
		sessionCookieSecure: boolean
		sessionCookieSameSite: 'lax' | 'strict' | 'none'
		csrfHeaderName: typeof CSRF_HEADER_NAME
	}
}

export const readEnv = (): AppConfig => {
	const parsed = envSchema.parse(process.env)
	const isProduction = parsed.NODE_ENV === 'production'

	return {
		nodeEnv: parsed.NODE_ENV,
		isProduction,
		port: parsed.PORT,
		databaseUrl: parsed.DATABASE_URL,
		redisUrl: parsed.REDIS_URL,
		auth: {
			sessionSecret: parsed.SESSION_SECRET,
			sessionCookieName: SESSION_COOKIE_NAME,
			sessionMaxAgeMs: SESSION_MAX_AGE_MS,
			sessionCookieSecure: isProduction,
			sessionCookieSameSite: 'lax',
			csrfHeaderName: CSRF_HEADER_NAME
		}
	}
}
