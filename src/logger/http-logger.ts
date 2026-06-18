import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Response } from 'express'
import { pinoHttp } from 'pino-http'
import { logger } from './index.ts'

const HEALTH_PATHS = new Set(['/health/live', '/health/ready'])

const shouldSkipHealthLog = (req: IncomingMessage, res: ServerResponse) => {
	return HEALTH_PATHS.has(req.url ?? '') && res.statusCode >= 200 && res.statusCode < 300
}

export const httpLogger = pinoHttp({
	logger,
	genReqId: (_req, res) => {
		const requestId = (res as Response).locals.requestId

		if (typeof requestId === 'string' && requestId.length > 0) {
			return requestId
		}

		return randomUUID()
	},
	autoLogging: {
		ignore: (req) => HEALTH_PATHS.has(req.url ?? '')
	},
	customSuccessMessage: (req, res) => {
		if (shouldSkipHealthLog(req, res)) {
			return ''
		}

		return 'request completed'
	},
	customLogLevel: (req, res, error) => {
		if (shouldSkipHealthLog(req, res)) {
			return 'silent'
		}

		if (error || res.statusCode >= 500) {
			return 'error'
		}

		if (res.statusCode >= 400) {
			return 'warn'
		}

		return 'info'
	}
})
