import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import express from 'express'
import session from 'express-session'
import request from 'supertest'
import { createApp } from './app.ts'
import type { AppDependencies } from './app.types.ts'
import type { AppConfig } from './config/env.ts'
import { readEnv } from './config/env.ts'
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
		csrfHeaderName: 'x-csrf-token'
	}
})

const createTestDeps = (overrides: Partial<AppDependencies> = {}): AppDependencies => ({
	config: createTestConfig(),
	db: {} as AppDependencies['db'],
	redisClient: {} as RedisClient,
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

	it('returns 503 for /health/ready when isReady is false', async () => {
		const app = createApp(createTestDeps({ isReady: () => false }))
		await request(app).get('/health/ready').expect(503)
	})

	it('returns 204 for /health/ready when checks succeed', async () => {
		const app = createApp(createTestDeps())
		await request(app).get('/health/ready').expect(204)
	})

	it('returns 503 for /health/ready when a dependency check fails', async () => {
		const app = createApp(
			createTestDeps({
				checkDb: async () => {
					throw new Error('db down')
				}
			})
		)

		await request(app).get('/health/ready').expect(503)
	})

	it('returns 404 for unknown routes outside /api even with malformed body', async () => {
		const app = createApp(createTestDeps())

		const response = await request(app)
			.post('/unknown')
			.set('Content-Type', 'application/json')
			.send('{ invalid json')
			.expect(404)

		assert.equal(response.body.error, 'NOT_FOUND')
	})

	it('returns 400 for malformed JSON under /api', async () => {
		const app = createApp(createTestDeps())

		const response = await request(app)
			.post('/api/unknown')
			.set('Content-Type', 'application/json')
			.send('{ invalid json')
			.expect(400)

		assert.equal(response.body.error, 'BAD_REQUEST')
	})

	it('returns 403 for disallowed CORS origin', async () => {
		const app = createApp(createTestDeps())

		const response = await request(app).get('/health/live').set('Origin', 'https://evil.example').expect(403)

		assert.equal(response.body.error, 'FORBIDDEN')
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

		assert.equal(response.body.error, 'FORBIDDEN')
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
})

describe('errorHandler', () => {
	it('forwards async route errors through Express 5', async () => {
		const app = express()

		app.get('/async-error', async () => {
			throw new Error('async failure')
		})
		app.use(errorHandler)

		const response = await request(app).get('/async-error').expect(500)

		assert.equal(response.body.error, 'INTERNAL_ERROR')
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
