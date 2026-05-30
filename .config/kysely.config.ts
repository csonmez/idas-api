import { defineConfig } from 'kysely-ctl'
import { Pool } from 'pg'

const createPool = async () => {
	const connectionString = process.env.DATABASE_URL

	if (!connectionString) {
		throw new Error('DATABASE_URL is required')
	}

	return new Pool({ connectionString })
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
