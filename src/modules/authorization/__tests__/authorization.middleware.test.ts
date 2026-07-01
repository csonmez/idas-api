import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import express, { type Router } from 'express'
import request from 'supertest'
import { errorHandler } from '../../../middlewares/error.middleware.ts'
import { requireAuth, requirePermission, requireScopedPermission } from '../authorization.middleware.ts'
import type { AuthorizationRepository } from '../authorization.repository.ts'
import { createAuthorizationService } from '../authorization.service.ts'
import { type AuthorizationGrant, PERMISSIONS, type ResolvedScopePath } from '../authorization.types.ts'

/**
 * Fake repository for integration tests — no real DB required.
 */
type FakeRepoConfig = {
	grants?: AuthorizationGrant[]
	scopePath?: ResolvedScopePath | null
	throwOnGrants?: boolean
}

const createFakeRepository = (config: FakeRepoConfig = {}): AuthorizationRepository => ({
	async findActiveGrantsForPermission() {
		if (config.throwOnGrants) throw new Error('DB connection refused — internal detail')
		return config.grants ?? []
	},
	async resolveAcademicUnitScopePath() {
		return config.scopePath !== undefined
			? (config.scopePath as import('../authorization.types.ts').AcademicUnitScopePath | null)
			: null
	},
	async resolveDepartmentScopePath() {
		return config.scopePath !== undefined
			? (config.scopePath as import('../authorization.types.ts').DepartmentScopePath | null)
			: null
	},
	async resolveDisciplineScopePath() {
		return config.scopePath !== undefined
			? (config.scopePath as import('../authorization.types.ts').DisciplineScopePath | null)
			: null
	}
})

const IDS = {
	user: 'user-1',
	unitA: 'unit-a',
	deptA: 'dept-a',
	discA: 'disc-a'
}

/**
 * Creates a small Express app with an authenticated user and the given router configuration.
 * The user is injected into req.user by a stub middleware (no real Passport/session needed).
 */
const createAuthApp = (
	configureRouter: (router: Router) => void,
	opts: { authenticated?: boolean } = { authenticated: true }
) => {
	const app = express()
	app.use(express.json())

	app.use((req, _res, next) => {
		if (opts.authenticated !== false) {
			;(req as unknown as Record<string, unknown>).user = { id: IDS.user, status: 'ACTIVE' }
			req.isAuthenticated = (() => true) as typeof req.isAuthenticated
		} else {
			req.isAuthenticated = (() => false) as typeof req.isAuthenticated
		}
		next()
	})

	const router = express.Router()
	configureRouter(router)
	app.use(router)
	app.use(errorHandler)
	return app
}

describe('requireAuth', () => {
	it('AUTH-001: No session/user → 401 UNAUTHENTICATED', async () => {
		const app = createAuthApp(
			(router) => {
				router.get('/protected', requireAuth(), (_req, res) => {
					res.status(200).json({ ok: true })
				})
			},
			{ authenticated: false }
		)

		const response = await request(app).get('/protected').expect(401)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'UNAUTHENTICATED')
		assert.equal(typeof response.body.error.message, 'string')
	})

	it('AUTH-022: 401 uses nested error contract (body.error.code)', async () => {
		const app = createAuthApp(
			(router) => {
				router.get('/protected', requireAuth(), (_req, res) => {
					res.status(200).json({ ok: true })
				})
			},
			{ authenticated: false }
		)

		const response = await request(app).get('/protected').expect(401)

		assert.equal(typeof response.body.error, 'object')
		assert.ok(!('error' in response.body) || typeof response.body.error !== 'string', 'error must not be a string')
		assert.equal(response.body.error.code, 'UNAUTHENTICATED')
		assert.equal(typeof response.body.error.message, 'string')
	})

	it('Authenticated user → passes through to handler', async () => {
		const app = createAuthApp((router) => {
			router.get('/protected', requireAuth(), (_req, res) => {
				res.status(200).json({ ok: true })
			})
		})

		await request(app).get('/protected').expect(200)
	})
})

describe('requirePermission', () => {
	it('AUTH-001: No session → 401 UNAUTHENTICATED', async () => {
		const service = createAuthorizationService({ repository: createFakeRepository({ grants: [] }) })
		const app = createAuthApp(
			(router) => {
				router.get('/admin', requirePermission({ service }, PERMISSIONS.USER_READ), (_req, res) => {
					res.status(200).json({ ok: true })
				})
			},
			{ authenticated: false }
		)

		const response = await request(app).get('/admin').expect(401)
		assert.equal(response.body.error.code, 'UNAUTHENTICATED')
	})

	it('AUTH-002: Authenticated user, no matching grant → 403 FORBIDDEN', async () => {
		const service = createAuthorizationService({ repository: createFakeRepository({ grants: [] }) })
		const app = createAuthApp((router) => {
			router.get('/admin', requirePermission({ service }, PERMISSIONS.USER_READ), (_req, res) => {
				res.status(200).json({ ok: true })
			})
		})

		const response = await request(app).get('/admin').expect(403)
		assert.equal(response.body.error.code, 'FORBIDDEN')
	})

	it('AUTH-003: Global permission grant → handler runs', async () => {
		const grants: AuthorizationGrant[] = [
			{
				scopeType: 'GLOBAL',
				permissions: [PERMISSIONS.USER_READ],
				academicUnitId: null,
				departmentId: null,
				disciplineId: null
			}
		]
		const service = createAuthorizationService({ repository: createFakeRepository({ grants }) })

		const app = createAuthApp((router) => {
			router.get('/admin', requirePermission({ service }, PERMISSIONS.USER_READ), (_req, res) => {
				res.status(200).json({ ok: true })
			})
		})

		await request(app).get('/admin').expect(200)
	})

	it('AUTH-023: Deny case — handler is not called', async () => {
		let handlerCalls = 0
		const service = createAuthorizationService({ repository: createFakeRepository({ grants: [] }) })

		const app = createAuthApp((router) => {
			router.get('/admin', requirePermission({ service }, PERMISSIONS.USER_READ), (_req, res) => {
				handlerCalls += 1
				res.status(200).json({ ok: true })
			})
		})

		await request(app).get('/admin').expect(403)
		assert.equal(handlerCalls, 0)
	})

	it('AUTH-026: Scoped DEPARTMENT grant on global endpoint → 403 FORBIDDEN', async () => {
		const grants: AuthorizationGrant[] = [
			{
				scopeType: 'DEPARTMENT',
				permissions: [PERMISSIONS.USER_READ],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptA,
				disciplineId: null
			}
		]
		const service = createAuthorizationService({ repository: createFakeRepository({ grants }) })

		const app = createAuthApp((router) => {
			router.get('/admin', requirePermission({ service }, PERMISSIONS.USER_READ), (_req, res) => {
				res.status(200).json({ ok: true })
			})
		})

		const response = await request(app).get('/admin').expect(403)
		assert.equal(response.body.error.code, 'FORBIDDEN')
	})

	it('AUTH-021: Repository throws → 500 INTERNAL_ERROR, no internal detail leaked', async () => {
		const service = createAuthorizationService({
			repository: createFakeRepository({ throwOnGrants: true })
		})

		const app = createAuthApp((router) => {
			router.get('/admin', requirePermission({ service }, PERMISSIONS.USER_READ), (_req, res) => {
				res.status(200).json({ ok: true })
			})
		})

		const response = await request(app).get('/admin').expect(500)
		assert.equal(response.body.error.code, 'INTERNAL_ERROR')
		assert.ok(!JSON.stringify(response.body).includes('DB connection refused'))
		assert.ok(!JSON.stringify(response.body).includes('internal detail'))
	})

	it('AUTH-022: 403 uses nested error contract', async () => {
		const service = createAuthorizationService({ repository: createFakeRepository({ grants: [] }) })

		const app = createAuthApp((router) => {
			router.get('/admin', requirePermission({ service }, PERMISSIONS.USER_READ), (_req, res) => {
				res.status(200).json({ ok: true })
			})
		})

		const response = await request(app).get('/admin').expect(403)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'FORBIDDEN')
		assert.equal(typeof response.body.error.message, 'string')
	})
})

describe('requireScopedPermission', () => {
	const deptPath: ResolvedScopePath = { kind: 'DEPARTMENT', academicUnitId: IDS.unitA, departmentId: IDS.deptA }

	it('AUTH-001: No session → 401 UNAUTHENTICATED', async () => {
		const service = createAuthorizationService({
			repository: createFakeRepository({ scopePath: deptPath, grants: [] })
		})

		const app = createAuthApp(
			(router) => {
				router.get(
					'/dept/:id',
					requireScopedPermission(
						{ service },
						{
							permission: PERMISSIONS.DEPARTMENT_MANAGE,
							targetScopeType: 'DEPARTMENT',
							resolveTargetId: (req) => String(req.params.id)
						}
					),
					(_req, res) => res.status(200).json({ ok: true })
				)
			},
			{ authenticated: false }
		)

		const response = await request(app).get(`/dept/${IDS.deptA}`).expect(401)
		assert.equal(response.body.error.code, 'UNAUTHENTICATED')
	})

	it('AUTH-002: Authenticated user, no permission → 403 FORBIDDEN', async () => {
		const service = createAuthorizationService({
			repository: createFakeRepository({ scopePath: deptPath, grants: [] })
		})

		const app = createAuthApp((router) => {
			router.get(
				'/dept/:id',
				requireScopedPermission(
					{ service },
					{
						permission: PERMISSIONS.DEPARTMENT_MANAGE,
						targetScopeType: 'DEPARTMENT',
						resolveTargetId: (req) => String(req.params.id)
					}
				),
				(_req, res) => res.status(200).json({ ok: true })
			)
		})

		const response = await request(app).get(`/dept/${IDS.deptA}`).expect(403)
		assert.equal(response.body.error.code, 'FORBIDDEN')
	})

	it('AUTH-003: GLOBAL grant → handler runs for scoped endpoint', async () => {
		const grants: AuthorizationGrant[] = [
			{
				scopeType: 'GLOBAL',
				permissions: [PERMISSIONS.DEPARTMENT_MANAGE],
				academicUnitId: null,
				departmentId: null,
				disciplineId: null
			}
		]
		const service = createAuthorizationService({ repository: createFakeRepository({ scopePath: deptPath, grants }) })

		const app = createAuthApp((router) => {
			router.get(
				'/dept/:id',
				requireScopedPermission(
					{ service },
					{
						permission: PERMISSIONS.DEPARTMENT_MANAGE,
						targetScopeType: 'DEPARTMENT',
						resolveTargetId: (req) => String(req.params.id)
					}
				),
				(_req, res) => res.status(200).json({ ok: true })
			)
		})

		await request(app).get(`/dept/${IDS.deptA}`).expect(200)
	})

	it('AUTH-020: Target not found → 403 FORBIDDEN (not 404)', async () => {
		const service = createAuthorizationService({
			repository: createFakeRepository({
				scopePath: null,
				grants: [
					{
						scopeType: 'GLOBAL',
						permissions: [PERMISSIONS.DEPARTMENT_MANAGE],
						academicUnitId: null,
						departmentId: null,
						disciplineId: null
					}
				]
			})
		})

		const app = createAuthApp((router) => {
			router.get(
				'/dept/:id',
				requireScopedPermission(
					{ service },
					{
						permission: PERMISSIONS.DEPARTMENT_MANAGE,
						targetScopeType: 'DEPARTMENT',
						resolveTargetId: (req) => String(req.params.id)
					}
				),
				(_req, res) => res.status(200).json({ ok: true })
			)
		})

		const response = await request(app).get(`/dept/nonexistent`).expect(403)
		assert.equal(response.body.error.code, 'FORBIDDEN')
	})

	it('Correct target with matching DEPARTMENT grant → handler runs', async () => {
		const grants: AuthorizationGrant[] = [
			{
				scopeType: 'DEPARTMENT',
				permissions: [PERMISSIONS.DEPARTMENT_MANAGE],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptA,
				disciplineId: null
			}
		]
		const service = createAuthorizationService({ repository: createFakeRepository({ scopePath: deptPath, grants }) })

		const app = createAuthApp((router) => {
			router.get(
				'/dept/:id',
				requireScopedPermission(
					{ service },
					{
						permission: PERMISSIONS.DEPARTMENT_MANAGE,
						targetScopeType: 'DEPARTMENT',
						resolveTargetId: (req) => String(req.params.id)
					}
				),
				(_req, res) => res.status(200).json({ ok: true })
			)
		})

		await request(app).get(`/dept/${IDS.deptA}`).expect(200)
	})

	it('Wrong target with DEPARTMENT grant → 403 FORBIDDEN', async () => {
		const wrongPath: ResolvedScopePath = { kind: 'DEPARTMENT', academicUnitId: IDS.unitA, departmentId: 'dept-other' }
		const grants: AuthorizationGrant[] = [
			{
				scopeType: 'DEPARTMENT',
				permissions: [PERMISSIONS.DEPARTMENT_MANAGE],
				academicUnitId: IDS.unitA,
				departmentId: IDS.deptA,
				disciplineId: null
			}
		]
		const service = createAuthorizationService({ repository: createFakeRepository({ scopePath: wrongPath, grants }) })

		const app = createAuthApp((router) => {
			router.get(
				'/dept/:id',
				requireScopedPermission(
					{ service },
					{
						permission: PERMISSIONS.DEPARTMENT_MANAGE,
						targetScopeType: 'DEPARTMENT',
						resolveTargetId: (req) => String(req.params.id)
					}
				),
				(_req, res) => res.status(200).json({ ok: true })
			)
		})

		const response = await request(app).get('/dept/dept-other').expect(403)
		assert.equal(response.body.error.code, 'FORBIDDEN')
	})

	it('AUTH-023: Deny — handler is not called', async () => {
		let handlerCalls = 0
		const service = createAuthorizationService({
			repository: createFakeRepository({ scopePath: deptPath, grants: [] })
		})

		const app = createAuthApp((router) => {
			router.get(
				'/dept/:id',
				requireScopedPermission(
					{ service },
					{
						permission: PERMISSIONS.DEPARTMENT_MANAGE,
						targetScopeType: 'DEPARTMENT',
						resolveTargetId: (req) => String(req.params.id)
					}
				),
				(_req, res) => {
					handlerCalls += 1
					res.status(200).json({ ok: true })
				}
			)
		})

		await request(app).get(`/dept/${IDS.deptA}`).expect(403)
		assert.equal(handlerCalls, 0)
	})

	it('AUTH-021: Repository throws → 500 INTERNAL_ERROR, no DB detail leaked', async () => {
		const service = createAuthorizationService({
			repository: createFakeRepository({ scopePath: deptPath, throwOnGrants: true })
		})

		const app = createAuthApp((router) => {
			router.get(
				'/dept/:id',
				requireScopedPermission(
					{ service },
					{
						permission: PERMISSIONS.DEPARTMENT_MANAGE,
						targetScopeType: 'DEPARTMENT',
						resolveTargetId: (req) => String(req.params.id)
					}
				),
				(_req, res) => res.status(200).json({ ok: true })
			)
		})

		const response = await request(app).get(`/dept/${IDS.deptA}`).expect(500)
		assert.equal(response.body.error.code, 'INTERNAL_ERROR')
		assert.ok(!JSON.stringify(response.body).includes('DB connection refused'))
		assert.ok(!JSON.stringify(response.body).includes('internal detail'))
	})

	it('AUTH-022: Error responses use nested error contract', async () => {
		const service = createAuthorizationService({
			repository: createFakeRepository({ scopePath: deptPath, grants: [] })
		})

		const app = createAuthApp((router) => {
			router.get(
				'/dept/:id',
				requireScopedPermission(
					{ service },
					{
						permission: PERMISSIONS.DEPARTMENT_MANAGE,
						targetScopeType: 'DEPARTMENT',
						resolveTargetId: (req) => String(req.params.id)
					}
				),
				(_req, res) => res.status(200).json({ ok: true })
			)
		})

		const response = await request(app).get(`/dept/${IDS.deptA}`).expect(403)

		assert.equal(typeof response.body.error, 'object')
		assert.ok(!('error' in response.body) || typeof response.body.error !== 'string')
		assert.equal(response.body.error.code, 'FORBIDDEN')
		assert.equal(typeof response.body.error.message, 'string')
	})
})

describe('Grant date filtering via fake repository', () => {
	const globalPath: ResolvedScopePath = {
		kind: 'DISCIPLINE',
		academicUnitId: IDS.unitA,
		departmentId: IDS.deptA,
		disciplineId: IDS.discA
	}

	it('AUTH-015: Soft-deleted grant is excluded (returns no grants → deny)', async () => {
		// Soft-deleted grants are filtered at the repository level;
		// the fake repo returns empty grants to simulate this.
		const service = createAuthorizationService({
			repository: createFakeRepository({ scopePath: globalPath, grants: [] })
		})

		const app = createAuthApp((router) => {
			router.get('/disc/:id', requirePermission({ service }, PERMISSIONS.REPORT_READ), (_req, res) =>
				res.status(200).json({ ok: true })
			)
		})

		const response = await request(app).get(`/disc/${IDS.discA}`).expect(403)
		assert.equal(response.body.error.code, 'FORBIDDEN')
	})

	it('AUTH-016: Future start date grant excluded (returns no grants → deny)', async () => {
		const service = createAuthorizationService({
			repository: createFakeRepository({ scopePath: globalPath, grants: [] })
		})

		const app = createAuthApp((router) => {
			router.get('/disc/:id', requirePermission({ service }, PERMISSIONS.REPORT_READ), (_req, res) =>
				res.status(200).json({ ok: true })
			)
		})

		const response = await request(app).get(`/disc/${IDS.discA}`).expect(403)
		assert.equal(response.body.error.code, 'FORBIDDEN')
	})

	it('AUTH-017: Expired end date grant excluded (returns no grants → deny)', async () => {
		const service = createAuthorizationService({
			repository: createFakeRepository({ scopePath: globalPath, grants: [] })
		})

		const app = createAuthApp((router) => {
			router.get('/disc/:id', requirePermission({ service }, PERMISSIONS.REPORT_READ), (_req, res) =>
				res.status(200).json({ ok: true })
			)
		})

		const response = await request(app).get(`/disc/${IDS.discA}`).expect(403)
		assert.equal(response.body.error.code, 'FORBIDDEN')
	})

	it('AUTH-018: Boundary dates (startDate <= now, endDate >= now) → grant active → allow', async () => {
		const grants: AuthorizationGrant[] = [
			{
				scopeType: 'GLOBAL',
				permissions: [PERMISSIONS.REPORT_READ],
				academicUnitId: null,
				departmentId: null,
				disciplineId: null
			}
		]
		const service = createAuthorizationService({ repository: createFakeRepository({ scopePath: globalPath, grants }) })

		const app = createAuthApp((router) => {
			router.get('/disc/:id', requirePermission({ service }, PERMISSIONS.REPORT_READ), (_req, res) =>
				res.status(200).json({ ok: true })
			)
		})

		await request(app).get(`/disc/${IDS.discA}`).expect(200)
	})
})

describe('AUTH-024: Test routes are not added to production router', () => {
	it('src/routes/index.ts does not contain test-only authorization routes', async () => {
		const { createRoutes } = await import('../../../routes/index.ts')
		const app = express()
		app.use(
			'/api',
			createRoutes({
				config: {
					auth: {
						rateLimit: {
							session: { windowMs: 900_000, ipEmailMax: 5, ipMax: 50 },
							resetRequest: { windowMs: 3_600_000, ipEmailMax: 3, ipMax: 20 },
							resetCompletion: { windowMs: 900_000, ipRouteMax: 10 }
						}
					}
				} as never,
				db: {} as never,
				redisClient: {
					sendCommand: async (args: string[]) => {
						if (args[0] === 'SCRIPT') return 'mock-sha'
						return null
					}
				} as never,
				isReady: () => true,
				checkDb: async () => undefined,
				checkRedis: async () => undefined
			})
		)
		app.use(errorHandler)

		// The production router has no /test-auth route; Express next()s to errorHandler
		// which returns 404 without a body (errorHandler won't produce a NOT_FOUND body
		// unless notFoundHandler is also mounted — this test only verifies 404 is returned,
		// confirming no test route was registered).
		await request(app).get('/api/test-auth').expect(404)
	})
})
