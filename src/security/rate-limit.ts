import type { NextFunction, Request, Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { AppError, sendError } from '../http/errors.ts'
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
		handler: (_req: Request, res: Response) => {
			sendError(res, 429, 'TOO_MANY_REQUESTS', 'Too many requests')
		}
	}

	if (!isProduction) {
		return rateLimit(commonOptions)
	}

	const limiter = rateLimit({
		...commonOptions,
		passOnStoreError: false,
		store: new RedisStore({
			sendCommand: (...args: string[]) => redisClient.sendCommand(args)
		})
	})

	return (req: Request, res: Response, next: NextFunction) => {
		limiter(req, res, (err?: unknown) => {
			if (err instanceof Error) {
				next(new AppError('SERVICE_UNAVAILABLE', 'Service unavailable'))
				return
			}
			next(err)
		})
	}
}
