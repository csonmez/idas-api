import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema.createType('user_type').asEnum(['ACADEMICIAN', 'POSTDOC', 'STAFF']).execute()

	await db.schema
		.createType('user_title')
		.asEnum([
			'PROFESSOR',
			'ASSOCIATE_PROFESSOR',
			'ASSISTANT_PROFESSOR',
			'RESEARCH_ASSISTANT',
			'RESEARCH_ASSISTANT_DOCTOR',
			'LECTURER',
			'LECTURER_DOCTOR',
			'DOCTOR'
		])
		.execute()

	await db.schema.createType('user_status').asEnum(['ACTIVE', 'INACTIVE']).execute()

	await db.schema
		.createTable('users')
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('surname', 'varchar(255)', (col) => col.notNull())
		.addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
		.addColumn('user_type', sql`user_type`, (col) => col.notNull())
		.addColumn('title', sql`user_title`)
		.addColumn('status', sql`user_status`, (col) => col.notNull().defaultTo('ACTIVE'))
		.addColumn('iban', 'varchar(255)')
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('deleted_at', 'timestamptz')
		.execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable('users').ifExists().execute()
	await db.schema.dropType('user_status').ifExists().execute()
	await db.schema.dropType('user_title').ifExists().execute()
	await db.schema.dropType('user_type').ifExists().execute()
}
