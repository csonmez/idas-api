import type { Request, Response } from 'express'
import { sendError } from '../http/errors.ts'

export const notFoundHandler = (_req: Request, res: Response) => {
	sendError(res, 404, 'NOT_FOUND', 'Not found')
}
