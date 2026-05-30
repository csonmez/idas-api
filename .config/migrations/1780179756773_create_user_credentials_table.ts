import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('user_credentials')
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn('user_id', 'uuid', (col) => col.notNull().unique().references('users.id').onDelete('cascade'))
		.addColumn('password_hash', 'varchar(255)', (col) => col.notNull())
		.addColumn('password_changed_at', 'timestamptz', (col) => col.notNull())
		.addColumn('last_login_at', 'timestamptz')
		.addColumn('failed_login_count', 'integer', (col) => col.notNull().defaultTo(0))
		.addColumn('locked_until', 'timestamptz')
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable('user_credentials').ifExists().execute()
}
