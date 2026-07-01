import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Request } from 'express'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { issueCsrfToken } from '../../auth/csrf.ts'
import { getDummyHash } from '../../auth/password-policy.ts'
import type { AppConfig } from '../../config/env.ts'
import type { DB } from '../../database/index.ts'
import { AppError } from '../../http/errors.ts'
import type { RedisClient } from '../../redis/client.ts'
import type { CreateSessionBody } from './account.schemas.ts'
import type { CreateSessionResponse, GetSessionResponse } from './account.types.ts'
import type { PasswordResetNotifier } from './password-reset-notifier.ts'

type AccountServiceDeps = {
	db: Kysely<DB>
	redisClient: RedisClient
	config: AppConfig
	passwordResetNotifier: PasswordResetNotifier
}

export type AccountService = {
	createSessionWithPassword(input: CreateSessionBody, req: Request): Promise<CreateSessionResponse>
	getCurrentSession(userId: string): Promise<GetSessionResponse>
	deleteCurrentSession(req: Request): Promise<void>
	createPasswordResetRequest(input: { email: string }): Promise<void>
	completePasswordReset(input: { token: string; password: string }): Promise<void>
}

const STORE_KEY_PREFIX = 'idas:sess:'
const USER_SESSIONS_PREFIX = 'idas:user-sessions:'
const TOKEN_TTL_MS = 60 * 60 * 1_000

const generateResetToken = () => randomBytes(32).toString('base64url')
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const regenerateSession = (req: Request): Promise<void> =>
	new Promise((resolve, reject) => {
		req.session.regenerate((err) => {
			if (err) reject(err)
			else resolve()
		})
	})

const loginUser = (req: Request, user: Express.User): Promise<void> =>
	new Promise((resolve, reject) => {
		req.login(user, (err) => {
			if (err) reject(err)
			else resolve()
		})
	})

const getUserSessionsKey = (userId: string) => `${USER_SESSIONS_PREFIX}${userId}`

const invalidateUserSessions = async (redisClient: RedisClient, userId: string): Promise<void> => {
	const key = getUserSessionsKey(userId)
	const members = await redisClient.sMembers(key)
	if (members.length > 0) {
		await redisClient.del([...members, key])
	}
}

export const createAccountService = ({
	db,
	redisClient,
	config,
	passwordResetNotifier
}: AccountServiceDeps): AccountService => ({
	async createSessionWithPassword(input, req) {
		const normalizedEmail = input.email.trim().toLowerCase()

		const credentialRow = await db
			.selectFrom('users')
			.innerJoin('userCredentials', 'users.id', 'userCredentials.userId')
			.select([
				'users.id as userId',
				'users.email as email',
				'users.status as status',
				'users.name as name',
				'users.surname as surname',
				'users.userType as userType',
				'users.title as title',
				'userCredentials.passwordHash as passwordHash',
				'userCredentials.failedLoginCount as failedLoginCount',
				'userCredentials.lockedUntil as lockedUntil'
			])
			.where('users.email', '=', normalizedEmail)
			.executeTakeFirst()

		const noCredential = !credentialRow || credentialRow.status === 'INACTIVE'
		const now = new Date()
		const isLocked =
			credentialRow?.lockedUntil !== null && credentialRow?.lockedUntil !== undefined && credentialRow.lockedUntil > now

		if (noCredential) {
			await bcrypt.compare(input.password, getDummyHash(config.auth.bcryptRounds))
			throw new AppError('UNAUTHENTICATED', 'E-posta veya şifre hatalı.')
		}

		if (isLocked) {
			throw new AppError('UNAUTHENTICATED', 'E-posta veya şifre hatalı.')
		}

		const match = await bcrypt.compare(input.password, credentialRow.passwordHash)

		if (!match) {
			const raw = await db.executeQuery<{
				rows: Array<{ failedLoginCount: number; lockedUntil: string | null }>
			}>(
				sql`
					UPDATE user_credentials
					SET
						failed_login_count = CASE
							WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 1
							ELSE failed_login_count + 1
						END,
						locked_until = CASE
							WHEN (locked_until IS NOT NULL AND locked_until <= NOW()) OR (failed_login_count + 1) >= 5
								THEN NOW() + INTERVAL '15 minutes'
							WHEN locked_until IS NOT NULL AND locked_until > NOW()
								THEN locked_until
							ELSE NULL
						END
					WHERE user_id = ${credentialRow.userId}
					RETURNING failed_login_count AS "failedLoginCount", locked_until AS "lockedUntil"
				`.compile(db)
			)

			void raw.rows

			throw new AppError('UNAUTHENTICATED', 'E-posta veya şifre hatalı.')
		}

		await db
			.updateTable('userCredentials')
			.where('userId', '=', credentialRow.userId)
			.set({
				lastLoginAt: sql`NOW()`,
				failedLoginCount: 0,
				lockedUntil: null
			})
			.execute()

		const user: Express.User = {
			id: credentialRow.userId,
			email: credentialRow.email,
			status: credentialRow.status
		}

		await regenerateSession(req)
		await loginUser(req, user)
		const csrfToken = issueCsrfToken(req)

		const sessionStoreKey = `${STORE_KEY_PREFIX}${req.sessionID}`
		await redisClient.sAdd(getUserSessionsKey(user.id), sessionStoreKey)

		return {
			user: {
				id: user.id,
				email: user.email,
				name: credentialRow.name,
				surname: credentialRow.surname,
				userType: credentialRow.userType,
				title: credentialRow.title,
				status: user.status,
				roles: [],
				affiliations: []
			},
			csrfToken
		}
	},

	async getCurrentSession(userId) {
		const user = await db
			.selectFrom('users')
			.select(['id', 'email', 'name', 'surname', 'userType', 'title', 'status'])
			.where('id', '=', userId)
			.executeTakeFirst()

		if (!user || user.status === 'INACTIVE') {
			throw new AppError('UNAUTHENTICATED', 'Authentication required')
		}

		return {
			user: {
				...user,
				roles: [],
				affiliations: []
			}
		}
	},

	async deleteCurrentSession(req) {
		const userId = req.user?.id
		if (!userId) throw new AppError('UNAUTHENTICATED', 'Authentication required')

		const sessionStoreKey = `${STORE_KEY_PREFIX}${req.sessionID}`

		await new Promise<void>((resolve, reject) => {
			req.session.destroy((err) => {
				if (err) reject(err)
				else resolve()
			})
		})

		await redisClient.sRem(getUserSessionsKey(userId), sessionStoreKey)
	},

	async createPasswordResetRequest(input) {
		const normalizedEmail = input.email.trim().toLowerCase()

		const user = await db
			.selectFrom('users')
			.select(['id', 'status'])
			.where('email', '=', normalizedEmail)
			.executeTakeFirst()

		if (!user || user.status === 'INACTIVE') {
			// User yok veya inactive — generic 204, timing oracle için hiçbir iş yapma (queue yok).
			return
		}

		const token = generateResetToken()
		const tokenHash = hashToken(token)
		const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)

		await db
			.insertInto('passwordResetTokens')
			.values({
				userId: user.id,
				tokenHash,
				expiresAt
			})
			.onConflict((oc) =>
				oc.column('userId').doUpdateSet({
					tokenHash,
					expiresAt
				})
			)
			.execute()

		await passwordResetNotifier.enqueuePasswordResetEmail({
			userId: user.id,
			emailDigest: createHash('sha256').update(normalizedEmail).digest('hex'),
			resetUrl: `${config.auth.passwordResetUrl}?token=${token}`
		})
	},

	async completePasswordReset(input) {
		const tokenHash = hashToken(input.token)

		const tokenRow = await db
			.selectFrom('passwordResetTokens')
			.innerJoin('users', 'passwordResetTokens.userId', 'users.id')
			.select([
				'passwordResetTokens.userId as userId',
				'passwordResetTokens.expiresAt as expiresAt',
				'users.status as userStatus'
			])
			.where('passwordResetTokens.tokenHash', '=', tokenHash)
			.executeTakeFirst()

		if (!tokenRow || tokenRow.userStatus === 'INACTIVE' || tokenRow.expiresAt < new Date()) {
			throw new AppError('UNAUTHENTICATED', 'Geçersiz veya süresi dolmuş token.')
		}

		const passwordHash = await bcrypt.hash(input.password, config.auth.bcryptRounds)

		let deleted = false
		await db.transaction().execute(async (trx) => {
			const token = await trx
				.selectFrom('passwordResetTokens')
				.select(['id'])
				.where('tokenHash', '=', tokenHash)
				.where('expiresAt', '>=', new Date())
				.forUpdate()
				.executeTakeFirst()

			if (!token) {
				// Race: başka request token'ı kullandı. Üretilmiş hash discard.
				return
			}

			await trx
				.insertInto('userCredentials')
				.values({
					userId: tokenRow.userId,
					passwordHash,
					passwordChangedAt: sql`NOW()`
				})
				.onConflict((oc) =>
					oc.column('userId').doUpdateSet({
						passwordHash,
						passwordChangedAt: sql`NOW()`,
						failedLoginCount: 0,
						lockedUntil: null
					})
				)
				.execute()

			const results = await trx.deleteFrom('passwordResetTokens').where('id', '=', token.id).execute()
			const first = Array.isArray(results) ? results[0] : results
			deleted = Number(first?.numDeletedRows ?? 0) > 0
		})

		if (!deleted) {
			throw new AppError('UNAUTHENTICATED', 'Geçersiz veya süresi dolmuş token.')
		}

		await invalidateUserSessions(redisClient, tokenRow.userId)
	}
})
