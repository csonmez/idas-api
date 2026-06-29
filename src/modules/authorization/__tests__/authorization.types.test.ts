import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { requirePermission, requireScopedPermission } from '../authorization.middleware.ts'
import type { AuthorizationService } from '../authorization.service.ts'
import { PERMISSIONS, type RequireScopedPermissionOptions } from '../authorization.types.ts'

const assertPermissionCallerTypes = () => {
	const service = {} as AuthorizationService

	requirePermission({ service }, PERMISSIONS.USER_READ)
	requireScopedPermission(
		{ service },
		{
			permission: PERMISSIONS.DEPARTMENT_MANAGE,
			targetScopeType: 'DEPARTMENT',
			resolveTargetId: (req) => String(req.params.id)
		}
	)

	// @ts-expect-error route callers must use the Permission union, not arbitrary string literals.
	requirePermission({ service }, 'usr:read')

	const invalidScopedOptions = {
		// @ts-expect-error scoped route callers must use the Permission union, not arbitrary string literals.
		permission: 'department:mange',
		targetScopeType: 'DEPARTMENT',
		resolveTargetId: (req) => String(req.params.id)
	} satisfies RequireScopedPermissionOptions

	void invalidScopedOptions
}

void assertPermissionCallerTypes

describe('PERMISSIONS', () => {
	it('contains the current authorization permission constants', () => {
		assert.deepEqual(Object.values(PERMISSIONS).sort(), [
			'department:manage',
			'discipline:manage',
			'report:read',
			'report:write',
			'user:read',
			'user:write'
		])
	})
})
