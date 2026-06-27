import { randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { AppDependencies } from '../app.types.ts'
import { sendError } from '../http/errors.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const CSRF_TOKEN_PATH = '/csrf-token'

const createCsrfToken = () => {
	return randomBytes(32).toString('hex')
}

export const createCsrfMiddleware = (deps: AppDependencies) => {
	const headerName = deps.config.auth.csrfHeaderName

	return (req: Request, res: Response, next: NextFunction) => {
		if (SAFE_METHODS.has(req.method)) {
			next()
			return
		}

		if (req.path === CSRF_TOKEN_PATH) {
			next()
			return
		}

		const sessionToken = req.session.csrfToken
		const headerToken = req.header(headerName)

		if (
			typeof sessionToken === 'string' &&
			typeof headerToken === 'string' &&
			sessionToken.length > 0 &&
			headerToken === sessionToken
		) {
			next()
			return
		}

		sendError(res, 403, 'FORBIDDEN', 'Invalid CSRF token')
	}
}

export const issueCsrfToken = (req: Request) => {
	const token = createCsrfToken()
	req.session.csrfToken = token
	return token
}
