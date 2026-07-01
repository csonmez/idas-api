import type { Kysely } from 'kysely'
import passport from 'passport'
import type { DB } from '../database/index.ts'

type ConfigurePassportOptions = {
	db: Kysely<DB>
}

/**
 * Module-level idempotency guard (Plan Phase 1 step 10).
 *
 * configurePassport hot reload / test tekrarlarında serializer davranışını
 * duplicate register etmemeli. İlk çağrı configure eder; sonraki çağrılar no-op.
 * Test izolasyonu için `_resetPassportConfig` kullanılır.
 */
let isConfigured = false

/**
 * Passport session serialization bootstrap'ı.
 *
 * Credential doğrulama (login) account.service createSessionWithPassword içinde
 * yapılır — LocalStrategy kullanılmaz. Passport sadece session serialization
 * (serializeUser/deserializeUser) ve req.login/req.isAuthenticated için kullanılır.
 * req.login, Passport'un LocalStrategy'sine değil serializeUser'a bağlıdır.
 */
export const configurePassport = ({ db }: ConfigurePassportOptions) => {
	if (isConfigured) return
	isConfigured = true

	passport.serializeUser((user, done) => {
		const authenticatedUser = user as { id: string }
		done(null, authenticatedUser.id)
	})

	passport.deserializeUser(async (id: string, done) => {
		try {
			const user = await db.selectFrom('users').select(['id', 'email', 'status']).where('id', '=', id).executeTakeFirst()

			if (!user || user.status === 'INACTIVE') {
				done(null, false)
				return
			}

			done(null, user)
		} catch (error) {
			done(error as Error)
		}
	})
}

/** Test-only: idempotency guard'ını sıfırlar. Production'da çağrılmamalı. */
export const _resetPassportConfig = () => {
	isConfigured = false
}
