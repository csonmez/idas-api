import bcrypt from 'bcryptjs'
import { sql } from 'kysely'
import { createDb } from '../database/index.ts'
import { PERMISSIONS } from '../modules/authorization/authorization.types.ts'

const DEFAULT_EMAIL = 'login.test@idas.local'
const DEFAULT_PASSWORD = 'LoginTest12345!'

const getRequiredEnv = (name: string): string => {
	const value = process.env[name]?.trim()
	if (!value) {
		throw new Error(`${name} is required`)
	}
	return value
}

const getBcryptRounds = (): number => {
	const raw = process.env.BCRYPT_ROUNDS
	if (!raw) return 12

	const parsed = Number.parseInt(raw, 10)
	if (!Number.isInteger(parsed) || parsed < 10 || parsed > 13) {
		throw new Error('BCRYPT_ROUNDS must be an integer between 10 and 13')
	}

	return parsed
}

const seed = async () => {
	const email = (process.env.SEED_LOGIN_EMAIL ?? DEFAULT_EMAIL).trim().toLowerCase()
	const password = process.env.SEED_LOGIN_PASSWORD ?? DEFAULT_PASSWORD
	const db = createDb(getRequiredEnv('DATABASE_URL'), {
		max: 2,
		idleTimeoutMillis: 5_000,
		connectionTimeoutMillis: 5_000
	})

	try {
		const passwordHash = await bcrypt.hash(password, getBcryptRounds())

		const result = await db.transaction().execute(async (trx) => {
			const existingAcademicUnit = await trx
				.selectFrom('academicUnits')
				.select(['id'])
				.where('code', '=', 'TEST-FAC')
				.where('deletedAt', 'is', null)
				.executeTakeFirst()

			const academicUnit =
				existingAcademicUnit ??
				(await trx
					.insertInto('academicUnits')
					.values({
						code: 'TEST-FAC',
						name: 'Test Faculty',
						shortName: 'TESTFAC',
						type: 'FACULTY',
						academicField: 'SCIENCE_ENGINEERING',
						subUnitLevel: 'DISCIPLINE',
						isTracked: true,
						email: 'test.faculty@idas.local'
					})
					.returning(['id'])
					.executeTakeFirstOrThrow())

			if (existingAcademicUnit) {
				await trx
					.updateTable('academicUnits')
					.set({
						name: 'Test Faculty',
						shortName: 'TESTFAC',
						type: 'FACULTY',
						academicField: 'SCIENCE_ENGINEERING',
						subUnitLevel: 'DISCIPLINE',
						isTracked: true,
						email: 'test.faculty@idas.local',
						updatedAt: sql`NOW()`
					})
					.where('id', '=', academicUnit.id)
					.execute()
			}

			const existingDepartment = await trx
				.selectFrom('departments')
				.select(['id'])
				.where('academicUnitId', '=', academicUnit.id)
				.where('code', '=', 'TEST-DEP')
				.where('deletedAt', 'is', null)
				.executeTakeFirst()

			const department =
				existingDepartment ??
				(await trx
					.insertInto('departments')
					.values({
						academicUnitId: academicUnit.id,
						code: 'TEST-DEP',
						name: 'Test Department',
						shortName: 'TESTDEP',
						email: 'test.department@idas.local'
					})
					.returning(['id'])
					.executeTakeFirstOrThrow())

			if (existingDepartment) {
				await trx
					.updateTable('departments')
					.set({
						name: 'Test Department',
						shortName: 'TESTDEP',
						email: 'test.department@idas.local',
						updatedAt: sql`NOW()`
					})
					.where('id', '=', department.id)
					.execute()
			}

			const existingDiscipline = await trx
				.selectFrom('disciplines')
				.select(['id'])
				.where('academicUnitId', '=', academicUnit.id)
				.where('departmentId', '=', department.id)
				.where('code', '=', 'TEST-DIS')
				.where('deletedAt', 'is', null)
				.executeTakeFirst()

			const discipline =
				existingDiscipline ??
				(await trx
					.insertInto('disciplines')
					.values({
						academicUnitId: academicUnit.id,
						departmentId: department.id,
						code: 'TEST-DIS',
						name: 'Test Discipline',
						shortName: 'TESTDIS',
						email: 'test.discipline@idas.local'
					})
					.returning(['id'])
					.executeTakeFirstOrThrow())

			if (existingDiscipline) {
				await trx
					.updateTable('disciplines')
					.set({
						name: 'Test Discipline',
						shortName: 'TESTDIS',
						email: 'test.discipline@idas.local',
						updatedAt: sql`NOW()`
					})
					.where('id', '=', discipline.id)
					.execute()
			}

			const existingUser = await trx.selectFrom('users').select(['id']).where('email', '=', email).executeTakeFirst()

			const user =
				existingUser ??
				(await trx
					.insertInto('users')
					.values({
						name: 'Login',
						surname: 'Tester',
						email,
						userType: 'ACADEMICIAN',
						title: 'ASSISTANT_PROFESSOR',
						status: 'ACTIVE',
						iban: 'TR000000000000000000000000'
					})
					.returning(['id'])
					.executeTakeFirstOrThrow())

			if (existingUser) {
				await trx
					.updateTable('users')
					.set({
						name: 'Login',
						surname: 'Tester',
						userType: 'ACADEMICIAN',
						title: 'ASSISTANT_PROFESSOR',
						status: 'ACTIVE',
						iban: 'TR000000000000000000000000',
						deletedAt: null,
						updatedAt: sql`NOW()`
					})
					.where('id', '=', user.id)
					.execute()
			}

			await trx
				.insertInto('userCredentials')
				.values({
					userId: user.id,
					passwordHash,
					passwordChangedAt: sql`NOW()`,
					failedLoginCount: 0,
					lockedUntil: null
				})
				.onConflict((oc) =>
					oc.column('userId').doUpdateSet({
						passwordHash,
						passwordChangedAt: sql`NOW()`,
						failedLoginCount: 0,
						lockedUntil: null,
						updatedAt: sql`NOW()`
					})
				)
				.execute()

			const existingPrimaryAffiliation = await trx
				.selectFrom('userAcademicAffiliations')
				.select(['id'])
				.where('userId', '=', user.id)
				.where('affiliationType', '=', 'PRIMARY')
				.where('deletedAt', 'is', null)
				.executeTakeFirst()

			if (existingPrimaryAffiliation) {
				await trx
					.updateTable('userAcademicAffiliations')
					.set({
						academicUnitId: academicUnit.id,
						departmentId: department.id,
						disciplineId: discipline.id,
						updatedAt: sql`NOW()`
					})
					.where('id', '=', existingPrimaryAffiliation.id)
					.execute()
			} else {
				await trx
					.insertInto('userAcademicAffiliations')
					.values({
						userId: user.id,
						academicUnitId: academicUnit.id,
						departmentId: department.id,
						disciplineId: discipline.id,
						affiliationType: 'PRIMARY'
					})
					.execute()
			}

			const permissions = [
				PERMISSIONS.USER_READ,
				PERMISSIONS.USER_WRITE,
				PERMISSIONS.DEPARTMENT_MANAGE,
				PERMISSIONS.DISCIPLINE_MANAGE,
				PERMISSIONS.REPORT_READ,
				PERMISSIONS.REPORT_WRITE
			]

			const existingGlobalRole = await trx
				.selectFrom('rolePermissions')
				.select(['id'])
				.where('userId', '=', user.id)
				.where('role', '=', 'TEST_ADMIN')
				.where('scopeType', '=', 'GLOBAL')
				.where('deletedAt', 'is', null)
				.executeTakeFirst()

			if (existingGlobalRole) {
				await trx
					.updateTable('rolePermissions')
					.set({
						permissions,
						academicUnitId: null,
						departmentId: null,
						disciplineId: null,
						updatedAt: sql`NOW()`
					})
					.where('id', '=', existingGlobalRole.id)
					.execute()
			} else {
				await trx
					.insertInto('rolePermissions')
					.values({
						userId: user.id,
						role: 'TEST_ADMIN',
						permissions,
						scopeType: 'GLOBAL',
						academicUnitId: null,
						departmentId: null,
						disciplineId: null
					})
					.execute()
			}

			const existingDepartmentRole = await trx
				.selectFrom('rolePermissions')
				.select(['id'])
				.where('userId', '=', user.id)
				.where('role', '=', 'TEST_DEPARTMENT_MANAGER')
				.where('scopeType', '=', 'DEPARTMENT')
				.where('departmentId', '=', department.id)
				.where('deletedAt', 'is', null)
				.executeTakeFirst()

			if (existingDepartmentRole) {
				await trx
					.updateTable('rolePermissions')
					.set({
						permissions: [PERMISSIONS.DEPARTMENT_MANAGE, PERMISSIONS.DISCIPLINE_MANAGE, PERMISSIONS.REPORT_READ],
						academicUnitId: academicUnit.id,
						departmentId: department.id,
						disciplineId: null,
						updatedAt: sql`NOW()`
					})
					.where('id', '=', existingDepartmentRole.id)
					.execute()
			} else {
				await trx
					.insertInto('rolePermissions')
					.values({
						userId: user.id,
						role: 'TEST_DEPARTMENT_MANAGER',
						permissions: [PERMISSIONS.DEPARTMENT_MANAGE, PERMISSIONS.DISCIPLINE_MANAGE, PERMISSIONS.REPORT_READ],
						scopeType: 'DEPARTMENT',
						academicUnitId: academicUnit.id,
						departmentId: department.id,
						disciplineId: null
					})
					.execute()
			}

			return {
				userId: user.id,
				email,
				academicUnitId: academicUnit.id,
				departmentId: department.id,
				disciplineId: discipline.id
			}
		})

		console.log('Seed login user created or updated.')
		console.log(`Email: ${result.email}`)
		console.log(`Password: ${password}`)
		console.log(`User ID: ${result.userId}`)
		console.log(`Academic Unit ID: ${result.academicUnitId}`)
		console.log(`Department ID: ${result.departmentId}`)
		console.log(`Discipline ID: ${result.disciplineId}`)
	} finally {
		await db.destroy()
	}
}

seed().catch((error: unknown) => {
	console.error(error)
	process.exitCode = 1
})
