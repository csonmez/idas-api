import type { Request, Response } from 'express'

export const notFoundHandler = (_req: Request, res: Response) => {
	res.status(404).json({
		error: 'NOT_FOUND',
		message: 'Not found',
		details: {}
	})
}
