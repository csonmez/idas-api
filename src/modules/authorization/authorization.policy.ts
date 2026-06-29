import type { AuthorizationGrant, Permission, ResolvedScopePath } from './authorization.types.ts'

/**
 * Pure policy evaluation — no DB, no Express dependencies.
 *
 * Evaluates whether the given set of active grants allows the requested
 * permission against the target scope path, applying the scope inheritance
 * matrix exactly as defined in the authorization BRAID docs.
 *
 * Effective grant matrix:
 *   ACADEMIC_UNIT target  → GLOBAL | same ACADEMIC_UNIT
 *   DEPARTMENT target     → GLOBAL | parent ACADEMIC_UNIT | same DEPARTMENT
 *   DISCIPLINE target     → GLOBAL | parent ACADEMIC_UNIT | parent DEPARTMENT | same DISCIPLINE
 *
 * For requirePermission (no scoped target) → only GLOBAL grants are accepted.
 */

const grantContainsPermission = (grant: AuthorizationGrant, permission: Permission): boolean =>
	grant.permissions.includes(permission)

const isGlobalGrant = (grant: AuthorizationGrant): boolean => grant.scopeType === 'GLOBAL'

const isEffectiveForAcademicUnitTarget = (grant: AuthorizationGrant, targetAcademicUnitId: string): boolean => {
	if (isGlobalGrant(grant)) return true
	if (grant.scopeType === 'ACADEMIC_UNIT' && grant.academicUnitId === targetAcademicUnitId) return true
	return false
}

const isEffectiveForDepartmentTarget = (
	grant: AuthorizationGrant,
	targetDepartmentId: string,
	parentAcademicUnitId: string
): boolean => {
	if (isGlobalGrant(grant)) return true
	if (grant.scopeType === 'ACADEMIC_UNIT' && grant.academicUnitId === parentAcademicUnitId) return true
	if (grant.scopeType === 'DEPARTMENT' && grant.departmentId === targetDepartmentId) return true
	return false
}

const isEffectiveForDisciplineTarget = (
	grant: AuthorizationGrant,
	targetDisciplineId: string,
	parentDepartmentId: string,
	parentAcademicUnitId: string
): boolean => {
	if (isGlobalGrant(grant)) return true
	if (grant.scopeType === 'ACADEMIC_UNIT' && grant.academicUnitId === parentAcademicUnitId) return true
	if (grant.scopeType === 'DEPARTMENT' && grant.departmentId === parentDepartmentId) return true
	if (grant.scopeType === 'DISCIPLINE' && grant.disciplineId === targetDisciplineId) return true
	return false
}

/**
 * Evaluates a global-only permission check (requirePermission).
 * Only GLOBAL grants are accepted; scoped grants do not satisfy a global endpoint.
 */
export const evaluateGlobalPermission = (grants: AuthorizationGrant[], permission: Permission): boolean => {
	for (const grant of grants) {
		if (isGlobalGrant(grant) && grantContainsPermission(grant, permission)) {
			return true
		}
	}
	return false
}

/**
 * Evaluates a scoped permission check (requireScopedPermission).
 * Applies the scope inheritance matrix against the resolved target scope path.
 */
export const evaluateScopedPermission = (
	grants: AuthorizationGrant[],
	permission: Permission,
	targetPath: ResolvedScopePath
): boolean => {
	for (const grant of grants) {
		if (!grantContainsPermission(grant, permission)) continue

		let effective = false

		if (targetPath.kind === 'ACADEMIC_UNIT') {
			effective = isEffectiveForAcademicUnitTarget(grant, targetPath.academicUnitId)
		} else if (targetPath.kind === 'DEPARTMENT') {
			effective = isEffectiveForDepartmentTarget(grant, targetPath.departmentId, targetPath.academicUnitId)
		} else if (targetPath.kind === 'DISCIPLINE') {
			effective = isEffectiveForDisciplineTarget(
				grant,
				targetPath.disciplineId,
				targetPath.departmentId,
				targetPath.academicUnitId
			)
		}

		if (effective) return true
	}
	return false
}
