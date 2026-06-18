import { rateLimit } from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import type { RedisClient } from '../redis/client.ts'

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000
const RATE_LIMIT_MAX = 300

export const createApiRateLimit = (redisClient: RedisClient, isProduction: boolean) => {
	const commonOptions = {
		windowMs: RATE_LIMIT_WINDOW_MS,
		max: RATE_LIMIT_MAX,
		standardHeaders: true,
		legacyHeaders: false,
		skip: (req: { method: string }) => req.method === 'OPTIONS',
		handler: (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
			res.status(429).json({
				error: 'TOO_MANY_REQUESTS',
				message: 'Too many requests',
				details: {}
			})
		}
	}

	if (!isProduction) {
		return rateLimit(commonOptions)
	}

	return rateLimit({
		...commonOptions,
		passOnStoreError: true,
		store: new RedisStore({
			sendCommand: (...args: string[]) => redisClient.sendCommand(args)
		}),
		handler: (
			_req: unknown,
			res: { status: (code: number) => { json: (body: unknown) => void } },
			_next: unknown,
			options: { message?: string }
		) => {
			if (options.message?.includes('store')) {
				res.status(503).json({
					error: 'SERVICE_UNAVAILABLE',
					message: 'Service unavailable',
					details: {}
				})
				return
			}

			res.status(429).json({
				error: 'TOO_MANY_REQUESTS',
				message: 'Too many requests',
				details: {}
			})
		}
	})
}
