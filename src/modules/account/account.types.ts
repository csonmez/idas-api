/**
 * Account session response DTO'ları (Plan Mimari Karar 4).
 *
 * Bunlar canonical permission kararının kaynağı değil, sadece current session
 * context response'udur. Route authorization kararları authorization
 * middleware/service katmanında verilir.
 */

export type AccountSessionRole = {
	id: string
	role: string
	scopeType: 'GLOBAL' | 'ACADEMIC_UNIT' | 'DEPARTMENT' | 'DISCIPLINE'
	academicUnitId: string | null
	departmentId: string | null
	disciplineId: string | null
	permissions: string[]
}

export type AccountSessionAffiliation = {
	id: string
	affiliationType: 'PRIMARY' | 'SECONDARY'
	academicUnitId: string | null
	departmentId: string | null
	disciplineId: string | null
}

export type AccountSessionUser = {
	id: string
	email: string
	name: string
	surname: string
	userType: 'ACADEMICIAN' | 'POSTDOC' | 'STAFF'
	title: string | null
	status: 'ACTIVE' | 'INACTIVE'
	roles: AccountSessionRole[]
	affiliations: AccountSessionAffiliation[]
}

export type CreateSessionResponse = {
	user: AccountSessionUser
	csrfToken: string
}

export type GetSessionResponse = {
	user: AccountSessionUser
}
