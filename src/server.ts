import { type Kysely, sql } from 'kysely'
import { createApp } from './app.ts'
import { configurePassport } from './auth/passport.ts'
import { type AppConfig, readEnv } from './config/env.ts'
import { createDb, type DB } from './database/index.ts'
import { flushLogger, logger } from './logger/index.ts'
import { createRedisClient, type RedisClient, withCommandTimeout } from './redis/client.ts'

const FORCE_CLOSE_CONNECTIONS_AFTER_MS = 10_000
const FORCE_EXIT_AFTER_MS = 15_000
const FATAL_FLUSH_TIMEOUT_MS = 2_000
const REDIS_CONNECT_TIMEOUT_MS = 5_000

let isReady = false
let isShuttingDown = false

const flushWithTimeout = async () => {
	let timer: NodeJS.Timeout | undefined

	await Promise.race([
		flushLogger()
			.catch(() => undefined)
			.finally(() => clearTimeout(timer)),
		new Promise((resolve) => {
			timer = setTimeout(resolve, FATAL_FLUSH_TIMEOUT_MS)
		})
	])
}

let config: AppConfig | undefined
let db: Kysely<DB> | undefined
let redisClient: RedisClient | undefined

const checkDb = async () => {
	await sql`select 1`.execute(db!)
}

const checkRedis = async () => {
	await withCommandTimeout(redisClient!.ping())
}

const connectRedisWithTimeout = async (client: RedisClient) => {
	let timer: NodeJS.Timeout | undefined

	try {
		await Promise.race([
			client.connect(),
			new Promise((_, reject) => {
				timer = setTimeout(() => {
					reject(new Error('Redis connect timed out'))
				}, REDIS_CONNECT_TIMEOUT_MS)
			})
		])
	} finally {
		clearTimeout(timer)
	}
}

try {
	config = readEnv()
	db = createDb(config.databaseUrl)
	redisClient = createRedisClient(config.redisUrl)

	await connectRedisWithTimeout(redisClient)
	await checkRedis()
	await checkDb()
	configurePassport({ db })
} catch (error) {
	logger.fatal({ error }, 'Server startup failed')
	await Promise.allSettled([redisClient?.disconnect(), db?.destroy()])
	await flushWithTimeout()
	process.exit(1)
}

const app = createApp({
	config: config!,
	db: db!,
	redisClient: redisClient!,
	isReady: () => isReady,
	checkDb,
	checkRedis
})

const server = app.listen(config!.port, () => {
	isReady = true
	logger.info({ port: config!.port }, 'Server is running')
})

const gracefulShutdown = (reason: string, exitCode = 0) => {
	if (isShuttingDown) {
		logger.warn({ reason }, 'Shutdown already in progress')
		return
	}

	isShuttingDown = true
	isReady = false
	logger.info({ reason }, 'Shutting down')

	const forceCloseTimer = setTimeout(() => {
		logger.warn('Forcing open HTTP connections to close')
		server.closeAllConnections()
	}, FORCE_CLOSE_CONNECTIONS_AFTER_MS)

	forceCloseTimer.unref()

	const forceExitTimer = setTimeout(() => {
		logger.error('Graceful shutdown timed out')
		void flushWithTimeout().finally(() => process.exit(1))
	}, FORCE_EXIT_AFTER_MS)

	forceExitTimer.unref()

	server.close(async (error) => {
		if (error) {
			logger.error({ error }, 'HTTP server close failed')
			exitCode = 1
		}

		const results = await Promise.allSettled([withCommandTimeout(redisClient!.quit()), db!.destroy()])

		for (const result of results) {
			if (result.status === 'rejected') {
				logger.error({ error: result.reason }, 'Shutdown cleanup failed')
				exitCode = 1
			}
		}

		clearTimeout(forceCloseTimer)
		clearTimeout(forceExitTimer)
		await flushWithTimeout()
		process.exit(exitCode)
	})
}

const fatalExit = (reason: string, error: unknown) => {
	logger.fatal({ error }, reason)
	void flushWithTimeout().finally(() => process.exit(1))
}

server.on('error', (error) => {
	logger.fatal({ error }, 'HTTP server error')
	gracefulShutdown('serverError', 1)
})

process.on('SIGINT', () => gracefulShutdown('SIGINT', 0))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 0))
process.on('unhandledRejection', (error) => fatalExit('Unhandled rejection', error))
process.on('uncaughtException', (error) => fatalExit('Uncaught exception', error))
