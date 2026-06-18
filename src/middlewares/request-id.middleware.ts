import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export const REQUEST_ID_HEADER = 'x-request-id'
const MAX_REQUEST_ID_LENGTH = 128
const REQUEST_ID_PATTERN = /^[\w.-]+$/

const isValidRequestId = (value: string) => {
	return value.length > 0 && value.length <= MAX_REQUEST_ID_LENGTH && REQUEST_ID_PATTERN.test(value)
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
	const headerValue = req.header(REQUEST_ID_HEADER)
	const requestId = typeof headerValue === 'string' && isValidRequestId(headerValue) ? headerValue : randomUUID()

	res.locals.requestId = requestId
	res.setHeader(REQUEST_ID_HEADER, requestId)
	next()
}
