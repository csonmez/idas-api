import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import express, { type Router } from 'express'
import request from 'supertest'
import { z } from 'zod'
import { AppError } from './http/errors.ts'
import { collectFieldErrors, validateBody, validateParams, validateQuery } from './http/request-validation.ts'
import { errorHandler } from './middlewares/error.middleware.ts'

const createValidationApp = (configureRouter: (router: Router) => void) => {
	const app = express()
	app.use(express.json({ limit: '1mb' }))

	const router = express.Router()
	configureRouter(router)
	app.use(router)

	app.use(errorHandler)
	return app
}

describe('validateBody', () => {
	it('passes canonical body to handler on valid input (RV-001)', async () => {
		const schema = z.object({ email: z.email() })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (req, res) => {
				res.status(200).json({ body: req.body })
			})
		})

		const response = await request(app).post('/body').send({ email: 'a@example.com' }).expect(200)

		assert.deepEqual(response.body.body, { email: 'a@example.com' })
	})

	it('returns 400 VALIDATION_ERROR on invalid body (RV-002)', async () => {
		const schema = z.object({ email: z.email() })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (req, res) => {
				res.status(200).json({ body: req.body })
			})
		})

		const response = await request(app).post('/body').send({ email: 'bad' }).expect(400)

		assert.equal(typeof response.body.error, 'object')
		assert.equal(response.body.error.code, 'VALIDATION_ERROR')
		assert.equal(response.body.error.message, 'Request validation failed')
		assert.ok(Array.isArray(response.body.error.details.fields.email))
		assert.ok(response.body.error.details.fields.email.length > 0)
	})

	it('applies body coercion/transformation (RV-003)', async () => {
		const schema = z.object({ count: z.coerce.number().int() })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (req, res) => {
				res.status(200).json({ count: req.body.count, type: typeof req.body.count })
			})
		})

		const response = await request(app).post('/body').send({ count: '3' }).expect(200)

		assert.equal(response.body.count, 3)
		assert.equal(response.body.type, 'number')
	})

	it('strips unknown keys by default (RV-018)', async () => {
		const schema = z.object({ name: z.string().min(1) })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (req, res) => {
				res.status(200).json({ body: req.body })
			})
		})

		const response = await request(app).post('/body').send({ name: 'Ada', extra: 'x' }).expect(200)

		assert.deepEqual(response.body.body, { name: 'Ada' })
		assert.ok(!('extra' in response.body.body))
	})
})

describe('validateQuery', () => {
	it('passes canonical query to handler on valid input (RV-004)', async () => {
		const schema = z.object({ search: z.string().min(1) })
		const app = createValidationApp((router) => {
			router.get('/query', validateQuery(schema), (req, res) => {
				res.status(200).json({ query: req.query })
			})
		})

		const response = await request(app).get('/query?search=abc').expect(200)

		assert.deepEqual(response.body.query, { search: 'abc' })
	})

	it('coerces query string to number (RV-005)', async () => {
		const schema = z.object({ page: z.coerce.number().int().positive() })
		const app = createValidationApp((router) => {
			router.get('/query', validateQuery(schema), (req, res) => {
				res.status(200).json({ page: req.query.page, type: typeof req.query.page })
			})
		})

		const response = await request(app).get('/query?page=2').expect(200)

		assert.equal(response.body.page, 2)
		assert.equal(response.body.type, 'number')
	})

	it('returns 400 VALIDATION_ERROR on invalid query (RV-006)', async () => {
		const schema = z.object({ page: z.coerce.number().int().positive() })
		const app = createValidationApp((router) => {
			router.get('/query', validateQuery(schema), (req, res) => {
				res.status(200).json({ query: req.query })
			})
		})

		const response = await request(app).get('/query?page=abc').expect(400)

		assert.equal(response.body.error.code, 'VALIDATION_ERROR')
		assert.ok(Array.isArray(response.body.error.details.fields.page))
		assert.ok(response.body.error.details.fields.page.length > 0)
	})

	it('mutates req.query via Object.defineProperty on success (Express 5 getter constraint)', async () => {
		const schema = z.object({ page: z.coerce.number().int() })
		const app = createValidationApp((router) => {
			router.get('/query', validateQuery(schema), (req, res) => {
				const own = Object.getOwnPropertyDescriptor(req, 'query')
				res.status(200).json({
					page: req.query.page,
					ownDescriptorIsValue: own && typeof own.value === 'object'
				})
			})
		})

		const response = await request(app).get('/query?page=5').expect(200)

		assert.equal(response.body.page, 5)
		assert.equal(response.body.ownDescriptorIsValue, true)
	})
})

describe('validateParams', () => {
	it('passes canonical params to handler on valid input (RV-007)', async () => {
		const schema = z.object({ id: z.string().min(1) })
		const app = createValidationApp((router) => {
			router.get('/items/:id', validateParams(schema), (req, res) => {
				res.status(200).json({ params: req.params })
			})
		})

		const response = await request(app).get('/items/123').expect(200)

		assert.deepEqual(response.body.params, { id: '123' })
	})

	it('coerces params string to canonical number (RV-008)', async () => {
		const schema = z.object({ id: z.coerce.number().int().positive() })
		const app = createValidationApp((router) => {
			router.get('/items/:id', validateParams(schema), (req, res) => {
				res.status(200).json({ id: req.params.id, type: typeof req.params.id })
			})
		})

		const response = await request(app).get('/items/123').expect(200)

		assert.equal(response.body.id, 123)
		assert.equal(response.body.type, 'number')
	})

	it('returns 400 VALIDATION_ERROR on invalid params (RV-009)', async () => {
		const schema = z.object({ id: z.coerce.number().int().positive() })
		const app = createValidationApp((router) => {
			router.get('/items/:id', validateParams(schema), (req, res) => {
				res.status(200).json({ params: req.params })
			})
		})

		const response = await request(app).get('/items/abc').expect(400)

		assert.equal(response.body.error.code, 'VALIDATION_ERROR')
		assert.ok(Array.isArray(response.body.error.details.fields.id))
		assert.ok(response.body.error.details.fields.id.length > 0)
	})
})

describe('field error mapping', () => {
	it('collects multiple field errors under details.fields (RV-010)', async () => {
		const schema = z.object({
			email: z.email(),
			age: z.number().int().min(0)
		})
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (_req, res) => res.status(200).end())
		})

		const response = await request(app).post('/body').send({ email: 'bad', age: -1 }).expect(400)

		const fields = response.body.error.details.fields
		assert.ok(Array.isArray(fields.email) && fields.email.length > 0)
		assert.ok(Array.isArray(fields.age) && fields.age.length > 0)
	})

	it('formats nested object field path as dot notation (RV-011)', async () => {
		const schema = z.object({ user: z.object({ email: z.email() }) })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (_req, res) => res.status(200).end())
		})

		const response = await request(app)
			.post('/body')
			.send({ user: { email: 'bad' } })
			.expect(400)

		const fields = response.body.error.details.fields
		assert.ok(Array.isArray(fields['user.email']))
		assert.ok(fields['user.email'].length > 0)
	})

	it('formats array field path with bracket index (RV-012)', async () => {
		const schema = z.object({ tags: z.array(z.string().min(2)) })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (_req, res) => res.status(200).end())
		})

		const response = await request(app)
			.post('/body')
			.send({ tags: ['a'] })
			.expect(400)

		const fields = response.body.error.details.fields
		assert.ok(Array.isArray(fields['tags[0]']))
		assert.ok(fields['tags[0]'].length > 0)
	})

	it('maps root-level issues to _root key for non-object input', () => {
		const schema = z.object({ email: z.email() })
		const result = schema.safeParse('not-an-object')

		assert.equal(result.success, false)
		const fields = collectFieldErrors(result.error.issues)
		assert.ok(fields._root !== undefined)
		assert.ok(fields._root.length > 0)
	})

	it('produces JSON-serializable details without Error/BigInt/function (RV-017)', () => {
		const schema = z.object({ email: z.email() })
		const result = schema.safeParse({ email: 'bad' })

		assert.equal(result.success, false)
		const fields = collectFieldErrors(result.error.issues)

		assert.doesNotThrow(() => JSON.stringify({ fields }))
		const serialized = JSON.stringify({ fields })
		assert.ok(!serialized.includes('stack'))
	})
})

describe('handler and request mutation behavior', () => {
	it('does not run handler on validation failure (RV-013)', async () => {
		let handlerCalls = 0
		const schema = z.object({ email: z.email() })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (_req, res) => {
				handlerCalls += 1
				res.status(200).end()
			})
		})

		await request(app).post('/body').send({ email: 'bad' }).expect(400)
		assert.equal(handlerCalls, 0)
	})

	it('does not mutate target request field on validation failure (RV-014)', async () => {
		const schema = z.object({ email: z.email() })
		let capturedBody: unknown
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (_req, res) => res.status(200).end())
			router.use((err: unknown, req: express.Request, _res: express.Response, next: express.NextFunction) => {
				capturedBody = req.body
				next(err)
			})
		})

		await request(app).post('/body').send({ email: 'bad' }).expect(400)

		assert.deepEqual(capturedBody, { email: 'bad' })
	})

	it('mutates only the target request field on success (RV-015)', async () => {
		const bodySchema = z.object({ name: z.string().min(1) })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(bodySchema), (req, res) => {
				res.status(200).json({
					body: req.body,
					query: req.query,
					params: req.params
				})
			})
		})

		// Body validation should only change req.body; query/params remain untouched/default.
		const bodyResponse = await request(app).post('/body?keep=this').send({ name: 'Ada' }).expect(200)
		assert.deepEqual(bodyResponse.body.body, { name: 'Ada' })
		assert.deepEqual(bodyResponse.body.query, { keep: 'this' })
	})
})

describe('nested Error Contract compatibility', () => {
	it('returns nested error object shape (RV-016)', async () => {
		const schema = z.object({ email: z.email() })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (_req, res) => res.status(200).end())
		})

		const response = await request(app).post('/body').send({ email: 'bad' }).expect(400)

		assert.equal(typeof response.body.error, 'object')
		assert.notEqual(typeof response.body.error, 'string')
		assert.equal(response.body.error.code, 'VALIDATION_ERROR')
		assert.equal(response.body.error.message, 'Request validation failed')
		assert.equal(typeof response.body.error.details, 'object')
		assert.equal(typeof response.body.error.details.fields, 'object')
	})
})

describe('prototype-collision field keys', () => {
	it('safely maps `constructor` path to 400 VALIDATION_ERROR', async () => {
		const schema = z.object({ constructor: z.email() })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (_req, res) => res.status(200).end())
		})

		const response = await request(app)
			.post('/body')
			.set('Content-Type', 'application/json')
			.send('{"constructor":"bad"}')
			.expect(400)

		assert.equal(response.body.error.code, 'VALIDATION_ERROR')
		assert.ok(Array.isArray(response.body.error.details.fields.constructor))
		assert.ok(response.body.error.details.fields.constructor.length > 0)
	})

	it('safely maps `__proto__` path without producing 500', async () => {
		const schema = z.object({ ['__proto__']: z.email() })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (_req, res) => res.status(200).end())
		})

		const response = await request(app)
			.post('/body')
			.set('Content-Type', 'application/json')
			.send('{"__proto__":"bad"}')
			.expect(400)

		assert.equal(response.body.error.code, 'VALIDATION_ERROR')
	})

	it('safely maps `prototype` path to 400 VALIDATION_ERROR', async () => {
		const schema = z.object({ prototype: z.email() })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (_req, res) => res.status(200).end())
		})

		const response = await request(app)
			.post('/body')
			.set('Content-Type', 'application/json')
			.send('{"prototype":"bad"}')
			.expect(400)

		assert.equal(response.body.error.code, 'VALIDATION_ERROR')
		assert.ok(Array.isArray(response.body.error.details.fields.prototype))
		assert.ok(response.body.error.details.fields.prototype.length > 0)
	})

	it('safely maps `toString` path to 400 VALIDATION_ERROR', async () => {
		const schema = z.object({ toString: z.email() })
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (_req, res) => res.status(200).end())
		})

		const response = await request(app)
			.post('/body')
			.set('Content-Type', 'application/json')
			.send('{"toString":"bad"}')
			.expect(400)

		assert.equal(response.body.error.code, 'VALIDATION_ERROR')
		assert.ok(Array.isArray(response.body.error.details.fields.toString))
		assert.ok(response.body.error.details.fields.toString.length > 0)
	})

	it('accumulates multiple distinct messages for the same field as string[]', async () => {
		const schema = z.object({
			value: z
				.string()
				.min(10)
				.regex(/^[0-9]+$/)
		})
		const app = createValidationApp((router) => {
			router.post('/body', validateBody(schema), (_req, res) => res.status(200).end())
		})

		const response = await request(app).post('/body').send({ value: 'abc' }).expect(400)

		const bucket = response.body.error.details.fields.value
		assert.ok(Array.isArray(bucket))
		assert.ok(bucket.length >= 2, 'expected at least two distinct messages for the same field')
		for (const msg of bucket as unknown[]) {
			assert.equal(typeof msg, 'string')
		}
		// No duplicate messages.
		assert.equal(new Set(bucket as string[]).size, bucket.length)
	})
})

describe('query and params mutation isolation', () => {
	it('does not mutate req.query on invalid query', async () => {
		const schema = z.object({ page: z.coerce.number().int().positive() })
		let capturedQuery: object = {}
		const app = createValidationApp((router) => {
			router.get('/query', validateQuery(schema), (_req, res) => res.status(200).end())
			router.use((err: unknown, req: express.Request, _res: express.Response, next: express.NextFunction) => {
				capturedQuery = req.query
				next(err)
			})
		})

		await request(app).get('/query?page=abc').expect(400)

		// Express 5 stores req.query as a null-prototype object; spread into a plain
		// object so deepEqual compares values rather than prototype identity.
		assert.deepEqual({ ...capturedQuery }, { page: 'abc' })
	})

	it('does not mutate req.params on invalid params', async () => {
		const schema = z.object({ id: z.coerce.number().int().positive() })
		const req = { params: { id: 'abc' } } as unknown as express.Request
		let nextArg: unknown
		await validateParams(schema)(
			req,
			undefined as unknown as express.Response,
			((err?: unknown) => {
				nextArg = err
			}) as express.NextFunction
		)

		assert.deepEqual(req.params, { id: 'abc' })
		assert.ok(nextArg instanceof AppError)
		assert.equal((nextArg as AppError).code, 'VALIDATION_ERROR')
	})

	it('mutates only req.query on successful query validation', async () => {
		const schema = z.object({ page: z.coerce.number().int() })
		const app = createValidationApp((router) => {
			router.get('/query', validateQuery(schema), (req, res) => {
				res.status(200).json({ body: req.body, query: req.query, params: req.params })
			})
		})

		const response = await request(app).get('/query?page=2').expect(200)

		assert.equal(response.body.query.page, 2)
		assert.equal(typeof response.body.query.page, 'number')
		assert.deepEqual(response.body.params, {})
		assert.equal(response.body.body, undefined)
	})

	it('mutates only req.params on successful params validation', async () => {
		const schema = z.object({ id: z.coerce.number().int().positive() })
		const app = createValidationApp((router) => {
			router.get('/items/:id', validateParams(schema), (req, res) => {
				res.status(200).json({ body: req.body, query: req.query, params: req.params })
			})
		})

		const response = await request(app).get('/items/123?keep=this').expect(200)

		assert.equal(response.body.params.id, 123)
		assert.equal(typeof response.body.params.id, 'number')
		assert.deepEqual(response.body.query, { keep: 'this' })
		assert.equal(response.body.body, undefined)
	})
})
