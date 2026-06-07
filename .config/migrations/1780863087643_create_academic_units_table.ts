import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createType('academic_unit_type')
		.asEnum(['FACULTY', 'INSTITUTE', 'SCHOOL', 'VOCATIONAL_SCHOOL'])
		.execute()

	await db.schema.createType('academic_field').asEnum(['HEALTH', 'SOCIAL', 'SCIENCE_ENGINEERING']).execute()

	await db.schema.createType('sub_unit_level').asEnum(['DEPARTMENT', 'DISCIPLINE']).execute()

	await db.schema
		.createTable('academic_units')
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn('code', 'varchar(64)', (col) => col.notNull())
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('short_name', 'varchar(255)')
		.addColumn('type', sql`academic_unit_type`, (col) => col.notNull())
		.addColumn('academic_field', sql`academic_field`)
		.addColumn('sub_unit_level', sql`sub_unit_level`, (col) => col.notNull().defaultTo('DEPARTMENT'))
		.addColumn('is_tracked', 'boolean', (col) => col.notNull().defaultTo(true))
		.addColumn('phone', 'varchar(255)')
		.addColumn('email', 'varchar(255)')
		.addColumn('address', 'varchar(255)')
		.addColumn('website', 'varchar(255)')
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('deleted_at', 'timestamptz')
		.execute()

	await db.schema
		.createIndex('academic_units_code_active_unique')
		.unique()
		.on('academic_units')
		.column('code')
		.where(sql.ref('deleted_at'), 'is', null)
		.execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropIndex('academic_units_code_active_unique').ifExists().execute()
	await db.schema.dropTable('academic_units').ifExists().execute()
	await db.schema.dropType('sub_unit_level').ifExists().execute()
	await db.schema.dropType('academic_field').ifExists().execute()
	await db.schema.dropType('academic_unit_type').ifExists().execute()
}
