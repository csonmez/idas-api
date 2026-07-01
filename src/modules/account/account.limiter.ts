import { createHash } from 'node:crypto'
import type { Request } from 'express'
import { type RateLimitRequestHandler, ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { type AppErrorCode, sendError } from '../../http/errors.ts'
import type { RedisClient } from '../../redis/client.ts'

const createAccountRateLimit = (
	redisClient: RedisClient,
	prefix: string,
	windowMs: number,
	max: number,
	keyGenerator: (req: Request) => string
): RateLimitRequestHandler => {
	return rateLimit({
		windowMs,
		max,
		standardHeaders: true,
		legacyHeaders: false,
		skip: (req) => req.method === 'OPTIONS',
		keyGenerator,
		// ipKeyGenerator manuel çağrıldığı için express-rate-limit'in statik
		// keyGenerator IPv6 fallback validator'ünü kapatırız.
		validate: { keyGeneratorIpFallback: false },
		handler: (_req, res) => {
			sendError(res, 429, 'TOO_MANY_REQUESTS' as AppErrorCode, 'Too many requests')
		},
		store: new RedisStore({
			prefix,
			sendCommand: (...args: string[]) => redisClient.sendCommand(args)
		})
	})
}

const emailDigestFromBody = (req: Request): string | null => {
	try {
		const email = req.body?.email as string | undefined
		if (!email || typeof email !== 'string') return null
		const normalized = email.trim().toLowerCase()
		if (normalized.length === 0) return null
		return createHash('sha256').update(normalized).digest('hex')
	} catch {
		return null
	}
}

/** IPv6 normalizasyonu yapan ipKeyGenerator wrapper'ı. */
const safeIpKey = (req: Request): string => {
	const ip = req.ip ?? ''
	return ip ? ipKeyGenerator(ip) : 'unknown'
}

/**
 * Session creation limiters (Plan Kilit Karar #3):
 * - 5 attempt / 15 minutes per IP + email digest
 * - 50 attempt / 15 minutes per IP (kaba koruma)
 */
export const createSessionCreationLimiters = (
	redisClient: RedisClient,
	config: { windowMs: number; ipEmailMax: number; ipMax: number }
) => {
	const ipEmailLimiter = createAccountRateLimit(
		redisClient,
		'idas:rl:account:session:email:',
		config.windowMs,
		config.ipEmailMax,
		(req: Request) => {
			const digest = emailDigestFromBody(req)
			return digest ? `${safeIpKey(req)}::${digest}` : safeIpKey(req)
		}
	)

	const ipLimiter = createAccountRateLimit(
		redisClient,
		'idas:rl:account:session:ip:',
		config.windowMs,
		config.ipMax,
		(req: Request) => safeIpKey(req)
	)

	return [ipEmailLimiter, ipLimiter]
}

/**
 * Password reset request limiters:
 * - 3 request / 1 hour per IP + email digest
 * - 20 request / 1 hour per IP (kaba koruma)
 */
export const createPasswordResetRequestLimiters = (
	redisClient: RedisClient,
	config: { windowMs: number; ipEmailMax: number; ipMax: number }
) => {
	const ipEmailLimiter = createAccountRateLimit(
		redisClient,
		'idas:rl:account:reset:req:email:',
		config.windowMs,
		config.ipEmailMax,
		(req: Request) => {
			const digest = emailDigestFromBody(req)
			return digest ? `${safeIpKey(req)}::${digest}` : safeIpKey(req)
		}
	)

	const ipLimiter = createAccountRateLimit(
		redisClient,
		'idas:rl:account:reset:req:ip:',
		config.windowMs,
		config.ipMax,
		(req: Request) => safeIpKey(req)
	)

	return [ipEmailLimiter, ipLimiter]
}

/**
 * Password reset completion limiter:
 * - 10 request / 15 minutes per IP + route
 */
export const createPasswordResetCompletionLimiter = (
	redisClient: RedisClient,
	config: { windowMs: number; ipRouteMax: number }
) => {
	return createAccountRateLimit(
		redisClient,
		'idas:rl:account:reset:complete:',
		config.windowMs,
		config.ipRouteMax,
		(req: Request) => `${safeIpKey(req)}::${req.path}`
	)
}
