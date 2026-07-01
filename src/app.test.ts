import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import express from 'express'
import session from 'express-session'
import request from 'supertest'
import { createApp } from './app.ts'
import type { AppDependencies } from './app.types.ts'
import type { AppConfig } from './config/env.ts'
import { readEnv } from './config/env.ts'
import { AppError, type AppErrorCode, type JsonObject, sanitizeDetails } from './http/errors.ts'
import { logger } from './logger/index.ts'
import { errorHandler } from './middlewares/error.middleware.ts'
import type { RedisClient } from './redis/client.ts'

const createTestConfig = (): AppConfig => ({
	nodeEnv: 'test',
	isProduction: false,
	port: 0,
	databaseUrl: 'postgresql://postgres:postgres@localhost:5432/idas-api',
	redisUrl: 'redis://localhost:6379',
	auth: {
		sessionSecret: 'test-session-secret-with-32-characters-min',
		sessionCookieName: 'idas.sid',
		sessionMaxAgeMs: 86_400_000,
		sessionCookieSecure: false,
		sessionCookieSameSite: 'lax',
		csrfHeaderName: 'x-csrf-token',
		bcryptRounds: 12,
		passwordMinLength: 15,
		corsAllowedOrigins: ['http://localhost:3000'],
		passwordResetUrl: 'http://localhost:3000/reset',
		trustProxyHops: 0,
		rateLimit: {
			session: { windowMs: 900_000, ipEmailMax: 5, ipMax: 50 },
			resetRequest: { windowMs: 3_600_000, ipEmailMax: 3, ipMax: 20 },
			resetCompletion: { windowMs: 900_000, ipRouteMax: 10 }
		}
	}
})

const createTestRedisClient = (): RedisClient =>
	({
		sendCommand: async (args: string[]) => {
			if (args[0] === 'SCRIPT') return 'mock-sha'
			return null
		}
	}) as unknown as RedisClient

const createTestDeps = (overrides: Partial<AppDependencies> = {}): AppDependencies => ({
	config: createTestConfig(),
	db: {} as AppDependencies['db'],
	redisClient: createTestRedisClient(),
	isReady: () => true,
	checkDb: async () => undefined,
	checkRedis: async () => undefined,
	sessionMiddleware: session({
		secret: 'test-session-secret-with-32-characters-min',
		resave: false,
		saveUninitialized: false
	}),
	...overrides
})

const withSilentLogger = async (fn: () => Promise<void>) => {
	const previousLevel = logger.level
	logger.level = 'silent'

	try {
		await fn()
	} finally {
		logger.level = previousLevel
	}
}

describe('createApp', () => {
	it('returns 204 for /health/live without dependency checks', async () => {
		const app = createApp(
			createTestDeps({
				checkDb: async () => {
					throw new Error('db down')
				},
				checkRedis: async () => {
					throw new Error('redis down')
				}
			})
		)

		await request(app).get('/health/live').expect(204)
	})

	it('returns 503 with nested error contract for /health/ready when isReady is false', async () => {
		const app = createApp(createTestDeps({ isReady: () => false }))
		const response = await request(app).get('/health/ready').expect(503)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE')
		assert.equal(typeof response.body.error.message, 'string')
	})

	it('returns 204 for /health/ready when checks succeed', async () => {
		const app = createApp(createTestDeps())
		await request(app).get('/health/ready').expect(204)
	})

	it('returns 503 with nested error contract for /health/ready when a dependency check fails', async () => {
		const app = createApp(
			createTestDeps({
				checkDb: async () => {
					throw new Error('db down')
				}
			})
		)

		const response = await request(app).get('/health/ready').expect(503)
		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE')
	})

	it('returns 404 for unknown routes outside /api even with malformed body', async () => {
		const app = createApp(createTestDeps())

		const response = await request(app)
			.post('/unknown')
			.set('Content-Type', 'application/json')
			.send('{ invalid json')
			.expect(404)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'NOT_FOUND')
	})

	it('returns 400 for malformed JSON under /api', async () => {
		const app = createApp(createTestDeps())

		const response = await request(app)
			.post('/api/unknown')
			.set('Content-Type', 'application/json')
			.send('{ invalid json')
			.expect(400)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'BAD_REQUEST')
		assert.equal(typeof response.body.error.message, 'string')
		assert.deepEqual(response.body.error.details, {})
	})

	it('returns 403 for disallowed CORS origin', async () => {
		const app = createApp(createTestDeps())

		const response = await request(app).get('/health/live').set('Origin', 'https://evil.example').expect(403)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'FORBIDDEN')
	})

	it('preserves a valid upstream request id', async () => {
		const app = createApp(createTestDeps())
		const requestId = 'test-request-id-1234'

		const response = await request(app).get('/health/live').set('x-request-id', requestId).expect(204)

		assert.equal(response.headers['x-request-id'], requestId)
	})

	it('does not set a session cookie for anonymous requests that do not touch session', async () => {
		const app = createApp(createTestDeps())

		const response = await request(app).get('/api/does-not-exist').expect(404)

		assert.equal(response.headers['set-cookie'], undefined)
	})

	it('sets a session cookie when csrf token endpoint writes to session', async () => {
		const app = createApp(createTestDeps())
		const agent = request.agent(app)

		const response = await agent.get('/api/csrf-token').expect(200)

		assert.equal(typeof response.body.token, 'string')
		assert.ok(response.headers['set-cookie'])
	})

	it('rejects unsafe requests without a CSRF token', async () => {
		const app = createApp(createTestDeps())

		const response = await request(app)
			.post('/api/unknown')
			.set('Content-Type', 'application/json')
			.send('{}')
			.expect(403)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'FORBIDDEN')
	})

	it('allows unsafe requests with a valid CSRF token', async () => {
		const app = createApp(createTestDeps())
		const agent = request.agent(app)

		const tokenResponse = await agent.get('/api/csrf-token').expect(200)
		const token = tokenResponse.body.token as string

		await agent
			.post('/api/unknown')
			.set('x-csrf-token', token)
			.set('Content-Type', 'application/json')
			.send('{}')
			.expect(404)
	})

	it('returns 413 for payloads exceeding the body size limit', async () => {
		const app = createApp(createTestDeps())
		const agent = request.agent(app)

		const tokenResponse = await agent.get('/api/csrf-token').expect(200)
		const token = tokenResponse.body.token as string

		const largeBody = JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) })

		const response = await agent
			.post('/api/unknown')
			.set('x-csrf-token', token)
			.set('Content-Type', 'application/json')
			.send(largeBody)
			.expect(413)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'PAYLOAD_TOO_LARGE')
		assert.equal(typeof response.body.error.message, 'string')
		assert.ok(!JSON.stringify(response.body).includes('stack'))
	})
})

describe('rate-limit', () => {
	it('returns 429 with nested error contract when rate limit is exceeded', async () => {
		await withSilentLogger(async () => {
			const app = createApp(createTestDeps())

			for (let i = 0; i < 300; i += 1) {
				await request(app).get('/api/rate-limited').expect(404)
			}

			const response = await request(app).get('/api/rate-limited').expect(429)

			assert.equal(typeof response.body.error, 'object')
			assert.equal(response.body.error.code, 'TOO_MANY_REQUESTS')
			assert.equal(response.body.error.message, 'Too many requests')
			assert.deepEqual(response.body.error.details, {})
		})
	})

	it('returns 503 with nested error contract when rate-limit store fails', async () => {
		const productionConfig: AppConfig = {
			...createTestConfig(),
			nodeEnv: 'production',
			isProduction: true,
			auth: {
				...createTestConfig().auth,
				sessionCookieSecure: true
			}
		}
		const failingRedisClient = {
			sendCommand: async (command: string[]) => {
				if (command[0] === 'SCRIPT') {
					return 'script-sha'
				}

				throw new Error('Redis connection refused')
			}
		} as unknown as RedisClient
		const app = createApp(createTestDeps({ config: productionConfig, redisClient: failingRedisClient }))

		const response = await request(app).get('/api/rate-limit-store-failure').expect(503)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE')
		assert.equal(response.body.error.message, 'Service unavailable')
		assert.deepEqual(response.body.error.details, {})
		assert.ok(!JSON.stringify(response.body).includes('Redis'))
		assert.ok(!JSON.stringify(response.body).includes('connection refused'))
	})
})

describe('errorHandler', () => {
	it('forwards async route errors through Express 5', async () => {
		const app = express()

		app.get('/async-error', async () => {
			throw new Error('async failure')
		})
		app.use(errorHandler)

		const response = await request(app).get('/async-error').expect(500)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'INTERNAL_ERROR')
	})

	it('does not leak stack or internal details in 500 response', async () => {
		const app = express()

		app.get('/internal-error', async () => {
			const err = new Error('SELECT * FROM secret_table WHERE password = "abc"')
			throw err
		})
		app.use(errorHandler)

		const response = await request(app).get('/internal-error').expect(500)

		assert.equal(response.body.error.code, 'INTERNAL_ERROR')
		assert.equal(response.body.error.message, 'Internal server error')
		assert.ok(!JSON.stringify(response.body).includes('stack'))
		assert.ok(!JSON.stringify(response.body).includes('SELECT'))
		assert.ok(!JSON.stringify(response.body).includes('secret_table'))
	})

	it('returns nested error shape for known AppError', async () => {
		const app = express()

		app.get('/app-error', async () => {
			throw new AppError('CONFLICT', 'Resource already exists', { field: 'email' })
		})
		app.use(errorHandler)

		const response = await request(app).get('/app-error').expect(409)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'CONFLICT')
		assert.equal(response.body.error.message, 'Resource already exists')
		assert.deepEqual(response.body.error.details, { field: 'email' })
	})

	it('returns 401 for UNAUTHENTICATED AppError', async () => {
		const app = express()

		app.get('/protected', async () => {
			throw new AppError('UNAUTHENTICATED', 'Unauthorized')
		})
		app.use(errorHandler)

		const response = await request(app).get('/protected').expect(401)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'UNAUTHENTICATED')
	})

	it('error response body.error is an object, not a string', async () => {
		const app = express()

		app.get('/error', async () => {
			throw new Error('boom')
		})
		app.use(errorHandler)

		const response = await request(app).get('/error').expect(500)

		assert.equal(typeof response.body.error, 'object')
		assert.notEqual(typeof response.body.error, 'string')
	})

	it('AppError details only contains safe JSON-serializable data', async () => {
		const app = express()

		app.get('/safe-details', async () => {
			throw new AppError('BAD_REQUEST', 'Bad input', { field: 'name', reason: 'too short' })
		})
		app.use(errorHandler)

		const response = await request(app).get('/safe-details').expect(400)

		assert.equal(response.body.error.details.field, 'name')
		assert.equal(response.body.error.details.reason, 'too short')
		assert.ok(!Object.hasOwn(response.body.error, 'stack'))
		assert.ok(!Object.hasOwn(response.body.error, 'cause'))
	})

	it('normalizes AppError with 500 status to INTERNAL_ERROR safe contract', async () => {
		const app = express()

		app.get('/internal-app-error', async () => {
			throw new AppError('INTERNAL_ERROR', 'SQL connection failed', {
				sql: 'SELECT * FROM users',
				internalId: 'db-conn-42'
			})
		})
		app.use(errorHandler)

		const response = await request(app).get('/internal-app-error').expect(500)

		assert.equal(response.body.error.code, 'INTERNAL_ERROR')
		assert.equal(response.body.error.message, 'Internal server error')
		assert.deepEqual(response.body.error.details, {})
		assert.ok(!JSON.stringify(response.body).includes('SQL connection failed'))
		assert.ok(!JSON.stringify(response.body).includes('db-conn-42'))
	})

	it('removes BigInt values from AppError response details without throwing', async () => {
		const app = express()

		app.get('/bigint-details', async () => {
			throw new AppError('BAD_REQUEST', 'Bad input', {
				safe: 'ok',
				big: BigInt(9007199254740991)
			} as unknown as JsonObject)
		})
		app.use(errorHandler)

		const response = await request(app).get('/bigint-details').expect(400)

		assert.deepEqual(response.body.error.details, { safe: 'ok' })
	})

	it('removes Error objects from AppError response details without leaking to client', async () => {
		const app = express()

		app.get('/error-object-details', async () => {
			throw new AppError('BAD_REQUEST', 'Bad input', {
				err: new Error('secret db error'),
				safe: 'visible'
			} as unknown as JsonObject)
		})
		app.use(errorHandler)

		const response = await request(app).get('/error-object-details').expect(400)

		assert.deepEqual(response.body.error.details, { safe: 'visible' })
		assert.ok(!JSON.stringify(response.body).includes('secret db error'))
	})

	it('handles circular AppError details without crashing', async () => {
		const app = express()

		app.get('/circular-details', async () => {
			const details: Record<string, unknown> = { safe: 'ok' }
			details.self = details

			throw new AppError('BAD_REQUEST', 'Bad input', details as unknown as JsonObject)
		})
		app.use(errorHandler)

		const response = await request(app).get('/circular-details').expect(400)

		assert.deepEqual(response.body.error.details, { safe: 'ok' })
	})

	it('does not trust status/statusCode on unknown Error objects', async () => {
		const app = express()

		app.get('/duck-typed-error', async () => {
			const err = Object.assign(new Error('internal failure'), {
				status: 418,
				statusCode: 403
			})
			throw err
		})
		app.use(errorHandler)

		const response = await request(app).get('/duck-typed-error').expect(500)

		assert.equal(response.body.error.code, 'INTERNAL_ERROR')
		assert.equal(response.body.error.message, 'Internal server error')
		assert.ok(!JSON.stringify(response.body).includes('internal failure'))
	})
})

describe('sanitizeDetails', () => {
	it('passes through safe primitive field-level details', () => {
		const result = sanitizeDetails({ field: 'email', count: 3, active: true, nullable: null })
		assert.deepEqual(result, { field: 'email', count: 3, active: true, nullable: null })
	})

	it('removes BigInt values from details without throwing', () => {
		const result = sanitizeDetails({ safe: 'ok', big: BigInt(9007199254740991) })
		assert.equal(result.safe, 'ok')
		assert.ok(!Object.hasOwn(result, 'big'))
	})

	it('removes Error objects from details without leaking to client', () => {
		const result = sanitizeDetails({ err: new Error('secret db error'), safe: 'visible' })
		assert.equal(result.safe, 'visible')
		assert.ok(!Object.hasOwn(result, 'err'))
		assert.ok(!JSON.stringify(result).includes('secret db error'))
	})

	it('handles circular references without crashing', () => {
		const obj: Record<string, unknown> = { a: 1 }
		obj.self = obj

		assert.doesNotThrow(() => {
			const result = sanitizeDetails(obj)
			assert.equal(result.a, 1)
		})
	})

	it('removes function values from details', () => {
		const result = sanitizeDetails({ fn: () => 'secret', safe: 42 })
		assert.ok(!Object.hasOwn(result, 'fn'))
		assert.equal(result.safe, 42)
	})

	it('returns empty object for non-object inputs', () => {
		assert.deepEqual(sanitizeDetails(null), {})
		assert.deepEqual(sanitizeDetails('string'), {})
		assert.deepEqual(sanitizeDetails(42), {})
		assert.deepEqual(sanitizeDetails([1, 2]), {})
	})
})

describe('AppError status mapping', () => {
	it('maps every AppErrorCode to the correct HTTP status', () => {
		const expected: Record<string, number> = {
			BAD_REQUEST: 400,
			VALIDATION_ERROR: 400,
			UNAUTHENTICATED: 401,
			FORBIDDEN: 403,
			NOT_FOUND: 404,
			CONFLICT: 409,
			PAYLOAD_TOO_LARGE: 413,
			TOO_MANY_REQUESTS: 429,
			SERVICE_UNAVAILABLE: 503,
			INTERNAL_ERROR: 500
		}

		for (const [code, status] of Object.entries(expected)) {
			const err = new AppError(code as AppErrorCode, 'test')
			assert.equal(err.statusCode, status, `${code} should map to ${status}`)
		}
	})

	it('maps SERVICE_UNAVAILABLE to 503', () => {
		const err = new AppError('SERVICE_UNAVAILABLE', 'Service unavailable')
		assert.equal(err.statusCode, 503)
	})

	it('maps INTERNAL_ERROR to 500', () => {
		const err = new AppError('INTERNAL_ERROR', 'Internal server error')
		assert.equal(err.statusCode, 500)
	})

	it('does not accept an arbitrary status number — statusCode is always derived from code', () => {
		const err = new AppError('NOT_FOUND', 'Not found')
		assert.equal(err.statusCode, 404)
	})
})

describe('readEnv', () => {
	it('rejects a short SESSION_SECRET', () => {
		const previousEnv = { ...process.env }

		process.env.NODE_ENV = 'test'
		process.env.PORT = '3000'
		process.env.DATABASE_URL = 'postgresql://localhost/db'
		process.env.REDIS_URL = 'redis://localhost:6379'
		process.env.SESSION_SECRET = 'change-me'

		try {
			assert.throws(() => readEnv(), /at least 32/i)
		} finally {
			process.env = previousEnv
		}
	})
})
