import type { RequestHandler } from 'express'
import type { Kysely } from 'kysely'
import type { AppConfig } from './config/env.ts'
import type { DB } from './database/index.ts'
import type { RedisClient } from './redis/client.ts'

/**
 * Password reset notification adapter (Plan Mimari Karar 8).
 * Phase 2b'de (password-reset-notifier.ts) gerçek interface ile değiştirilecek;
 * şimdilik app.types'ta structural tip — account service provider'a doğrudan
 * bağlanmaz, bu slot üzerinden inject edilir.
 */
type PasswordResetNotifier = {
	enqueuePasswordResetEmail(input: { userId: string; emailDigest: string; resetUrl: string }): Promise<void>
}

export type AppDependencies = {
	config: AppConfig
	db: Kysely<DB>
	redisClient: RedisClient
	isReady: () => boolean
	checkDb: () => Promise<void>
	checkRedis: () => Promise<void>
	sessionMiddleware?: RequestHandler
	passwordResetNotifier?: PasswordResetNotifier
}
