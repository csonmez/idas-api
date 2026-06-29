import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	CamelCasePlugin,
	type Dialect,
	DummyDriver,
	Kysely,
	PostgresAdapter,
	PostgresIntrospector,
	PostgresQueryCompiler
} from 'kysely'
import type { DB } from '../../../database/db.generated.ts'
import { buildFindActiveGrantsForPermissionQuery } from '../authorization.repository.ts'
import { PERMISSIONS } from '../authorization.types.ts'

const createCompileOnlyDb = (): Kysely<DB> => {
	const dialect: Dialect = {
		createAdapter: () => new PostgresAdapter(),
		createDriver: () => new DummyDriver(),
		createIntrospector: (db) => new PostgresIntrospector(db),
		createQueryCompiler: () => new PostgresQueryCompiler()
	}

	return new Kysely<DB>({ dialect, plugins: [new CamelCasePlugin()] })
}

const normalizeSql = (sql: string): string => sql.replace(/\s+/g, ' ').trim()

describe('buildFindActiveGrantsForPermissionQuery', () => {
	it('compiles user, permission, soft-delete, and date validity filters into the production grant query', async () => {
		const db = createCompileOnlyDb()
		const userId = 'user-1'
		const now = new Date('2026-01-02T03:04:05.000Z')

		try {
			const compiled = buildFindActiveGrantsForPermissionQuery(db, userId, PERMISSIONS.REPORT_READ, now).compile()
			const sql = normalizeSql(compiled.sql)

			assert.match(sql, /^select "scope_type", "permissions", "academic_unit_id", "department_id", "discipline_id"/)
			assert.match(sql, /from "role_permissions"/)
			assert.match(sql, /"user_id" = \$1/)
			assert.match(sql, /"permissions" @> array\[\$2\]::text\[\]/)
			assert.match(sql, /"deleted_at" is null/)
			assert.match(sql, /\("start_date" is null or "start_date" <= \$3\)/)
			assert.match(sql, /\("end_date" is null or "end_date" >= \$4\)/)
			assert.deepEqual(compiled.parameters, [userId, PERMISSIONS.REPORT_READ, now, now])
		} finally {
			await db.destroy()
		}
	})
})
