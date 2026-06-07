import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema.createType('academic_affiliation_type').asEnum(['PRIMARY', 'SECONDARY']).execute()

	await db.schema
		.createTable('user_academic_affiliations')
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onUpdate('cascade').onDelete('cascade'))
		.addColumn('academic_unit_id', 'uuid', (col) =>
			col.references('academic_units.id').onUpdate('cascade').onDelete('restrict')
		)
		.addColumn('department_id', 'uuid')
		.addColumn('discipline_id', 'uuid')
		.addColumn('affiliation_type', sql`academic_affiliation_type`, (col) => col.notNull().defaultTo('PRIMARY'))
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('deleted_at', 'timestamptz')
		.addForeignKeyConstraint(
			'user_academic_affiliations_department_fk',
			['department_id', 'academic_unit_id'],
			'departments',
			['id', 'academic_unit_id'],
			(fk) => fk.onUpdate('cascade').onDelete('restrict')
		)
		.addForeignKeyConstraint(
			'user_academic_affiliations_discipline_fk',
			['discipline_id', 'department_id', 'academic_unit_id'],
			'disciplines',
			['id', 'department_id', 'academic_unit_id'],
			(fk) => fk.onUpdate('cascade').onDelete('restrict')
		)
		.addCheckConstraint(
			'user_academic_affiliations_scope_present_check',
			sql`academic_unit_id is not null or department_id is not null or discipline_id is not null`
		)
		.addCheckConstraint(
			'user_academic_affiliations_department_hierarchy_check',
			sql`department_id is null or academic_unit_id is not null`
		)
		.addCheckConstraint(
			'user_academic_affiliations_discipline_hierarchy_check',
			sql`discipline_id is null or (department_id is not null and academic_unit_id is not null)`
		)
		.execute()

	await db.schema
		.createIndex('user_academic_affiliations_user_id_idx')
		.on('user_academic_affiliations')
		.column('user_id')
		.execute()

	await db.schema
		.createIndex('user_academic_affiliations_academic_unit_id_idx')
		.on('user_academic_affiliations')
		.column('academic_unit_id')
		.execute()

	await db.schema
		.createIndex('user_academic_affiliations_department_id_idx')
		.on('user_academic_affiliations')
		.column('department_id')
		.execute()

	await db.schema
		.createIndex('user_academic_affiliations_discipline_id_idx')
		.on('user_academic_affiliations')
		.column('discipline_id')
		.execute()

	await db.schema
		.createIndex('user_academic_affiliations_primary_active_unique')
		.unique()
		.on('user_academic_affiliations')
		.column('user_id')
		.where(sql.ref('affiliation_type'), '=', sql.lit('PRIMARY'))
		.where(sql.ref('deleted_at'), 'is', null)
		.execute()

	await db.schema
		.createIndex('user_academic_affiliations_academic_unit_level_active_unique')
		.unique()
		.on('user_academic_affiliations')
		.columns(['user_id', 'academic_unit_id'])
		.where(sql.ref('academic_unit_id'), 'is not', null)
		.where(sql.ref('department_id'), 'is', null)
		.where(sql.ref('discipline_id'), 'is', null)
		.where(sql.ref('deleted_at'), 'is', null)
		.execute()

	await db.schema
		.createIndex('user_academic_affiliations_department_level_active_unique')
		.unique()
		.on('user_academic_affiliations')
		.columns(['user_id', 'department_id'])
		.where(sql.ref('department_id'), 'is not', null)
		.where(sql.ref('discipline_id'), 'is', null)
		.where(sql.ref('deleted_at'), 'is', null)
		.execute()

	await db.schema
		.createIndex('user_academic_affiliations_discipline_level_active_unique')
		.unique()
		.on('user_academic_affiliations')
		.columns(['user_id', 'discipline_id'])
		.where(sql.ref('discipline_id'), 'is not', null)
		.where(sql.ref('deleted_at'), 'is', null)
		.execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropIndex('user_academic_affiliations_discipline_level_active_unique').ifExists().execute()
	await db.schema.dropIndex('user_academic_affiliations_department_level_active_unique').ifExists().execute()
	await db.schema.dropIndex('user_academic_affiliations_academic_unit_level_active_unique').ifExists().execute()
	await db.schema.dropIndex('user_academic_affiliations_primary_active_unique').ifExists().execute()
	await db.schema.dropIndex('user_academic_affiliations_discipline_id_idx').ifExists().execute()
	await db.schema.dropIndex('user_academic_affiliations_department_id_idx').ifExists().execute()
	await db.schema.dropIndex('user_academic_affiliations_academic_unit_id_idx').ifExists().execute()
	await db.schema.dropIndex('user_academic_affiliations_user_id_idx').ifExists().execute()
	await db.schema.dropTable('user_academic_affiliations').ifExists().execute()
	await db.schema.dropType('academic_affiliation_type').ifExists().execute()
}
