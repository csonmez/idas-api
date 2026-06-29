import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { AppError } from '../../http/errors.ts'
import type { AuthorizationService } from './authorization.service.ts'
import type { Permission, RequireScopedPermissionOptions } from './authorization.types.ts'

/**
 * Returns the authenticated user's id, or null if the request is not authenticated.
 * Centralizes the session + req.user.id check shared by every authorization middleware,
 * so each middleware stays self-contained without duplicating the guard.
 */
const getAuthenticatedUserId = (req: Request): string | null => {
	if (!req.isAuthenticated() || !req.user?.id) {
		return null
	}
	return req.user.id
}

/**
 * Checks that the request has an authenticated user (session + req.user with id).
 * Responds with 401 UNAUTHENTICATED if not.
 * Does not perform permission checks — use requirePermission or requireScopedPermission for that.
 */
export const requireAuth = (): RequestHandler => {
	return (req: Request, _res: Response, next: NextFunction): void => {
		if (!getAuthenticatedUserId(req)) {
			next(new AppError('UNAUTHENTICATED', 'Authentication required'))
			return
		}
		next()
	}
}

export type RequirePermissionDeps = {
	service: AuthorizationService
}

/**
 * Requires authentication and a specific GLOBAL permission.
 * Scoped grants (ACADEMIC_UNIT, DEPARTMENT, DISCIPLINE) do not satisfy this middleware —
 * use requireScopedPermission for scoped access.
 */
export const requirePermission = (deps: RequirePermissionDeps, permission: Permission): RequestHandler => {
	return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
		const userId = getAuthenticatedUserId(req)
		if (!userId) {
			next(new AppError('UNAUTHENTICATED', 'Authentication required'))
			return
		}

		const now = new Date()

		try {
			const allowed = await deps.service.authorizePermission(userId, permission, now)

			if (!allowed) {
				next(new AppError('FORBIDDEN', 'Insufficient permissions'))
				return
			}

			next()
		} catch {
			next(new AppError('INTERNAL_ERROR', 'Internal server error'))
		}
	}
}

export type RequireScopedPermissionDeps = {
	service: AuthorizationService
}

/**
 * Requires authentication and a specific permission against a scoped target.
 * Resolves the target id via options.resolveTargetId, then evaluates scope inheritance.
 * If the target is not found or soft-deleted, responds with 403 FORBIDDEN (not 404).
 */
export const requireScopedPermission = (
	deps: RequireScopedPermissionDeps,
	options: RequireScopedPermissionOptions
): RequestHandler => {
	return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
		const userId = getAuthenticatedUserId(req)
		if (!userId) {
			next(new AppError('UNAUTHENTICATED', 'Authentication required'))
			return
		}

		const now = new Date()
		const targetId = options.resolveTargetId(req)

		try {
			const allowed = await deps.service.authorizeScoped(
				userId,
				options.permission,
				options.targetScopeType,
				targetId,
				now
			)

			if (!allowed) {
				next(new AppError('FORBIDDEN', 'Insufficient permissions'))
				return
			}

			next()
		} catch {
			next(new AppError('INTERNAL_ERROR', 'Internal server error'))
		}
	}
}
