import type { RequestHandler } from 'express'
import type { Kysely } from 'kysely'
import type { AppConfig } from './config/env.ts'
import type { DB } from './database/index.ts'
import type { RedisClient } from './redis/client.ts'

export type AppDependencies = {
	config: AppConfig
	db: Kysely<DB>
	redisClient: RedisClient
	isReady: () => boolean
	checkDb: () => Promise<void>
	checkRedis: () => Promise<void>
	sessionMiddleware?: RequestHandler
}
