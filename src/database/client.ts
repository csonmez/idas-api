import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely'
import { Pool, type PoolConfig } from 'pg'
import type { DB } from './db.generated.ts'

type DbPoolConfig = Omit<PoolConfig, 'connectionString'>

const DEFAULT_POOL_CONFIG = {
	max: 15,
	idleTimeoutMillis: 30_000,
	connectionTimeoutMillis: 5_000
} satisfies DbPoolConfig

export const createDb = (connectionString: string, poolConfig: DbPoolConfig = DEFAULT_POOL_CONFIG) => {
	return new Kysely<DB>({
		dialect: new PostgresDialect({
			pool: new Pool({
				...poolConfig,
				connectionString
			})
		}),
		plugins: [new CamelCasePlugin()]
	})
}
