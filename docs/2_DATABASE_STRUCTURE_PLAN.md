# Database Structure Plani

## Summary

Database katmani `src/database` altinda toplanacak. Bu katman iki temel sorumluluga ayrilacak:

- Generated Kysely DB tipi.
- Uygulama runtime'inda kullanilacak DB client/factory ve public barrel export.

`index.ts` barrel olarak kalacak. Gercek connection kurma kodu ayri dosyada tutulacak. Boylece import yollari sade kalirken dosya sorumluluklari karismayacak.

## Target Structure

```text
src/
  database/
    db.generated.ts
    client.ts
    index.ts
```

### `db.generated.ts`

Bu dosya `kysely-codegen` tarafindan uretilecek.

Notlar:

- Elle duzenlenmeyecek.
- DB schema degistikten sonra `npm run db:codegen` ile yeniden uretilecek.
- Kysely query tipleri icin tek kaynak olacak.
- Dosya adinda `generated` kullanilmasi, bu dosyanin manuel domain kodu olmadigini netlestirir.
- `db.type.ts` ismi de kullanilabilir; ancak generated oldugunu dosya adinda gostermek icin `db.generated.ts` tercih edilecek.

Package script:

```json
"db:codegen": "kysely-codegen --camel-case --singularize --out-file ./src/database/db.generated.ts"
```

### `client.ts`

DB connection ve Kysely instance olusturma sorumlulugu burada olacak.

Sorumluluklar:

- `DATABASE_URL` kontrolu.
- `pg` Pool olusturma.
- Pool tuning icin prod/test konfigurasyon placeholder'larini destekleme.
- `Kysely<DB>` instance olusturma.
- App runtime icin `db` singleton export etme.
- Graceful shutdown ve test cleanup icin `closeDb` export etme.
- Testlerde veya farkli runtime'larda kullanmak icin `createDb` factory export etme.

Onerilen skeleton:

```ts
import { Kysely, PostgresDialect } from 'kysely'
import { Pool, type PoolConfig } from 'pg'
import type { DB } from './db.generated.ts'

type DbPoolConfig = Omit<PoolConfig, 'connectionString'>

const readPositiveIntegerEnv = (name: string, fallback: number) => {
	const value = process.env[name]

	if (!value) {
		return fallback
	}

	const parsed = Number(value)

	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`)
	}

	return parsed
}

export const createDb = (connectionString: string, poolConfig: DbPoolConfig = {}) => {
	return new Kysely<DB>({
		dialect: new PostgresDialect({
			pool: new Pool({
				...poolConfig,
				connectionString
			})
		})
	})
}

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
	throw new Error('DATABASE_URL is required')
}

const poolConfig: DbPoolConfig = {
	max: readPositiveIntegerEnv('DB_POOL_MAX', 10),
	idleTimeoutMillis: readPositiveIntegerEnv('DB_POOL_IDLE_TIMEOUT_MS', 30_000),
	connectionTimeoutMillis: readPositiveIntegerEnv('DB_POOL_CONNECTION_TIMEOUT_MS', 5_000)
}

export const db = createDb(connectionString, poolConfig)

export const closeDb = async () => {
	await db.destroy()
}
```

Notlar:

- Proje Node ESM ve `moduleResolution: "NodeNext"` kullandigi icin runtime'da relative import/export path'leri extension ister.
- Source code icinde `.js` extension yazilmamasi icin relative local import/export path'lerinde `.ts` extension kullanilacak.
- `tsconfig.json` icinde `rewriteRelativeImportExtensions: true` acik olacak; TypeScript build sirasinda relative `.ts` import/export path'lerini dist ciktisinda `.js` olarak rewrite edecek.
- Extensionless relative import (`./client`) native Node ESM + `tsc` output akisi icin kullanilmayacak; Node runtime bunu resolve etmez.
- `db` singleton import edildigi anda pool olusur. Bu runtime icin kabul edilebilir.
- Prod pool ayarlari bilincli config degerleriyle yonetilecek. Minimum olarak `max`, `idleTimeoutMillis`, `connectionTimeoutMillis` desteklenecek.
- Pool degerleri hard-coded magic number olarak yayilmayacak; ileride merkezi config/env validation katmani varsa oraya tasinacak.
- Migration/CLI tarafindaki Pool kullanimi da ayni tuning prensiplerini takip edecek; migration pool'u app runtime pool'u ile ayni boyutta olmak zorunda degildir.
- Sadece tip ihtiyaci olan kodlar `DB` tipini import etmeli; gereksiz yere `db` import edilmemeli.
- `closeDb()` sadece app singleton `db` instance'ini kapatir.
- `createDb(...)` ile yaratilan instance'larin lifecycle sahibi caller'dir; testlerde `afterAll`, scriptlerde `finally` icinde `destroy()` cagrilmalidir.
- Testlerde app singleton yerine `createDb(testDatabaseUrl)` kullanmak daha kontrollu olur.
- Integration testlerde `TEST_DATABASE_URL` kullanilacak; eksikse `DATABASE_URL` fallback'i yapilmadan acik hata verilecek.

### `index.ts`

`index.ts` sadece public API barrel olacak.

```ts
export { closeDb, createDb, db } from './client.ts'
export type { DB } from './db.generated.ts'
```

Notlar:

- `index.ts` icinde connection logic yazilmayacak.
- `index.ts` icinde env okuma, pool olusturma veya migration calistirma gibi yan etkili kod bulunmayacak.
- Uygulama kodlari mumkun oldugunca database katmanina bu public entrypoint uzerinden erisecek.

## Import Convention

Feature/service katmaninda:

```ts
import { db } from '../database/index.ts'
```

veya klasor konumuna gore:

```ts
import { db } from '../../database/index.ts'
```

Type-only kullanimda:

```ts
import type { DB } from '../database/index.ts'
```

Path alias eklenirse ileride importlar su hale getirilebilir:

```ts
import { db } from '@/database'
```

Bu plan su an path alias gerektirmez.

## Implementation Order

1. `package.json` icindeki `db:codegen` output path'i `src/database/db.generated.ts` olacak.
2. Migrationlar calistirildiktan sonra `npm run db:codegen` calistirilacak.
3. `tsconfig.json` icinde `rewriteRelativeImportExtensions: true` aktif olacak.
4. Pool config icin env/config placeholder'lari belirlenecek (`DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_CONNECTION_TIMEOUT_MS`).
5. `src/database/client.ts` eklenecek.
6. `src/database/index.ts` barrel olarak eklenecek.
7. Integration test setup'i `TEST_DATABASE_URL` ile singleton yerine `createDb(...)` kullanacak sekilde tasarlanacak.
8. App bootstrap tarafinda `db` kullanilacak.
9. Server bootstrap dosyasinda (`src/server.ts` -> `dist/server.js`) `SIGINT`/`SIGTERM` shutdown flow'una `closeDb()` eklenecek.

## Best Practices

- Generated dosya manuel degistirilmeyecek.
- Connection logic tek yerde tutulacak.
- Feature/service dosyalari kendi `Pool` veya `Kysely` instance'larini olusturmayacak.
- DB lifecycle app bootstrap/shutdown tarafindan yonetilecek.
- Prod pool ayarlari en az `max`, `idleTimeoutMillis`, `connectionTimeoutMillis` icin acik config ile yonetilecek.
- Pool sizing DB `max_connections`, uygulama process/replica sayisi ve workload dikkate alinarak belirlenecek.
- Migration ve CLI komutlari icin de bilincli Pool config'i kullanilacak; gerekirse runtime'dan daha kucuk pool tercih edilecek.
- Testlerde singleton yerine factory tercih edilecek.
- Testlerde ayri `TEST_DATABASE_URL` kullanilacak; test DB env'i eksikse prod/dev DB'ye fallback edilmeyecek.
- Factory ile yaratilan instance'lari caller kapatacak; `closeDb()` sadece singleton `db` icindir.
- `DATABASE_URL` eksikse uygulama erken ve acik hata ile fail edecek.
- Migration ve codegen birbirinden ayri tutulacak; codegen sadece basarili schema degisikliklerinden sonra calistirilacak.
- Source code icinde relative local import/export path'leri extensionless yazilmayacak; `.ts` extension yazilacak.
- Build output'ta Node ESM uyumu TypeScript'in `rewriteRelativeImportExtensions` rewrite'i ile saglanacak.
- Extensionless import istenirse native `tsc -> node dist` akisi yerine bundler, loader veya post-build rewrite araci gerekir; bu proje icin varsayilan tercih degil.
- Shutdown signal handler'lari database client modulu icinde degil, server bootstrap dosyasinda ele alinacak.
- Shutdown sirasinda once HTTP server yeni request almayi durduracak, ardindan `closeDb()` ile singleton pool kapatilacak.

## Resolved Decisions

- Test database icin ayri `TEST_DATABASE_URL` kullanilacak.
- App shutdown sinyalleri (`SIGINT`, `SIGTERM`) server bootstrap dosyasinda ele alinacak.

## Open Decisions

- Path alias (`@/database`) eklenip eklenmeyecegi.

## References

- Node.js ESM dokumantasyonu relative ve absolute import specifier'larinda file extension'in zorunlu oldugunu belirtir.
- TypeScript module reference extensionless relative import path'lerin Node.js import path'lerinde desteklenmedigini belirtir.
- TypeScript 5.7 ile gelen `rewriteRelativeImportExtensions`, relative `.ts`, `.tsx`, `.mts`, `.cts` import/export path'lerini output'ta JavaScript extension'ina rewrite eder.
