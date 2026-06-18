import type { Kysely } from 'kysely'
import passport from 'passport'
import type { DB } from '../database/index.ts'

type ConfigurePassportOptions = {
	db: Kysely<DB>
}

export const configurePassport = ({ db }: ConfigurePassportOptions) => {
	passport.serializeUser((user, done) => {
		const authenticatedUser = user as { id: string }
		done(null, authenticatedUser.id)
	})

	passport.deserializeUser(async (id: string, done) => {
		try {
			const user = await db.selectFrom('users').select(['id', 'status']).where('id', '=', id).executeTakeFirst()

			if (!user || user.status === 'INACTIVE') {
				done(null, false)
				return
			}

			done(null, user)
		} catch (error) {
			done(error)
		}
	})
}
