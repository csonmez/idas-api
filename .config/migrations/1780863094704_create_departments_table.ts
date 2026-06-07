import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('departments')
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('short_name', 'varchar(255)')
		.addColumn('academic_unit_id', 'uuid', (col) =>
			col.notNull().references('academic_units.id').onUpdate('cascade').onDelete('restrict')
		)
		.addColumn('code', 'varchar(64)', (col) => col.notNull())
		.addColumn('phone', 'varchar(255)')
		.addColumn('email', 'varchar(255)')
		.addColumn('address', 'varchar(255)')
		.addColumn('website', 'varchar(255)')
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('deleted_at', 'timestamptz')
		.addUniqueConstraint('departments_id_academic_unit_id_unique', ['id', 'academic_unit_id'])
		.execute()

	await db.schema.createIndex('departments_academic_unit_id_idx').on('departments').column('academic_unit_id').execute()

	await db.schema
		.createIndex('departments_academic_unit_id_code_active_unique')
		.unique()
		.on('departments')
		.columns(['academic_unit_id', 'code'])
		.where(sql.ref('deleted_at'), 'is', null)
		.execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropIndex('departments_academic_unit_id_code_active_unique').ifExists().execute()
	await db.schema.dropIndex('departments_academic_unit_id_idx').ifExists().execute()
	await db.schema.dropTable('departments').ifExists().execute()
}
