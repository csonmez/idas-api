import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('password_reset_tokens')
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn('user_id', 'uuid', (col) => col.notNull().unique().references('users.id').onDelete('cascade'))
		.addColumn('token_hash', 'varchar(64)', (col) => col.notNull().unique())
		.addColumn('expires_at', 'timestamptz', (col) => col.notNull())
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable('password_reset_tokens').ifExists().execute()
}
