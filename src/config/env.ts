import { z } from 'zod'

const SESSION_COOKIE_NAME = 'idas.sid'
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1_000
const CSRF_HEADER_NAME = 'x-csrf-token' as const

const RATE_LIMIT_SESSION_WINDOW_MS = 15 * 60 * 1_000
const RATE_LIMIT_RESET_REQUEST_WINDOW_MS = 60 * 60 * 1_000
const RATE_LIMIT_RESET_COMPLETION_WINDOW_MS = 15 * 60 * 1_000

const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	PORT: z.coerce.number().int().default(3000),
	DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
	REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
	SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
	SESSION_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
	BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(13).default(12),
	PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(15),
	CORS_ALLOWED_ORIGINS: z.string().min(1).default('http://localhost:3000,http://localhost:3001'),
	PASSWORD_RESET_URL: z.string().url().default('http://localhost:3000/reset'),
	TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
	RATE_LIMIT_SESSION_IP_EMAIL_MAX: z.coerce.number().int().default(5),
	RATE_LIMIT_SESSION_IP_MAX: z.coerce.number().int().default(50),
	RATE_LIMIT_RESET_REQUEST_IP_EMAIL_MAX: z.coerce.number().int().default(3),
	RATE_LIMIT_RESET_REQUEST_IP_MAX: z.coerce.number().int().default(20),
	RATE_LIMIT_RESET_COMPLETION_IP_ROUTE_MAX: z.coerce.number().int().default(10)
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
		bcryptRounds: number
		passwordMinLength: number
		corsAllowedOrigins: string[]
		passwordResetUrl: string
		trustProxyHops: number
		rateLimit: {
			session: { windowMs: number; ipEmailMax: number; ipMax: number }
			resetRequest: { windowMs: number; ipEmailMax: number; ipMax: number }
			resetCompletion: { windowMs: number; ipRouteMax: number }
		}
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
			sessionCookieSameSite: parsed.SESSION_COOKIE_SAMESITE,
			csrfHeaderName: CSRF_HEADER_NAME,
			bcryptRounds: parsed.BCRYPT_ROUNDS,
			passwordMinLength: parsed.PASSWORD_MIN_LENGTH,
			corsAllowedOrigins: parsed.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
			passwordResetUrl: parsed.PASSWORD_RESET_URL,
			trustProxyHops: parsed.TRUST_PROXY_HOPS,
			rateLimit: {
				session: {
					windowMs: RATE_LIMIT_SESSION_WINDOW_MS,
					ipEmailMax: parsed.RATE_LIMIT_SESSION_IP_EMAIL_MAX,
					ipMax: parsed.RATE_LIMIT_SESSION_IP_MAX
				},
				resetRequest: {
					windowMs: RATE_LIMIT_RESET_REQUEST_WINDOW_MS,
					ipEmailMax: parsed.RATE_LIMIT_RESET_REQUEST_IP_EMAIL_MAX,
					ipMax: parsed.RATE_LIMIT_RESET_REQUEST_IP_MAX
				},
				resetCompletion: {
					windowMs: RATE_LIMIT_RESET_COMPLETION_WINDOW_MS,
					ipRouteMax: parsed.RATE_LIMIT_RESET_COMPLETION_IP_ROUTE_MAX
				}
			}
		}
	}
}
