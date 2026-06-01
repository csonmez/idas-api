import { Kysely, PostgresDialect } from 'kysely'
import { Pool, type PoolConfig } from 'pg'
import type { DB } from './db.generated.ts'

type DbPoolConfig = Omit<PoolConfig, 'connectionString'>

const readPositiveIntegerEnv = (name: string, fallback: number) => {
	const value = process.env[name]

	if (!value) {
		return fallback
	}

	const parsed = Number(value)

	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`)
	}

	return parsed
}

export const createDb = (connectionString: string, poolConfig: DbPoolConfig = {}) => {
	return new Kysely<DB>({
		dialect: new PostgresDialect({
			pool: new Pool({
				...poolConfig,
				connectionString
			})
		})
	})
}

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
	throw new Error('DATABASE_URL is required')
}

const poolConfig: DbPoolConfig = {
	max: readPositiveIntegerEnv('DB_POOL_MAX', 10),
	idleTimeoutMillis: readPositiveIntegerEnv('DB_POOL_IDLE_TIMEOUT_MS', 30_000),
	connectionTimeoutMillis: readPositiveIntegerEnv('DB_POOL_CONNECTION_TIMEOUT_MS', 5_000)
}

export const db = createDb(connectionString, poolConfig)

export const closeDb = async () => {
	await db.destroy()
}
