import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('disciplines')
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('short_name', 'varchar(255)')
		.addColumn('academic_unit_id', 'uuid', (col) => col.notNull())
		.addColumn('department_id', 'uuid', (col) => col.notNull())
		.addColumn('code', 'varchar(64)', (col) => col.notNull())
		.addColumn('phone', 'varchar(255)')
		.addColumn('email', 'varchar(255)')
		.addColumn('address', 'varchar(255)')
		.addColumn('website', 'varchar(255)')
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('deleted_at', 'timestamptz')
		.addForeignKeyConstraint('disciplines_academic_unit_id_fk', ['academic_unit_id'], 'academic_units', ['id'], (fk) =>
			fk.onUpdate('cascade').onDelete('restrict')
		)
		.addForeignKeyConstraint(
			'disciplines_department_id_academic_unit_id_fk',
			['department_id', 'academic_unit_id'],
			'departments',
			['id', 'academic_unit_id'],
			(fk) => fk.onUpdate('cascade').onDelete('restrict')
		)
		.addUniqueConstraint('disciplines_id_department_id_academic_unit_id_unique', [
			'id',
			'department_id',
			'academic_unit_id'
		])
		.execute()

	await db.schema.createIndex('disciplines_academic_unit_id_idx').on('disciplines').column('academic_unit_id').execute()

	await db.schema.createIndex('disciplines_department_id_idx').on('disciplines').column('department_id').execute()

	await db.schema
		.createIndex('disciplines_academic_unit_id_code_active_unique')
		.unique()
		.on('disciplines')
		.columns(['academic_unit_id', 'code'])
		.where(sql.ref('deleted_at'), 'is', null)
		.execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropIndex('disciplines_academic_unit_id_code_active_unique').ifExists().execute()
	await db.schema.dropIndex('disciplines_department_id_idx').ifExists().execute()
	await db.schema.dropIndex('disciplines_academic_unit_id_idx').ifExists().execute()
	await db.schema.dropTable('disciplines').ifExists().execute()
}
