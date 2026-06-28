# Authorization Foundation Implementation Task

## Görev

Yalnızca roadmap'in üçüncü adımı olan Authorization Foundation fazını uygula.

Bu görev production kodunda sadece Authorization Foundation fazinin gerektirdigi degisiklikleri yapmalidir. Users module, admin role management, role/permission CRUD, domain-specific endpointler, academic organization module tam kurulumu, soft-delete fazi, cache, Redis authorization cache veya sonraki roadmap fazlarina baslama.

## Okunacak Kaynaklar

- `AGENTS.md`, varsa.
- `.wrongstack/AGENTS.md`, proje icinde mevcut oldugu icin kontrol et.
- `docs/7_ARCHITECTURE_IMPROVEMENT_PLAN.md`.
- `docs/braid/architecture/00-roadmap.md`.
- Error Contract BRAID dokumanlari:
  - `docs/braid/architecture/01-error-contract/01-plan.md`
  - `docs/braid/architecture/01-error-contract/02-error-flow.md`
  - `docs/braid/architecture/01-error-contract/03-test-matrix.md`
  - `docs/braid/architecture/01-error-contract/04-composer-task.md`
- Request Validation BRAID dokumanlari:
  - `docs/braid/architecture/02-request-validation/01-plan.md`
  - `docs/braid/architecture/02-request-validation/02-validation-flow.md`
  - `docs/braid/architecture/02-request-validation/03-test-matrix.md`
  - `docs/braid/architecture/02-request-validation/04-composer-task.md`
- Authorization klasorundeki plan, flow, sequence ve test matrisi:
  - `docs/braid/architecture/03-authorization/01-plan.md`
  - `docs/braid/architecture/03-authorization/02-scope-policy-flow.md`
  - `docs/braid/architecture/03-authorization/03-authorization-sequence.md`
  - `docs/braid/architecture/03-authorization/04-test-matrix.md`
- Guncel auth/session kodu:
  - `src/auth/session.ts`
  - `src/auth/passport.ts`
  - `src/auth/csrf.ts`
  - `src/app.ts`
  - `src/routes/index.ts`
- Gercek DB schema ve generated Kysely types:
  - `src/database/db.generated.ts`
  - `.config/migrations/1780863112571_create_role_permissions_table.ts`
  - `.config/migrations/1780863087643_create_academic_units_table.ts`
  - `.config/migrations/1780863094704_create_departments_table.ts`
  - `.config/migrations/1780863099779_create_disciplines_table.ts`
  - `.config/migrations/1780863106497_create_user_academic_affiliations_table.ts`
- Mevcut testler:
  - `src/app.test.ts`
  - `src/request-validation.test.ts`
- `package.json`.

## Kodlamadan Önce

Composer sunlari raporlasin:

1. Mevcut auth/session yapisi.
2. Gercek role/permission schema'si.
3. Olusturacagi ve degistirecegi dosyalar.
4. Middleware/service/policy/repository sorumluluklari.
5. Parent scope resolution yaklasimi.
6. Yazacagi testler.
7. Schema ile plan arasindaki celiskiler.

Kodlamadan once ozellikle su gercekleri raporla:

- Ayri `roles`, `permissions` veya `user_roles` tablosu yoktur.
- Kysely generated tablo adi `rolePermissions`, kolonlar `userId`, `permissions`, `scopeType`, `academicUnitId`, `departmentId`, `disciplineId`, `startDate`, `endDate`, `deletedAt` seklindedir.
- `departments.academicUnitId`, `disciplines.departmentId` ve `disciplines.academicUnitId` parent scope resolution icin kullanilir.
- Session payload minimum user id tasir; role/permission snapshot'i session'a yazilmamalidir.

## Implementasyon Kuralları

- Yalnizca Authorization Foundation fazini uygula.
- `src/modules/authorization/` altinda gerekli dosyalari olustur.
- `requireAuth`, `requirePermission`, `requireScopedPermission` middleware'lerini olustur.
- Authorization service, repository, policy ve types sorumluluklarini ayir.
- Policy saf ve DB bagimsiz olsun.
- Kysely sadece repository/data-access katmaninda kullanilsin.
- Parent scope id'leri repository uzerinden cozulmeli.
- Permission stringleri exact match ile degerlendirilmeli.
- Permission string contract'i `resource:action`; resource/action lower-kebab-case.
- Aktif grant'ler union olarak degerlendirilmeli.
- Deny veya negative permission ekleme.
- Permission cache veya Redis authorization cache ekleme.
- Role adina gore hardcoded authorization yapma.
- Route handler icine daginik role kontrolu ekleme.
- Butun production route'lari topluca authorization middleware'e gecirme.
- Users modulu, admin endpointleri veya role management CRUD yazma.
- Academic organization domain modulunu tamamlamaya baslama.
- Ilgisiz schema migration yapma.
- Yeni dependency ekleme.
- Error Contract'i bypass etme.
- Middleware dogrudan custom JSON error yazmasin; `AppError` ve merkezi `errorHandler` akisini kullansin.
- Session/user yoksa 401 `UNAUTHENTICATED`.
- Auth var ama grant yoksa 403 `FORBIDDEN`.
- Internal DB details client'a sizmasin.
- Request Validation ile validate edilmemis route param'ina guvenme; test route'larda params gerekiyorsa helper veya controlled fixture kullan.

## Scope Inheritance Kuralları

Kesin scope turleri:

- `GLOBAL`
- `ACADEMIC_UNIT`
- `DEPARTMENT`
- `DISCIPLINE`

Kesin inheritance:

- `GLOBAL` grant tum hedeflerde gecerlidir.
- `ACADEMIC_UNIT` grant ayni ust akademik birim ile onun altindaki department ve discipline hedeflerinde gecerlidir.
- `DEPARTMENT` grant ayni department ile onun altindaki discipline hedeflerinde gecerlidir.
- `DISCIPLINE` grant yalnizca ayni discipline hedefinde gecerlidir.

Effective grant matrisi:

- `ACADEMIC_UNIT` hedefi: `GLOBAL`, ayni `ACADEMIC_UNIT`.
- `DEPARTMENT` hedefi: `GLOBAL`, parent `ACADEMIC_UNIT`, ayni `DEPARTMENT`.
- `DISCIPLINE` hedefi: `GLOBAL`, parent `ACADEMIC_UNIT`, parent `DEPARTMENT`, ayni `DISCIPLINE`.

Bu kararlari degistirme veya yeniden yorumlama.

## Permission Lookup Kuralları

- Aktif grant sorgusu `rolePermissions` tablosundan yapilir.
- `deletedAt is null`.
- `startDate is null or startDate <= now`.
- `endDate is null or endDate >= now`.
- `permissions` array'i exact string match ile kontrol edilir.
- Birden fazla aktif grant satiri union olarak degerlendirilir.
- Duplicate grant sonucu degistirmez.
- Global ve scoped grant ayrimi `scopeType` ve ilgili id kolonlarindan okunur.

## Target Resolution Kuralları

- `ACADEMIC_UNIT`: aktif `academicUnits` kaydi okunur; target id `academicUnitId` olur.
- `DEPARTMENT`: aktif `departments` kaydi okunur; parent `academicUnitId` `departments.academicUnitId` kolonundan gelir.
- `DISCIPLINE`: aktif `disciplines` kaydi okunur; parent `departmentId` ve `academicUnitId` `disciplines` tablosundan gelir.
- Soft-deleted academic organization target'lari aktif target olarak kabul edilmemelidir.
- Target bulunamazsa `FORBIDDEN` mi `NOT_FOUND` mi donulecegi kaynaklarda kesin degildir; implementasyon oncesi raporla ve dar kapsamli karar ver.

## Test Kuralları

- Policy icin saf unit test yaz.
- Middleware/service icin kucuk Express app veya fake repository fixture ile integration test yaz.
- Production router'a test-only route ekleme.
- Handler'in deny durumunda calismadigini sentinel ile dogrula.
- Nested Error Contract response'unu dogrula.
- En az su senaryolari kapsa:
  - Session yok.
  - Kullanici var, permission yok.
  - Global permission basarili.
  - Yanlis permission string.
  - `GLOBAL` grant scoped target'larda basarili.
  - `ACADEMIC_UNIT` same unit, child department, child discipline allow.
  - `ACADEMIC_UNIT` baska unit deny.
  - `DEPARTMENT` same department ve child discipline allow.
  - `DEPARTMENT` sibling department deny.
  - `DISCIPLINE` same discipline allow, baska discipline deny.
  - Birden fazla rol union.
  - Soft-deleted grant.
  - Future `startDate`.
  - Expired `endDate`.
  - Boundary date.
  - Duplicate grant.
  - Repository error internal detail sizdirmeme.

## Doğrulama

`package.json` icindeki gercek scriptleri kontrol et ve uygun komutlari calistir.

En az:

```bash
npm run typecheck
npm test
```

Biome icin `npm run check`, bu projede `biome check --write .` calistirir. Gerekirse once yazmayan kontrol komutu kullan:

```bash
npx biome check <degistirilen-dosyalar>
git diff --check
```

`npm run check` calistirilirsa dosya yazabilecegini sonuc raporunda acikca belirt ve sonrasinda diff'i kontrol et.

## Sonuç Raporu

Composer sunlari raporlasin:

1. Eklenen dosyalar.
2. Degistirilen dosyalar.
3. Middleware/service/policy/repository sozlesmeleri.
4. Error Contract entegrasyonu.
5. Request Validation ve route params entegrasyonu.
6. Parent scope resolution davranisi.
7. Eklenen testler.
8. Acceptance criterion -> test eslesmesi.
9. Calistirilan komutlar ve sonuclari.
10. Scope disi degisiklikler.
11. Kalan acik sorular.

## Scope Kontrol Listesi

- Authorization disinda production davranisi degistirilmedi.
- Users veya sonraki roadmap fazlarina baslanmadi.
- Role/permission CRUD endpointi yazilmadi.
- Domain route'lari topluca degistirilmedi.
- Error Contract bypass edilmedi.
- 401 ve 403 ayrimi korundu.
- Policy saf karar mantigi tasiyor.
- Kysely repository katmaninda kaldi.
- Parent scope inheritance kesin matrise gore uygulandi.
- Soft-deleted ve tarih disi grant'ler dikkate alinmadi.
- Session'a role/permission snapshot'i eklenmedi.
- Yeni dependency eklenmedi.
- Typecheck, test ve ilgili Biome kontrolleri raporlandi.
