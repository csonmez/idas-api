import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateGlobalPermission, evaluateScopedPermission } from '../authorization.policy.ts'
import { type AuthorizationGrant, PERMISSIONS, type ResolvedScopePath } from '../authorization.types.ts'

const makeGrant = (overrides: Partial<AuthorizationGrant>): AuthorizationGrant => ({
	scopeType: 'GLOBAL',
	permissions: [],
	academicUnitId: null,
	departmentId: null,
	disciplineId: null,
	...overrides
})

const IDS = {
	unitA: 'unit-a',
	unitB: 'unit-b',
	deptA: 'dept-a',
	deptB: 'dept-b',
	discA: 'disc-a',
	discB: 'disc-b'
}

describe('evaluateGlobalPermission', () => {
	it('AUTH-003: GLOBAL grant with matching permission → allow', () => {
		const grants = [makeGrant({ scopeType: 'GLOBAL', permissions: [PERMISSIONS.USER_READ] })]
		assert.equal(evaluateGlobalPermission(grants, PERMISSIONS.USER_READ), true)
	})

	it('AUTH-004: GLOBAL grant with non-matching permission → deny', () => {
		const grants = [makeGrant({ scopeType: 'GLOBAL', permissions: [PERMISSIONS.USER_WRITE] })]
		assert.equal(evaluateGlobalPermission(grants, PERMISSIONS.USER_READ), false)
	})

	it('AUTH-026: ACADEMIC_UNIT scoped grant on global endpoint → deny', () => {
		const grants = [
			makeGrant({ scopeType: 'ACADEMIC_UNIT', permissions: [PERMISSIONS.USER_READ], academicUnitId: IDS.unitA })
		]
		assert.equal(evaluateGlobalPermission(grants, PERMISSIONS.USER_READ), false)
	})

	it('AUTH-026: DEPARTMENT scoped grant on global endpoint → deny', () => {
		const grants = [
			makeGrant({
				scopeType: 'DEPARTMENT',
				permissions: [PERMISSIONS.USER_READ],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptA
			})
		]
		assert.equal(evaluateGlobalPermission(grants, PERMISSIONS.USER_READ), false)
	})

	it('AUTH-026: DISCIPLINE scoped grant on global endpoint → deny', () => {
		const grants = [
			makeGrant({
				scopeType: 'DISCIPLINE',
				permissions: [PERMISSIONS.USER_READ],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptA,
				disciplineId: IDS.discA
			})
		]
		assert.equal(evaluateGlobalPermission(grants, PERMISSIONS.USER_READ), false)
	})

	it('AUTH-002: No grants → deny', () => {
		assert.equal(evaluateGlobalPermission([], PERMISSIONS.USER_READ), false)
	})

	it('AUTH-019: Duplicate GLOBAL grants → allow once (same result)', () => {
		const grants = [
			makeGrant({ scopeType: 'GLOBAL', permissions: [PERMISSIONS.REPORT_READ] }),
			makeGrant({ scopeType: 'GLOBAL', permissions: [PERMISSIONS.REPORT_READ] })
		]
		assert.equal(evaluateGlobalPermission(grants, PERMISSIONS.REPORT_READ), true)
	})

	it('AUTH-014: Union of grants — one matches → allow', () => {
		const grants = [
			makeGrant({ scopeType: 'GLOBAL', permissions: ['other:action'] }),
			makeGrant({ scopeType: 'GLOBAL', permissions: [PERMISSIONS.USER_READ] })
		]
		assert.equal(evaluateGlobalPermission(grants, PERMISSIONS.USER_READ), true)
	})
})

describe('evaluateScopedPermission — ACADEMIC_UNIT target', () => {
	const target: ResolvedScopePath = { kind: 'ACADEMIC_UNIT', academicUnitId: IDS.unitA }

	it('AUTH-025: GLOBAL grant → allow for ACADEMIC_UNIT target', () => {
		const grants = [makeGrant({ scopeType: 'GLOBAL', permissions: [PERMISSIONS.DEPARTMENT_MANAGE] })]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DEPARTMENT_MANAGE, target), true)
	})

	it('AUTH-005: ACADEMIC_UNIT grant on same unit → allow', () => {
		const grants = [
			makeGrant({ scopeType: 'ACADEMIC_UNIT', permissions: [PERMISSIONS.DEPARTMENT_MANAGE], academicUnitId: IDS.unitA })
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DEPARTMENT_MANAGE, target), true)
	})

	it('AUTH-008: ACADEMIC_UNIT grant on different unit → deny', () => {
		const grants = [
			makeGrant({ scopeType: 'ACADEMIC_UNIT', permissions: [PERMISSIONS.DEPARTMENT_MANAGE], academicUnitId: IDS.unitB })
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DEPARTMENT_MANAGE, target), false)
	})

	it('DEPARTMENT grant → deny for ACADEMIC_UNIT target', () => {
		const grants = [
			makeGrant({
				scopeType: 'DEPARTMENT',
				permissions: [PERMISSIONS.DEPARTMENT_MANAGE],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptA
			})
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DEPARTMENT_MANAGE, target), false)
	})
})

describe('evaluateScopedPermission — DEPARTMENT target', () => {
	const target: ResolvedScopePath = { kind: 'DEPARTMENT', academicUnitId: IDS.unitA, departmentId: IDS.deptA }

	it('AUTH-025: GLOBAL grant → allow for DEPARTMENT target', () => {
		const grants = [makeGrant({ scopeType: 'GLOBAL', permissions: [PERMISSIONS.DEPARTMENT_MANAGE] })]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DEPARTMENT_MANAGE, target), true)
	})

	it('AUTH-006: ACADEMIC_UNIT grant on parent unit → allow (child department)', () => {
		const grants = [
			makeGrant({ scopeType: 'ACADEMIC_UNIT', permissions: [PERMISSIONS.DEPARTMENT_MANAGE], academicUnitId: IDS.unitA })
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DEPARTMENT_MANAGE, target), true)
	})

	it('AUTH-008: ACADEMIC_UNIT grant on different unit → deny (child department)', () => {
		const grants = [
			makeGrant({ scopeType: 'ACADEMIC_UNIT', permissions: [PERMISSIONS.DEPARTMENT_MANAGE], academicUnitId: IDS.unitB })
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DEPARTMENT_MANAGE, target), false)
	})

	it('AUTH-009: DEPARTMENT grant on same department → allow', () => {
		const grants = [
			makeGrant({
				scopeType: 'DEPARTMENT',
				permissions: [PERMISSIONS.DEPARTMENT_MANAGE],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptA
			})
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DEPARTMENT_MANAGE, target), true)
	})

	it('AUTH-011: DEPARTMENT grant on sibling department → deny', () => {
		const grants = [
			makeGrant({
				scopeType: 'DEPARTMENT',
				permissions: [PERMISSIONS.DEPARTMENT_MANAGE],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptB
			})
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DEPARTMENT_MANAGE, target), false)
	})

	it('DISCIPLINE grant → deny for DEPARTMENT target', () => {
		const grants = [
			makeGrant({
				scopeType: 'DISCIPLINE',
				permissions: [PERMISSIONS.DEPARTMENT_MANAGE],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptA,
				disciplineId: IDS.discA
			})
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DEPARTMENT_MANAGE, target), false)
	})
})

describe('evaluateScopedPermission — DISCIPLINE target', () => {
	const target: ResolvedScopePath = {
		kind: 'DISCIPLINE',
		academicUnitId: IDS.unitA,
		departmentId: IDS.deptA,
		disciplineId: IDS.discA
	}

	it('AUTH-025: GLOBAL grant → allow for DISCIPLINE target', () => {
		const grants = [makeGrant({ scopeType: 'GLOBAL', permissions: [PERMISSIONS.DISCIPLINE_MANAGE] })]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DISCIPLINE_MANAGE, target), true)
	})

	it('AUTH-007: ACADEMIC_UNIT grant on parent unit → allow (child discipline)', () => {
		const grants = [
			makeGrant({ scopeType: 'ACADEMIC_UNIT', permissions: [PERMISSIONS.DISCIPLINE_MANAGE], academicUnitId: IDS.unitA })
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DISCIPLINE_MANAGE, target), true)
	})

	it('AUTH-008: ACADEMIC_UNIT grant on different unit → deny for DISCIPLINE target', () => {
		const grants = [
			makeGrant({ scopeType: 'ACADEMIC_UNIT', permissions: [PERMISSIONS.DISCIPLINE_MANAGE], academicUnitId: IDS.unitB })
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DISCIPLINE_MANAGE, target), false)
	})

	it('AUTH-010: DEPARTMENT grant on parent department → allow (child discipline)', () => {
		const grants = [
			makeGrant({
				scopeType: 'DEPARTMENT',
				permissions: [PERMISSIONS.DISCIPLINE_MANAGE],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptA
			})
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DISCIPLINE_MANAGE, target), true)
	})

	it('AUTH-011: DEPARTMENT grant on sibling department → deny for DISCIPLINE target', () => {
		const grants = [
			makeGrant({
				scopeType: 'DEPARTMENT',
				permissions: [PERMISSIONS.DISCIPLINE_MANAGE],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptB
			})
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DISCIPLINE_MANAGE, target), false)
	})

	it('AUTH-012: DISCIPLINE grant on same discipline → allow', () => {
		const grants = [
			makeGrant({
				scopeType: 'DISCIPLINE',
				permissions: [PERMISSIONS.DISCIPLINE_MANAGE],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptA,
				disciplineId: IDS.discA
			})
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DISCIPLINE_MANAGE, target), true)
	})

	it('AUTH-013: DISCIPLINE grant on different discipline → deny', () => {
		const grants = [
			makeGrant({
				scopeType: 'DISCIPLINE',
				permissions: [PERMISSIONS.DISCIPLINE_MANAGE],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptA,
				disciplineId: IDS.discB
			})
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.DISCIPLINE_MANAGE, target), false)
	})
})

describe('evaluateScopedPermission — union and grant validity edge cases', () => {
	const target: ResolvedScopePath = {
		kind: 'DISCIPLINE',
		academicUnitId: IDS.unitA,
		departmentId: IDS.deptA,
		disciplineId: IDS.discA
	}

	it('AUTH-014: Multiple grants — union allows if any one matches', () => {
		const grants = [
			makeGrant({ scopeType: 'GLOBAL', permissions: ['other:action'] }),
			makeGrant({ scopeType: 'GLOBAL', permissions: [PERMISSIONS.REPORT_READ] })
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.REPORT_READ, target), true)
	})

	it('AUTH-014: Multiple grants — none match → deny', () => {
		const grants = [
			makeGrant({ scopeType: 'GLOBAL', permissions: ['other:action'] }),
			makeGrant({ scopeType: 'ACADEMIC_UNIT', permissions: ['something:else'], academicUnitId: IDS.unitB })
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.REPORT_READ, target), false)
	})

	it('AUTH-019: Duplicate GLOBAL grants → allow (union)', () => {
		const grants = [
			makeGrant({ scopeType: 'GLOBAL', permissions: [PERMISSIONS.REPORT_READ] }),
			makeGrant({ scopeType: 'GLOBAL', permissions: [PERMISSIONS.REPORT_READ] })
		]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.REPORT_READ, target), true)
	})

	it('AUTH-004: Wrong permission string on valid grant → deny', () => {
		const grants = [makeGrant({ scopeType: 'GLOBAL', permissions: [PERMISSIONS.REPORT_WRITE] })]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.REPORT_READ, target), false)
	})

	it('Empty permissions array on grant → deny', () => {
		const grants = [makeGrant({ scopeType: 'GLOBAL', permissions: [] })]
		assert.equal(evaluateScopedPermission(grants, PERMISSIONS.REPORT_READ, target), false)
	})

	it('No grants at all → deny', () => {
		assert.equal(evaluateScopedPermission([], PERMISSIONS.REPORT_READ, target), false)
	})
})

describe('Permission string format contract', () => {
	it('Defined permission constants follow resource:action lower-kebab-case format', () => {
		for (const perm of Object.values(PERMISSIONS)) {
			const parts = perm.split(':')
			assert.equal(parts.length, 2, `Permission "${perm}" must have exactly one ":"`)
			const resource = parts[0] ?? ''
			const action = parts[1] ?? ''
			assert.match(resource, /^[a-z][a-z0-9-]*$/, `Resource in "${perm}" must be lower-kebab-case`)
			assert.match(action, /^[a-z][a-z0-9-]*$/, `Action in "${perm}" must be lower-kebab-case`)
		}
	})
})
