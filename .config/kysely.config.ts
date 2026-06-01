import { defineConfig } from 'kysely-ctl'
import { Pool } from 'pg'

const createPool = async () => {
	const connectionString = process.env.DATABASE_URL

	if (!connectionString) {
		throw new Error('DATABASE_URL is required')
	}

	return new Pool({
		connectionString,
		max: Number(process.env.DB_MIGRATION_POOL_MAX ?? 2),
		idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? 30_000),
		connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? 5_000)
	})
}

export default defineConfig({
	dialect: 'pg',
	dialectConfig: {
		pool: createPool
	},
	migrations: {
		migrationFolder: 'migrations'
	}
})
