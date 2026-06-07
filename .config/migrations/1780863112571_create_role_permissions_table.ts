import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createType('role_scope_type')
		.asEnum(['GLOBAL', 'ACADEMIC_UNIT', 'DEPARTMENT', 'DISCIPLINE'])
		.execute()

	await db.schema
		.createTable('role_permissions')
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onUpdate('cascade').onDelete('cascade'))
		.addColumn('role', 'varchar(255)', (col) => col.notNull())
		.addColumn('permissions', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
		.addColumn('scope_type', sql`role_scope_type`, (col) => col.notNull().defaultTo('GLOBAL'))
		.addColumn('academic_unit_id', 'uuid', (col) =>
			col.references('academic_units.id').onUpdate('cascade').onDelete('restrict')
		)
		.addColumn('department_id', 'uuid')
		.addColumn('discipline_id', 'uuid')
		.addColumn('start_date', 'timestamptz')
		.addColumn('end_date', 'timestamptz')
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('deleted_at', 'timestamptz')
		.addForeignKeyConstraint(
			'role_permissions_department_fk',
			['department_id', 'academic_unit_id'],
			'departments',
			['id', 'academic_unit_id'],
			(fk) => fk.onUpdate('cascade').onDelete('restrict')
		)
		.addForeignKeyConstraint(
			'role_permissions_discipline_fk',
			['discipline_id', 'department_id', 'academic_unit_id'],
			'disciplines',
			['id', 'department_id', 'academic_unit_id'],
			(fk) => fk.onUpdate('cascade').onDelete('restrict')
		)
		.addCheckConstraint(
			'role_permissions_date_range_check',
			sql`end_date is null or start_date is null or end_date >= start_date`
		)
		.addCheckConstraint(
			'role_permissions_scope_columns_check',
			sql`(
				(scope_type = 'GLOBAL' and academic_unit_id is null and department_id is null and discipline_id is null)
				or (scope_type = 'ACADEMIC_UNIT' and academic_unit_id is not null and department_id is null and discipline_id is null)
				or (scope_type = 'DEPARTMENT' and academic_unit_id is not null and department_id is not null and discipline_id is null)
				or (scope_type = 'DISCIPLINE' and academic_unit_id is not null and department_id is not null and discipline_id is not null)
			)`
		)
		.execute()

	await db.schema.createIndex('role_permissions_user_id_idx').on('role_permissions').column('user_id').execute()

	await db.schema
		.createIndex('role_permissions_academic_unit_id_idx')
		.on('role_permissions')
		.column('academic_unit_id')
		.execute()

	await db.schema
		.createIndex('role_permissions_department_id_idx')
		.on('role_permissions')
		.column('department_id')
		.execute()

	await db.schema
		.createIndex('role_permissions_discipline_id_idx')
		.on('role_permissions')
		.column('discipline_id')
		.execute()

	await db.schema
		.createIndex('role_permissions_global_active_unique')
		.unique()
		.on('role_permissions')
		.columns(['user_id', 'role'])
		.where(sql.ref('scope_type'), '=', sql.lit('GLOBAL'))
		.where(sql.ref('deleted_at'), 'is', null)
		.execute()

	await db.schema
		.createIndex('role_permissions_academic_unit_active_unique')
		.unique()
		.on('role_permissions')
		.columns(['user_id', 'role', 'academic_unit_id'])
		.where(sql.ref('scope_type'), '=', sql.lit('ACADEMIC_UNIT'))
		.where(sql.ref('deleted_at'), 'is', null)
		.execute()

	await db.schema
		.createIndex('role_permissions_department_active_unique')
		.unique()
		.on('role_permissions')
		.columns(['user_id', 'role', 'department_id'])
		.where(sql.ref('scope_type'), '=', sql.lit('DEPARTMENT'))
		.where(sql.ref('deleted_at'), 'is', null)
		.execute()

	await db.schema
		.createIndex('role_permissions_discipline_active_unique')
		.unique()
		.on('role_permissions')
		.columns(['user_id', 'role', 'discipline_id'])
		.where(sql.ref('scope_type'), '=', sql.lit('DISCIPLINE'))
		.where(sql.ref('deleted_at'), 'is', null)
		.execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropIndex('role_permissions_discipline_active_unique').ifExists().execute()
	await db.schema.dropIndex('role_permissions_department_active_unique').ifExists().execute()
	await db.schema.dropIndex('role_permissions_academic_unit_active_unique').ifExists().execute()
	await db.schema.dropIndex('role_permissions_global_active_unique').ifExists().execute()
	await db.schema.dropIndex('role_permissions_discipline_id_idx').ifExists().execute()
	await db.schema.dropIndex('role_permissions_department_id_idx').ifExists().execute()
	await db.schema.dropIndex('role_permissions_academic_unit_id_idx').ifExists().execute()
	await db.schema.dropIndex('role_permissions_user_id_idx').ifExists().execute()
	await db.schema.dropTable('role_permissions').ifExists().execute()
	await db.schema.dropType('role_scope_type').ifExists().execute()
}
