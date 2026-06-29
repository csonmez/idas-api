import { type Kysely, sql } from 'kysely'
import type { DB } from '../../database/db.generated.ts'
import type {
	AcademicUnitScopePath,
	AuthorizationGrant,
	DepartmentScopePath,
	DisciplineScopePath,
	Permission
} from './authorization.types.ts'

type AuthorizationRepositoryDeps = {
	db: Kysely<DB>
}

export type AuthorizationRepository = {
	findActiveGrantsForPermission(userId: string, permission: Permission, now: Date): Promise<AuthorizationGrant[]>
	resolveAcademicUnitScopePath(academicUnitId: string): Promise<AcademicUnitScopePath | null>
	resolveDepartmentScopePath(departmentId: string): Promise<DepartmentScopePath | null>
	resolveDisciplineScopePath(disciplineId: string): Promise<DisciplineScopePath | null>
}

export const buildFindActiveGrantsForPermissionQuery = (
	db: Kysely<DB>,
	userId: string,
	permission: Permission,
	now: Date
) => {
	return db
		.selectFrom('rolePermissions')
		.select(['scopeType', 'permissions', 'academicUnitId', 'departmentId', 'disciplineId'])
		.where('userId', '=', userId)
		.where(sql<boolean>`${sql.ref('permissions')} @> array[${permission}]::text[]`)
		.where('deletedAt', 'is', null)
		.where((eb) => eb.or([eb('startDate', 'is', null), eb('startDate', '<=', now)]))
		.where((eb) => eb.or([eb('endDate', 'is', null), eb('endDate', '>=', now)]))
}

export const createAuthorizationRepository = ({ db }: AuthorizationRepositoryDeps): AuthorizationRepository => {
	return {
		async findActiveGrantsForPermission(userId, permission, now) {
			const rows = await buildFindActiveGrantsForPermissionQuery(db, userId, permission, now).execute()

			return rows.map((row) => ({
				scopeType: row.scopeType,
				permissions: row.permissions,
				academicUnitId: row.academicUnitId,
				departmentId: row.departmentId,
				disciplineId: row.disciplineId
			}))
		},

		async resolveAcademicUnitScopePath(academicUnitId) {
			const row = await db
				.selectFrom('academicUnits')
				.select('id')
				.where('id', '=', academicUnitId)
				.where('deletedAt', 'is', null)
				.executeTakeFirst()

			if (!row) return null

			return { kind: 'ACADEMIC_UNIT', academicUnitId: row.id }
		},

		async resolveDepartmentScopePath(departmentId) {
			const row = await db
				.selectFrom('departments')
				.select(['id', 'academicUnitId'])
				.where('id', '=', departmentId)
				.where('deletedAt', 'is', null)
				.executeTakeFirst()

			if (!row) return null

			return { kind: 'DEPARTMENT', academicUnitId: row.academicUnitId, departmentId: row.id }
		},

		async resolveDisciplineScopePath(disciplineId) {
			const row = await db
				.selectFrom('disciplines')
				.select(['id', 'academicUnitId', 'departmentId'])
				.where('id', '=', disciplineId)
				.where('deletedAt', 'is', null)
				.executeTakeFirst()

			if (!row) return null

			return {
				kind: 'DISCIPLINE',
				academicUnitId: row.academicUnitId,
				departmentId: row.departmentId,
				disciplineId: row.id
			}
		}
	}
}
