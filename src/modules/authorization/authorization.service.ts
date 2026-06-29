import { evaluateGlobalPermission, evaluateScopedPermission } from './authorization.policy.ts'
import type { AuthorizationRepository } from './authorization.repository.ts'
import type { Permission, TargetScopeType } from './authorization.types.ts'

type AuthorizationServiceDeps = {
	repository: AuthorizationRepository
}

export type AuthorizationService = {
	/**
	 * Checks a global-only permission. Only GLOBAL grants are accepted.
	 * Used by requirePermission.
	 */
	authorizePermission(userId: string, permission: Permission, now: Date): Promise<boolean>

	/**
	 * Checks a scoped permission. Resolves the target scope path and evaluates
	 * the scope inheritance matrix. Used by requireScopedPermission.
	 * Returns false if the target is not found or is soft-deleted (FORBIDDEN, not NOT_FOUND).
	 */
	authorizeScoped(
		userId: string,
		permission: Permission,
		targetScopeType: TargetScopeType,
		targetId: string,
		now: Date
	): Promise<boolean>
}

export const createAuthorizationService = ({ repository }: AuthorizationServiceDeps): AuthorizationService => {
	return {
		async authorizePermission(userId, permission, now) {
			const grants = await repository.findActiveGrantsForPermission(userId, permission, now)
			return evaluateGlobalPermission(grants, permission)
		},

		async authorizeScoped(userId, permission, targetScopeType, targetId, now) {
			let targetPath: import('./authorization.types.ts').ResolvedScopePath | null = null

			if (targetScopeType === 'ACADEMIC_UNIT') {
				targetPath = await repository.resolveAcademicUnitScopePath(targetId)
			} else if (targetScopeType === 'DEPARTMENT') {
				targetPath = await repository.resolveDepartmentScopePath(targetId)
			} else if (targetScopeType === 'DISCIPLINE') {
				targetPath = await repository.resolveDisciplineScopePath(targetId)
			}

			if (!targetPath) {
				return false
			}

			const grants = await repository.findActiveGrantsForPermission(userId, permission, now)
			return evaluateScopedPermission(grants, permission, targetPath)
		}
	}
}
