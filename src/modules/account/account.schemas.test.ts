import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	createCompletePasswordResetBodySchema,
	createPasswordResetRequestBodySchema,
	createSessionBodySchema
} from './account.schemas.ts'

// Testlerde kullanılan sabitler; runtime'da min uzunluk config'ten (passwordMinLength) gelir,
// max byte bcrypt'in değişmez 72 limitidir.
const PASSWORD_MIN_LENGTH = 15
const PASSWORD_MAX_BYTE_LENGTH = 72
const completePasswordResetBodySchema = createCompletePasswordResetBodySchema(PASSWORD_MIN_LENGTH)

describe('createSessionBodySchema', () => {
	it('accepts valid email and password', () => {
		const result = createSessionBodySchema.safeParse({ email: 'User@Example.com ', password: 'pw' })
		assert.ok(result.success)
		assert.equal(result.data?.email, 'user@example.com')
	})

	it('rejects missing email', () => {
		const result = createSessionBodySchema.safeParse({ password: 'pw' })
		assert.equal(result.success, false)
	})

	it('rejects invalid email', () => {
		const result = createSessionBodySchema.safeParse({ email: 'bad', password: 'pw' })
		assert.equal(result.success, false)
	})

	it('rejects empty password', () => {
		const result = createSessionBodySchema.safeParse({ email: 'a@b.com', password: '' })
		assert.equal(result.success, false)
	})

	it('normalizes email (trim + lowercase)', () => {
		const result = createSessionBodySchema.safeParse({ email: '  A@B.COM  ', password: 'pw' })
		assert.ok(result.success)
		assert.equal(result.data?.email, 'a@b.com')
	})
})

describe('completePasswordResetBodySchema', () => {
	it('accepts valid token and password', () => {
		const pw = 'a'.repeat(PASSWORD_MIN_LENGTH)
		const result = completePasswordResetBodySchema.safeParse({ token: 'valid-token', password: pw })
		assert.ok(result.success)
	})

	it('rejects password shorter than minimum', () => {
		const pw = 'a'.repeat(PASSWORD_MIN_LENGTH - 1)
		const result = completePasswordResetBodySchema.safeParse({ token: 'tok', password: pw })
		assert.equal(result.success, false)
	})

	it('rejects password exceeding bcrypt byte limit', () => {
		const pw = 'a'.repeat(PASSWORD_MAX_BYTE_LENGTH + 1)
		const result = completePasswordResetBodySchema.safeParse({ token: 'tok', password: pw })
		assert.equal(result.success, false)
	})

	it('rejects empty token', () => {
		const pw = 'a'.repeat(PASSWORD_MIN_LENGTH)
		const result = completePasswordResetBodySchema.safeParse({ token: '', password: pw })
		assert.equal(result.success, false)
	})
})

describe('createPasswordResetRequestBodySchema', () => {
	it('accepts valid email', () => {
		const result = createPasswordResetRequestBodySchema.safeParse({ email: 'a@b.com' })
		assert.ok(result.success)
	})

	it('rejects invalid email', () => {
		const result = createPasswordResetRequestBodySchema.safeParse({ email: 'bad' })
		assert.equal(result.success, false)
	})

	it('normalizes email', () => {
		const result = createPasswordResetRequestBodySchema.safeParse({ email: ' A@B.COM ' })
		assert.ok(result.success)
		assert.equal(result.data?.email, 'a@b.com')
	})
})
