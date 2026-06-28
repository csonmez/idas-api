import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { core, ZodType } from 'zod'
import { AppError } from './errors.ts'

const VALIDATION_ERROR_MESSAGE = 'Request validation failed'
const ROOT_FIELD_KEY = '_root'

export type FieldErrors = Record<string, string[]>

const formatPath = (path: core.$ZodIssue['path']): string => {
	if (path.length === 0) {
		return ROOT_FIELD_KEY
	}

	let key = ''
	for (const segment of path) {
		if (typeof segment === 'number') {
			key += `[${segment}]`
		} else {
			const name = String(segment)
			key = key === '' ? name : `${key}.${name}`
		}
	}
	return key
}

export const collectFieldErrors = (issues: core.$ZodIssue[]): FieldErrors => {
	const fields: FieldErrors = Object.create(null)

	for (const issue of issues) {
		const key = formatPath(issue.path)
		const message = issue.message
		if (message.length === 0) {
			continue
		}

		const bucket = fields[key]
		if (bucket === undefined) {
			fields[key] = [message]
		} else if (!bucket.includes(message)) {
			bucket.push(message)
		}
	}

	return fields
}

const createValidationError = (issues: core.$ZodIssue[]): AppError => {
	const fields = collectFieldErrors(issues)
	return new AppError('VALIDATION_ERROR', VALIDATION_ERROR_MESSAGE, { fields })
}

const setQuery = (req: Request, value: unknown): void => {
	Object.defineProperty(req, 'query', {
		value,
		writable: true,
		configurable: true,
		enumerable: true
	})
}

export const validateBody = (schema: ZodType): RequestHandler => {
	return (req: Request, _res: Response, next: NextFunction) => {
		const result = schema.safeParse(req.body)
		if (result.success) {
			req.body = result.data
			next()
			return
		}

		next(createValidationError(result.error.issues))
	}
}

export const validateQuery = (schema: ZodType): RequestHandler => {
	return (req: Request, _res: Response, next: NextFunction) => {
		const result = schema.safeParse(req.query)
		if (result.success) {
			setQuery(req, result.data)
			next()
			return
		}

		next(createValidationError(result.error.issues))
	}
}

export const validateParams = (schema: ZodType): RequestHandler => {
	return (req: Request, _res: Response, next: NextFunction) => {
		const result = schema.safeParse(req.params)
		if (result.success) {
			req.params = result.data as unknown as typeof req.params
			next()
			return
		}

		next(createValidationError(result.error.issues))
	}
}
