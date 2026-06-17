# Database Structure Plani

## Summary

Database katmani `src/database` altinda toplanacak. Bu katman iki temel sorumluluga ayrilacak:

- Generated Kysely DB tipi.
- Runtime'da config ile olusturulacak DB client factory.

V2'de `database/client.ts` dogrudan `process.env` okumayacak ve top-level `db` singleton'i export etmeyecek. DB instance'i `server.ts` icinde `readEnv()` calistiktan sonra `createDb(config.databaseUrl)` ile olusturulacak.

Bu karar bootstrap planindaki tek env okuma noktasi prensibiyle uyumludur.

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

Package script:

```json
"db:codegen": "kysely-codegen --camel-case --singularize --out-file ./src/database/db.generated.ts"
```

### `client.ts`

DB connection ve Kysely instance olusturma sorumlulugu burada olacak.

Sorumluluklar:

- `createDb(connectionString)` factory'si saglamak.
- `pg` Pool olusturmak.
- Runtime pool ayarlari icin sabit, bilincli default degerler kullanmak.
- Testlerde veya farkli runtime'larda kullanmak icin factory export etmek.
- Caller'in kapatabilmesi icin `closeDb(db)` helper'i saglamak.

Yapmamasi gerekenler:

- `process.env` okumak.
- Uygulama runtime'i icin top-level `db` singleton'i olusturmak.
- Pool degerlerini env'den parse etmek.

Onerilen skeleton:

```ts
import { Kysely, PostgresDialect } from 'kysely'
import { Pool, type PoolConfig } from 'pg'
import type { DB } from './db.generated.ts'

type DbPoolConfig = Omit<PoolConfig, 'connectionString'>

const DEFAULT_POOL_CONFIG = {
	max: 10,
	idleTimeoutMillis: 30_000,
	connectionTimeoutMillis: 5_000
} satisfies DbPoolConfig

export const createDb = (
	connectionString: string,
	poolConfig: DbPoolConfig = DEFAULT_POOL_CONFIG
) => {
	return new Kysely<DB>({
		dialect: new PostgresDialect({
			pool: new Pool({
				...poolConfig,
				connectionString
			})
		})
	})
}

export const closeDb = async (db: Kysely<DB>) => {
	await db.destroy()
}
```

Notlar:

- `DATABASE_URL` kontrolu `src/config/env.ts` icinde Zod ile yapilacak.
- Pool degerleri ilk fazda sabit kalacak. Kod deploy edilmeden runtime'da degistirilmesi gereken bir ihtiyac yok.
- Ileride gercek bir operasyon ihtiyaci cikarsa pool degerleri config'e acilabilir; ilk fazda gereksiz env yuzeyi olusturulmayacak.
- `connectionTimeoutMillis` client seviyesinde kalir; bootstrap tarafinda generic promise timeout helper'i yazilmaz.
- `createDb(...)` ile yaratilan instance'in lifecycle sahibi caller'dir.
- App runtime'da owner `server.ts` olur.
- Testlerde owner test setup olur ve `after`/`finally` icinde `destroy()` ya da `closeDb(db)` cagrilir.

### `index.ts`

`index.ts` sadece public API barrel olacak.

```ts
export { closeDb, createDb } from './client.ts'
export type { DB } from './db.generated.ts'
```

Notlar:

- `index.ts` icinde connection logic yazilmayacak.
- `index.ts` icinde env okuma, pool olusturma veya migration calistirma gibi yan etkili kod bulunmayacak.

## Import Convention

Runtime bootstrap:

```ts
import { createDb } from './database/index.ts'
```

Type-only kullanim:

```ts
import type { DB } from '../database/index.ts'
```

Feature/service kodlari kendi `Pool` veya `Kysely` instance'larini olusturmayacak. DB ihtiyaci route/service factory dependency'si olarak tasinacak.

Ornek:

```ts
export const createUserService = (deps: { db: Kysely<DB> }) => {
	// ...
}
```

Path alias eklenirse ileride importlar su hale getirilebilir:

```ts
import { createDb } from '@/database'
```

Bu plan su an path alias gerektirmez.

## Implementation Order

1. `package.json` icindeki `db:codegen` output path'i `src/database/db.generated.ts` olacak.
2. Migrationlar calistirildiktan sonra `npm run db:codegen` calistirilacak.
3. `tsconfig.json` icinde `rewriteRelativeImportExtensions: true` aktif olacak.
4. `src/database/client.ts` env okumayan factory olarak guncellenecek.
5. DB pool config sabitleri `client.ts` icinde tutulacak.
6. `src/database/index.ts` barrel olarak guncellenecek.
7. App bootstrap tarafinda `createDb(config.databaseUrl)` kullanilacak.
8. Server shutdown flow'unda runtime DB instance'i `closeDb(db)` veya `db.destroy()` ile kapatilacak.
9. Integration test setup'i `TEST_DATABASE_URL` ile singleton yerine `createDb(...)` kullanacak sekilde tasarlanacak.

## Best Practices

- Generated dosya manuel degistirilmeyecek.
- Connection logic tek yerde tutulacak.
- `database/client.ts` env okumayacak.
- Feature/service dosyalari kendi `Pool` veya `Kysely` instance'larini olusturmayacak.
- DB lifecycle app bootstrap/shutdown tarafindan yonetilecek.
- Pool degerleri ilk fazda sabit kalacak.
- Pool sizing DB `max_connections`, uygulama process/replica sayisi ve workload dikkate alinarak kodda bilincli secilecek.
- Testlerde ayri `TEST_DATABASE_URL` kullanilacak; test DB env'i eksikse prod/dev DB'ye fallback edilmeyecek.
- Factory ile yaratilan instance'lari caller kapatacak.
- `DATABASE_URL` eksikse uygulama `env.ts` validation asamasinda erken ve acik hata ile fail edecek.
- Migration ve codegen birbirinden ayri tutulacak; codegen sadece basarili schema degisikliklerinden sonra calistirilacak.
- Source code icinde relative local import/export path'leri extensionless yazilmayacak; `.ts` extension yazilacak.
- Build output'ta Node ESM uyumu TypeScript'in `rewriteRelativeImportExtensions` rewrite'i ile saglanacak.
- Shutdown signal handler'lari database client modulu icinde degil, server bootstrap dosyasinda ele alinacak.

## Resolved Decisions

- DB client top-level singleton olarak export edilmeyecek.
- DB client env okumayacak.
- DB pool ayarlari ilk fazda env olmayacak.
- Test database icin ayri `TEST_DATABASE_URL` kullanilacak.
- App shutdown sinyalleri (`SIGINT`, `SIGTERM`) server bootstrap dosyasinda ele alinacak.

## Open Decisions

- Path alias (`@/database`) eklenip eklenmeyecegi.
- Managed PostgreSQL SSL ihtiyaci cikarsa hangi config modeliyle desteklenecegi.

## References

- Node.js ESM dokumantasyonu relative ve absolute import specifier'larinda file extension'in zorunlu oldugunu belirtir.
- TypeScript module reference extensionless relative import path'lerin Node.js import path'lerinde desteklenmedigini belirtir.
- TypeScript 5.7 ile gelen `rewriteRelativeImportExtensions`, relative `.ts`, `.tsx`, `.mts`, `.cts` import/export path'lerini output'ta JavaScript extension'ina rewrite eder.
