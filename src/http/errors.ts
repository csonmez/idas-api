import type { Response } from 'express'

export type AppErrorCode =
	| 'BAD_REQUEST'
	| 'VALIDATION_ERROR'
	| 'UNAUTHENTICATED'
	| 'FORBIDDEN'
	| 'NOT_FOUND'
	| 'CONFLICT'
	| 'PAYLOAD_TOO_LARGE'
	| 'TOO_MANY_REQUESTS'
	| 'SERVICE_UNAVAILABLE'
	| 'INTERNAL_ERROR'

const ERROR_STATUS_MAP: Record<AppErrorCode, number> = {
	BAD_REQUEST: 400,
	VALIDATION_ERROR: 400,
	UNAUTHENTICATED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
	PAYLOAD_TOO_LARGE: 413,
	TOO_MANY_REQUESTS: 429,
	SERVICE_UNAVAILABLE: 503,
	INTERNAL_ERROR: 500
}

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

const isJsonPrimitive = (value: unknown): value is JsonPrimitive => {
	if (value === null) return true
	const t = typeof value
	return t === 'string' || t === 'boolean' || (t === 'number' && Number.isFinite(value))
}

const sanitizeJsonValue = (value: unknown, seen: WeakSet<object>): JsonValue | undefined => {
	if (isJsonPrimitive(value)) return value

	if (Array.isArray(value)) {
		if (seen.has(value)) return undefined
		seen.add(value)
		const result: JsonValue[] = []
		for (const item of value) {
			const sanitized = sanitizeJsonValue(item, seen)
			if (sanitized !== undefined) {
				result.push(sanitized)
			}
		}
		return result
	}

	if (typeof value === 'object' && value !== null && !(value instanceof Error)) {
		if (seen.has(value)) return undefined
		seen.add(value)
		const result: JsonObject = {}
		for (const [k, v] of Object.entries(value)) {
			const sanitized = sanitizeJsonValue(v, seen)
			if (sanitized !== undefined) {
				result[k] = sanitized
			}
		}
		return result
	}

	return undefined
}

export const sanitizeDetails = (details: unknown): JsonObject => {
	try {
		const sanitized = sanitizeJsonValue(details, new WeakSet())
		if (sanitized !== null && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
			return sanitized as JsonObject
		}
		return {}
	} catch {
		return {}
	}
}

export class AppError extends Error {
	readonly code: AppErrorCode
	readonly statusCode: number
	readonly details: JsonObject

	constructor(code: AppErrorCode, message: string, details?: JsonObject) {
		super(message)
		this.name = 'AppError'
		this.code = code
		this.statusCode = ERROR_STATUS_MAP[code]
		this.details = sanitizeDetails(details)
	}
}

export const sendError = (
	res: Response,
	status: number,
	code: AppErrorCode,
	message: string,
	details: JsonObject = {}
): void => {
	const safeDetails = sanitizeDetails(details)

	res.status(status).json({
		error: {
			code,
			message,
			details: safeDetails
		}
	})
}
