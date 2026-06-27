import type { NextFunction, Request, Response } from 'express'
import { AppError, type AppErrorCode, sendError } from '../http/errors.ts'

type FrameworkError = Error & {
	type?: string
}

const getStatusCodeForFrameworkError = (error: FrameworkError): number | null => {
	if (error.name === 'CorsError') {
		return 403
	}

	if (error.type === 'entity.parse.failed') {
		return 400
	}

	if (error.type === 'entity.too.large') {
		return 413
	}

	return null
}

const statusToErrorCode = (statusCode: number): AppErrorCode => {
	switch (statusCode) {
		case 400:
			return 'BAD_REQUEST'
		case 401:
			return 'UNAUTHENTICATED'
		case 403:
			return 'FORBIDDEN'
		case 404:
			return 'NOT_FOUND'
		case 409:
			return 'CONFLICT'
		case 413:
			return 'PAYLOAD_TOO_LARGE'
		case 429:
			return 'TOO_MANY_REQUESTS'
		case 503:
			return 'SERVICE_UNAVAILABLE'
		default:
			return 'INTERNAL_ERROR'
	}
}

const getPublicMessage = (statusCode: number): string => {
	switch (statusCode) {
		case 400:
			return 'Bad request'
		case 401:
			return 'Unauthorized'
		case 403:
			return 'Forbidden'
		case 404:
			return 'Not found'
		case 409:
			return 'Conflict'
		case 413:
			return 'Payload too large'
		case 429:
			return 'Too many requests'
		case 503:
			return 'Service unavailable'
		default:
			return 'Internal server error'
	}
}

export const errorHandler = (error: Error, _req: Request, res: Response, next: NextFunction) => {
	if (res.headersSent) {
		next(error)
		return
	}

	if (error instanceof AppError) {
		if (error.statusCode >= 500) {
			if (error.statusCode === 503 && error.code === 'SERVICE_UNAVAILABLE') {
				sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Service unavailable')
				return
			}

			sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error')
			return
		}

		sendError(res, error.statusCode, error.code, error.message, error.details)
		return
	}

	const frameworkStatus = getStatusCodeForFrameworkError(error as FrameworkError)
	if (frameworkStatus !== null) {
		const code = statusToErrorCode(frameworkStatus)
		const message = getPublicMessage(frameworkStatus)
		sendError(res, frameworkStatus, code, message)
		return
	}

	sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error')
}
