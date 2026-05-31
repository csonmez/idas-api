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
- `Kysely<DB>` instance olusturma.
- App runtime icin `db` singleton export etme.
- Graceful shutdown ve test cleanup icin `closeDb` export etme.
- Testlerde veya farkli runtime'larda kullanmak icin `createDb` factory export etme.

Onerilen skeleton:

```ts
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { DB } from './db.generated.ts'

export const createDb = (connectionString: string) => {
	return new Kysely<DB>({
		dialect: new PostgresDialect({
			pool: new Pool({ connectionString })
		})
	})
}

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
	throw new Error('DATABASE_URL is required')
}

export const db = createDb(connectionString)

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
- Sadece tip ihtiyaci olan kodlar `DB` tipini import etmeli; gereksiz yere `db` import edilmemeli.
- Testlerde app singleton yerine `createDb(testDatabaseUrl)` kullanmak daha kontrollu olur.

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
4. `src/database/client.ts` eklenecek.
5. `src/database/index.ts` barrel olarak eklenecek.
6. App bootstrap tarafinda `db` kullanilacak.
7. Server shutdown flow'una `closeDb()` eklenecek.

## Best Practices

- Generated dosya manuel degistirilmeyecek.
- Connection logic tek yerde tutulacak.
- Feature/service dosyalari kendi `Pool` veya `Kysely` instance'larini olusturmayacak.
- DB lifecycle app bootstrap/shutdown tarafindan yonetilecek.
- Testlerde singleton yerine factory tercih edilecek.
- `DATABASE_URL` eksikse uygulama erken ve acik hata ile fail edecek.
- Migration ve codegen birbirinden ayri tutulacak; codegen sadece basarili schema degisikliklerinden sonra calistirilacak.
- Source code icinde relative local import/export path'leri extensionless yazilmayacak; `.ts` extension yazilacak.
- Build output'ta Node ESM uyumu TypeScript'in `rewriteRelativeImportExtensions` rewrite'i ile saglanacak.
- Extensionless import istenirse native `tsc -> node dist` akisi yerine bundler, loader veya post-build rewrite araci gerekir; bu proje icin varsayilan tercih degil.

## Open Decisions

- Test database icin ayri `TEST_DATABASE_URL` kullanilip kullanilmayacagi.
- Path alias (`@/database`) eklenip eklenmeyecegi.
- App shutdown sinyallerinin (`SIGINT`, `SIGTERM`) hangi bootstrap dosyasinda ele alinacagi.

## References

- Node.js ESM dokumantasyonu relative ve absolute import specifier'larinda file extension'in zorunlu oldugunu belirtir.
- TypeScript module reference extensionless relative import path'lerin Node.js import path'lerinde desteklenmedigini belirtir.
- TypeScript 5.7 ile gelen `rewriteRelativeImportExtensions`, relative `.ts`, `.tsx`, `.mts`, `.cts` import/export path'lerini output'ta JavaScript extension'ina rewrite eder.
