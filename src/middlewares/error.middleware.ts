import type { NextFunction, Request, Response } from 'express'

type ErrorWithStatus = Error & {
	status?: number
	statusCode?: number
	type?: string
	code?: string
}

const getStatusCode = (error: ErrorWithStatus) => {
	if (typeof error.status === 'number') {
		return error.status
	}

	if (typeof error.statusCode === 'number') {
		return error.statusCode
	}

	if (error.type === 'entity.parse.failed') {
		return 400
	}

	if (error.type === 'entity.too.large') {
		return 413
	}

	return 500
}

const getErrorCode = (statusCode: number) => {
	switch (statusCode) {
		case 400:
			return 'BAD_REQUEST'
		case 403:
			return 'FORBIDDEN'
		case 404:
			return 'NOT_FOUND'
		case 413:
			return 'PAYLOAD_TOO_LARGE'
		default:
			return 'INTERNAL_ERROR'
	}
}

const getPublicMessage = (statusCode: number, error: ErrorWithStatus) => {
	switch (statusCode) {
		case 400:
			return 'Bad request'
		case 403:
			return 'Forbidden'
		case 404:
			return 'Not found'
		case 413:
			return 'Payload too large'
		default:
			return error.message && statusCode < 500 ? error.message : 'Internal server error'
	}
}

export const errorHandler = (error: ErrorWithStatus, req: Request, res: Response, next: NextFunction) => {
	if (res.headersSent) {
		next(error)
		return
	}

	const statusCode = getStatusCode(error)
	const errorCode = getErrorCode(statusCode)

	res.status(statusCode).json({
		error: errorCode,
		message: getPublicMessage(statusCode, error),
		details: {}
	})
}
