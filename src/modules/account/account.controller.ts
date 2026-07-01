import type { NextFunction, Request, Response } from 'express'
import type { AccountService } from './account.service.ts'

export const createAccountController = (service: AccountService) => ({
	async createSession(req: Request, res: Response, next: NextFunction) {
		try {
			const result = await service.createSessionWithPassword(req.body, req)
			res.status(200).json(result)
		} catch (error) {
			next(error)
		}
	},

	async getSession(req: Request, res: Response, next: NextFunction) {
		try {
			const userId = req.user?.id
			if (!userId) {
				res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', details: {} } })
				return
			}
			const result = await service.getCurrentSession(userId)
			res.status(200).json(result)
		} catch (error) {
			next(error)
		}
	},

	async deleteSession(req: Request, res: Response, next: NextFunction) {
		try {
			await service.deleteCurrentSession(req)
			res.status(204).end()
		} catch (error) {
			next(error)
		}
	},

	async createPasswordResetRequest(req: Request, res: Response, next: NextFunction) {
		try {
			await service.createPasswordResetRequest(req.body)
			res.status(204).end()
		} catch (error) {
			next(error)
		}
	},

	async completePasswordReset(req: Request, res: Response, next: NextFunction) {
		try {
			await service.completePasswordReset(req.body)
			res.status(204).end()
		} catch (error) {
			next(error)
		}
	}
})
