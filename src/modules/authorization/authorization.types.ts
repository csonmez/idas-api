import type { RoleScopeType } from '../../database/db.generated.ts'

/**
 * Express.User global type augmentation.
 * Shape is derived from deserializeUser output: { id, status }.
 * Owner: authorization phase.
 */
declare global {
	namespace Express {
		interface User {
			id: string
			status: 'ACTIVE' | 'INACTIVE'
		}
	}
}

export type ScopeType = RoleScopeType

export const PERMISSIONS = {
	USER_READ: 'user:read',
	USER_WRITE: 'user:write',
	DEPARTMENT_MANAGE: 'department:manage',
	DISCIPLINE_MANAGE: 'discipline:manage',
	REPORT_READ: 'report:read',
	REPORT_WRITE: 'report:write'
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export type AuthorizationGrant = {
	scopeType: ScopeType
	permissions: string[]
	academicUnitId: string | null
	departmentId: string | null
	disciplineId: string | null
}

export type TargetScopeType = 'ACADEMIC_UNIT' | 'DEPARTMENT' | 'DISCIPLINE'

export type AcademicUnitScopePath = {
	kind: 'ACADEMIC_UNIT'
	academicUnitId: string
}

export type DepartmentScopePath = {
	kind: 'DEPARTMENT'
	academicUnitId: string
	departmentId: string
}

export type DisciplineScopePath = {
	kind: 'DISCIPLINE'
	academicUnitId: string
	departmentId: string
	disciplineId: string
}

export type ResolvedScopePath = AcademicUnitScopePath | DepartmentScopePath | DisciplineScopePath

export type RequireScopedPermissionOptions = {
	permission: Permission
	targetScopeType: TargetScopeType
	resolveTargetId: (req: import('express').Request) => string
	/** Forward-compat field; not enforced in this phase. */
	exactScopeOnly?: boolean
}

export type AuthorizationDecision = { allowed: true } | { allowed: false }
