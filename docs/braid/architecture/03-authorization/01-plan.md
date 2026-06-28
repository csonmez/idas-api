# Authorization Architecture Plan

## Amaç

Authorization Architecture fazinin amaci, endpoint sayisi artmadan once authentication ile authorization sorumluluklarini ayirmak ve permission kararlarini merkezi, scope-aware ve test edilebilir bir katmana tasimaktir.

Mevcut projede Express pipeline, Passport session, nested Error Contract ve Zod tabanli Request Validation altyapisi hazirdir. Buna ragmen permission karari verecek `requireAuth`, `requirePermission` veya `requireScopedPermission` middleware'i yoktur. Bu faz, route handler icinde daginik role kontrolu yapilmamasini, kararlarin role adina hardcode edilmemesini ve akademik scope inheritance kurallarinin tek policy noktasinda uygulanmasini hedefler.

## Önceki Fazlara Bağımlılıklar

Error Contract entegrasyonu:

- Authorization middleware dogrudan custom JSON error yazmamalidir.
- Session/user yoksa `new AppError('UNAUTHENTICATED', ...)` uzerinden HTTP 401 donmelidir.
- Kullanici var ama gerekli grant yoksa `new AppError('FORBIDDEN', ...)` uzerinden HTTP 403 donmelidir.
- Bilinmeyen DB veya altyapi hatalari merkezi `errorHandler` akisina birakilmali; SQL, Redis veya internal detay client'a sizmamalidir.
- Response shape tamamlanmis nested contract olmalidir: `{ "error": { "code", "message", "details" } }`.

Request Validation entegrasyonu:

- Route params, query veya body uzerinden target id okunacaksa once `validateParams`, `validateQuery` veya `validateBody` ile canonical request degeri uretilmelidir.
- `requireScopedPermission` icindeki `resolveTargetId` dogrulanmamis raw input'a guvenmemelidir.
- Validation hatasi authorization'a gelmeden `VALIDATION_ERROR` 400 olarak donmelidir.

Session/authentication altyapisi:

- `src/auth/session.ts` Redis backed `express-session` middleware'ini kurar. SessionData su anda yalnizca `csrfToken?: string` ile augment edilmis durumdadir.
- `src/auth/passport.ts` `serializeUser` asamasinda session payload'a minimum user id yazar.
- `deserializeUser` `users` tablosundan `id` ve `status` okur; kullanici bulunamazsa veya `status === 'INACTIVE'` ise `false` doner.
- `src/app.ts` `/api` altinda session, `passport.initialize()`, `passport.session()`, CSRF ve router siralamasini kurar.
- Authorization fazi session payload'inda sadece user id bulunmasini yeterli kabul etmeli; role/permission snapshot'ini session'a koymamalidir.

## Mevcut Durum

Kod ve altyapi:

- `src/app.ts`: `/api` middleware zincirinde rate limit, body parser, session, Passport, CSRF ve `createRoutes` bulunur.
- `src/auth/session.ts`: session store Redis'tir; session cookie config'i env uzerinden gelir; SessionData icinde auth user payload tanimi yoktur.
- `src/auth/passport.ts`: Passport session user id serialize eder; deserialize edilen `req.user` pratikte `{ id, status }` seklindedir.
- `src/routes/index.ts`: sadece `GET /api/csrf-token` endpointi vardir; auth zorunlu endpoint yoktur.
- `src/http/errors.ts`: `AppErrorCode` icinde `UNAUTHENTICATED` 401 ve `FORBIDDEN` 403 vardir.
- `src/http/request-validation.ts`: `validateBody`, `validateQuery`, `validateParams` helper'lari vardir; route params authorization oncesi canonical hale getirilebilir.
- Mevcut test framework'u `node:test`, `node:assert/strict`, `supertest` ve `tsx --test src/**/*.test.ts` komutudur.
- Mevcut auth test fixture'i yoktur; `src/app.test.ts` icinde session ve CSRF app-level testleri, `src/request-validation.test.ts` icinde kucuk Express app fixture pattern'i vardir.

Gercek schema ve generated Kysely tipleri:

- Generated DB tipi `src/database/db.generated.ts` icinde `DB` tablolari camelCase adlarla gelir: `users`, `rolePermissions`, `academicUnits`, `departments`, `disciplines`, `userAcademicAffiliations`.
- Ayrica `roles`, `permissions`, `role_permissions` gibi ayri role/permission lookup tablolari yoktur. Gercek veri modeli, `role_permissions` tablosunun generated karsiligi olan `rolePermissions` uzerindedir.
- `RolePermission` tipi kolonlari: `userId`, `role`, `permissions: string[]`, `scopeType`, `academicUnitId`, `departmentId`, `disciplineId`, `startDate`, `endDate`, `deletedAt`.
- `RoleScopeType` generated tipi kesin scope degerlerini tasir: `GLOBAL`, `ACADEMIC_UNIT`, `DEPARTMENT`, `DISCIPLINE`.
- Migration `.config/migrations/1780863112571_create_role_permissions_table.ts` `permissions text[]`, `scope_type role_scope_type`, `start_date`, `end_date`, `deleted_at` ve scope consistency check constraint'lerini tanimlar.
- `role_permissions` user lookup icin `role_permissions_user_id_idx`, scope kolonlari icin `academic_unit_id`, `department_id`, `discipline_id` index'leri ve active unique partial index'leri vardir.
- `academic_units` generated tipi `AcademicUnit`; aktif kayit convention'i `deletedAt is null` olmalidir.
- `departments.academicUnitId` parent academic unit'i dogrudan verir.
- `disciplines.departmentId` ve `disciplines.academicUnitId` parent chain'i dogrudan verir; migration composite FK ile department ve academic unit tutarliligini zorlar.

Mevcut kod ile plan arasindaki celişkiler:

- Kaynak istek `roles`, `permissions`, `role_permissions` tablolarini arastirmayi ister; mevcut schema'da ayri `roles` veya `permissions` tablolari yoktur.
- Kullanici-role iliskisi ayri `user_roles` tablosu degildir; `role_permissions.user_id + role + scope + permissions[]` satirlari ile modellenmistir.
- Kaynak plan `role_permissions` snake_case tablo adini kullanir; Kysely kodunda generated ad `rolePermissions` olmalidir.
- Mevcut `req.user` tipi proje icinde augment edilmemistir; TypeScript imzasi onerilirken Express/Passport typing ile uyum typecheck edilmelidir.

## Hedef Mimari

Hedef dosya yapisi:

```text
src/modules/authorization/
  authorization.middleware.ts
  authorization.service.ts
  authorization.policy.ts
  authorization.repository.ts
  authorization.types.ts
```

`authorization.middleware.ts`:

- Express middleware factory'lerini tasir: `requireAuth`, `requirePermission`, `requireScopedPermission`.
- Session/Passport kullanici bilgisini okur.
- Request'ten permission ve target bilgisi cozer.
- Service'i cagirir.
- Allow durumunda `next()` ile devam eder; deny durumunda `AppError` uretir.

`authorization.service.ts`:

- Authorization workflow orchestration katmanidir.
- Kullanici id ile aktif grant'leri repository'den alir.
- Scoped kontrolde target scope parent id'lerini repository uzerinden cozer.
- Saf policy fonksiyonunu cagirir ve boolean/decision sonucu uretir.
- Repository hata detaylarini client'a sizdirmaz; bilinmeyen hatalari merkezi error middleware'e birakir.

`authorization.policy.ts`:

- DB bilmeyen saf karar mantigini tasir.
- Permission union, exact permission string match ve effective grant matrisini uygular.
- Scope inheritance kesin kararlarini degistirmez.
- Deny veya negative permission desteklemez.

`authorization.repository.ts`:

- Kaynak plandaki ilk module listesinde acikca yoktur, ancak gercek sorgu ihtiyaci nedeniyle eklenmesi onerilir.
- Gerekce: Kysely yalnizca data-access katmaninda kalmali; service/policy DB query detaylarini bilmemelidir.
- Aktif `rolePermissions` satirlarini, tarih filtrelerini ve parent organization lookup'larini burada toplamak N+1 ve soft-delete unutma riskini azaltir.

`authorization.types.ts`:

- `ScopeType`, `Permission`, `AuthorizationGrant`, `TargetScope`, `ResolvedScopePath`, middleware option tipleri ve policy decision tiplerini tanimlar.
- Generated `RoleScopeType` ile uyumlu olmalidir; ikinci bir farkli enum uydurulmamalidir.

## Temel Primitive'ler

```ts
requireAuth()
requirePermission(permission)
requireScopedPermission(options)
```

`requireAuth()` sozlesmesi:

- Request authenticated degilse 401 `UNAUTHENTICATED`.
- Request authenticated ise zinciri devam ettirir.
- Session payload veya `req.user` icindeki minimum user id'yi guvenli bicimde cozer.
- `INACTIVE` user Passport deserialize asamasinda zaten `false` olur; yine de middleware `req.isAuthenticated()` ve user id yoklugunu kontrol etmelidir.

`requirePermission(permission)` sozlesmesi:

- Once authentication gerektirir.
- `permission` string exact match ile aranir.
- Permission string formati `resource:action`; iki parca da lower-kebab-case olmalidir.
- Scope gerektirmeyen global endpointler icin kullanilir.
- Global permission kontrolunde target scope yoktur; en az bir aktif grant'in `permissions` array'i exact permission icermelidir. Bu noktada `scopeType` ayrimi uygulanacaksa kaynaklarda net degildir; onerilen dar davranis, scope gerektirmeyen endpointlerde herhangi bir aktif grant'teki permission union'ini kabul etmektir. Endpoint gercekten global-only ise `requireScopedPermission` veya ileride explicit option ile netlestirilmelidir.

`requireScopedPermission(options)` icin kavramlar:

- `permission`: `resource:action` formatinda exact permission.
- `targetScopeType`: hedef resource scope'u; `GLOBAL` hedef gerekirse ayrica degerlendirilir, ilk kesin matrix `ACADEMIC_UNIT`, `DEPARTMENT`, `DISCIPLINE` hedeflerini kapsar.
- `resolveTargetId`: Request'ten canonical target id cozen fonksiyon; Request Validation'dan sonra calismalidir.
- `exactScopeOnly`: Ilk implementasyonda zorunlu degildir. Ileride explicit true olursa inheritance yerine yalnizca ayni scope grant kabul edilebilir.

Mevcut Express typing yaklasimi sade `RequestHandler` oldugu icin ilk imza onerisi:

```ts
type RequireScopedPermissionOptions = {
  permission: string
  targetScopeType: 'ACADEMIC_UNIT' | 'DEPARTMENT' | 'DISCIPLINE'
  resolveTargetId: (req: Request) => string
  exactScopeOnly?: boolean
}
```

Bu imza implementasyon oncesi `@types/express` 5.0.6, Passport typing ve mevcut `RequestHandler` pattern'iyle typecheck edilmelidir.

## Sorumluluk Dağılımı

### Middleware

- Authentication kontrolu yapar.
- `req.isAuthenticated()` ve guvenli user id varligini kontrol eder.
- Request'ten permission ve target bilgisini cozer.
- Route params gerekiyorsa validated/canonical `req.params` uzerinden okur.
- Authorization Service'i cagirir.
- Allow ise request zincirini devam ettirir.
- Session/user yoksa `UNAUTHENTICATED` uretir.
- Kullanici var ama grant yoksa `FORBIDDEN` uretir.
- Dogrudan custom JSON error yazmaz.

### Authorization Service

- Kullanicinin aktif grant'lerini repository'den alir.
- Permission lookup icin `rolePermissions.permissions` array'ini union olarak degerlendirir.
- Scoped kontrolde target parent scope id'lerini repository uzerinden cozer.
- Policy degerlendirmesini cagirir.
- Workflow orchestration yapar; DB query detaylari veya Express `Response` bilmez.
- Target bulunamama davranisini handler/service `NOT_FOUND` mi yoksa authorization `FORBIDDEN` mi uretmeli sorusunu kaynaklara gore raporlar.

### Policy

- Saf ve mumkun oldugunca DB bagimsiz karar mantigi tasir.
- Effective grant matrisini uygular.
- Scope inheritance kararlarini kaynak kararlarla birebir uygular.
- Aktif grant'lerin permission union davranisini uygular.
- Permission string exact match yapar.
- Deny veya negative permission desteklemez.

### Repository

- Aktif role/permission kayitlarini sorgular.
- `deletedAt is null` filtresini uygular.
- `startDate is null or startDate <= now` filtresini uygular.
- `endDate is null or endDate >= now` filtresini uygular.
- Parent academic organization id'lerini cozer.
- `academicUnits`, `departments`, `disciplines` soft-deleted kayitlarini target resolution sirasinda dislamalidir.
- Kysely kullanimi bu dosyayla sinirli kalmalidir.

## Permission Lookup Kuralları

- Aktif kullanici rolleri, mevcut schema'da ayri `roles` veya `user_roles` tablosundan degil, aktif `rolePermissions` satirlarindan okunur.
- Aktif permission kaydi: `rolePermissions.userId = userId`, `deletedAt is null`, `startDate is null or startDate <= now`, `endDate is null or endDate >= now`.
- `permissions` array'i icinde exact string match yapilir; wildcard, prefix veya fuzzy match yoktur.
- Permission string formati `resource:action` olmalidir.
- `resource` ve `action` lower-kebab-case olmalidir.
- Birden fazla role/grant satirinin permission'lari union olarak degerlendirilir.
- Duplicate grant veya duplicate permission sonucu degistirmez.
- Global ve scoped grant ayrimi `scopeType` ve ilgili id kolonlariyla yapilir.
- Soft-deleted veya tarih disi kayitlar policy'ye ulasmadan repository seviyesinde dislanmalidir.

## Scope Resolution

`ACADEMIC_UNIT` hedefi:

- Target id `academicUnits.id` olarak cozulur.
- Repository aktif `academicUnits` kaydini `deletedAt is null` ile dogrular.
- Resolved path: `{ academicUnitId: targetId }`.
- Effective grant'ler: `GLOBAL`, ayni `ACADEMIC_UNIT`.

`DEPARTMENT` hedefi:

- Target id `departments.id` olarak cozulur.
- Repository aktif `departments` kaydini `deletedAt is null` ile okur.
- Parent `academicUnitId` `departments.academicUnitId` kolonundan gelir.
- Resolved path: `{ academicUnitId, departmentId: targetId }`.
- Effective grant'ler: `GLOBAL`, parent `ACADEMIC_UNIT`, ayni `DEPARTMENT`.

`DISCIPLINE` hedefi:

- Target id `disciplines.id` olarak cozulur.
- Repository aktif `disciplines` kaydini `deletedAt is null` ile okur.
- Parent `departmentId` ve `academicUnitId` `disciplines` tablosundan dogrudan gelir.
- Resolved path: `{ academicUnitId, departmentId, disciplineId: targetId }`.
- Effective grant'ler: `GLOBAL`, parent `ACADEMIC_UNIT`, parent `DEPARTMENT`, ayni `DISCIPLINE`.

Target bulunamazsa:

- Kaynaklarda kesin karar yoktur.
- Guvenlik acisindan authorization middleware'in target yoklugunda resource varligini sizdirip sizdirmeyecegi endpoint bazinda tasarlanmalidir.
- Onerilen ilk davranis: `requireScopedPermission` target parent cozumunu yapamadiginda `FORBIDDEN` donsun ve domain handler calismasin; resource detail endpointlerinde canonical `NOT_FOUND` ihtiyaci varsa handler/service seviyesinde ayrica ele alinsin. Bu karar implementation oncesi raporlanmalidir.

## Error Davranışı

- Session/user yok: 401 `UNAUTHENTICATED`.
- Kullanici var ama grant yok: 403 `FORBIDDEN`.
- Gecerli grant: request devam eder.
- Bilinmeyen altyapi hatasi: merkezi Error Contract.
- Internal DB details client'a sizmaz.
- Middleware dogrudan custom JSON error yazmaz.
- 401 ve 403 birbirine karistirilmaz.

## Scope

Bu fazda yapilacaklar:

- Authorization types.
- Saf policy degerlendirmesi.
- Authorization repository/service temeli.
- `requireAuth`.
- `requirePermission`.
- `requireScopedPermission`.
- Scope inheritance.
- Permission validity date kontrolleri.
- Unit ve integration testleri.

## Scope Dışı

Bu fazda yapilmayacaklar:

- Users modulu.
- Admin role management endpointleri.
- Role/permission CRUD endpointleri.
- Deny veya negative permission.
- Permission cache.
- Redis authorization cache.
- Frontend authorization.
- Exact-scope-only davranisinin zorunlu implementasyonu.
- Domain-specific target approval endpointleri.
- Butun route'lara authorization middleware eklenmesi.
- Academic organization domain modulunun tamamlanmasi.
- Ilgisiz schema migration.
- Yeni dependency.

## Değişmez Kurallar

- Route handler icinde daginik role kontrolu yapilmaz.
- Permission karari role adina gore hardcode edilmez.
- Permission stringleri `resource:action` formatinda degerlendirilir.
- Policy saf karar mantigi tasir.
- Kysely yalnizca repository/data-access katmaninda kullanilir.
- Parent scope inheritance kesin matrise gore uygulanir.
- Deny permission yoktur.
- Aktif grant'ler union olarak degerlendirilir.
- Authentication ile authorization birbirinden ayrilir.
- 401 ve 403 birbirine karistirilmaz.
- Middleware dogrudan custom JSON error yazmaz.
- Merkezi AppError/Error Contract kullanilir.
- Silinmis veya tarih disi permission kayitlari dikkate alinmaz.
- Domain route'lari bu fazda topluca degistirilmez.

## Acceptance Criteria

1. Auth olmayan request 401 `UNAUTHENTICATED` dondurur.
2. Auth olan ama permission bulunmayan request 403 `FORBIDDEN` dondurur.
3. Global permission scope gerektirmeyen endpointte calisir.
4. GLOBAL grant butun scoped target'larda gecerlidir.
5. ACADEMIC_UNIT grant ayni unit ve alt department/discipline icin gecerlidir.
6. ACADEMIC_UNIT grant baska unit hedefinde gecerli degildir.
7. DEPARTMENT grant ayni department ve alt discipline icin gecerlidir.
8. DEPARTMENT grant baska department icin gecerli degildir.
9. DISCIPLINE grant yalnizca ayni discipline icin gecerlidir.
10. Birden fazla rolun permission'lari union olarak degerlendirilir.
11. Soft-deleted grant dikkate alinmaz.
12. Henuz baslamamis grant dikkate alinmaz.
13. Suresi bitmis grant dikkate alinmaz.
14. Permission string exact match kullanir.
15. Parent scope cozumu repository uzerinden yapilir.
16. Error responses nested contract kullanir.
17. Internal DB details client'a sizmaz.
18. Typecheck, test ve ilgili Biome kontrolleri temizdir.

## Riskler

- Yanlis parent scope cozumu cross-unit authorization acigi yaratabilir.
- `disciplines.academicUnitId` ile `department.academicUnitId` tutarliligina migration guveniyor; repository yine aktif kayit ve parent path'i net okumali.
- 401/403 ayrimi bozulursa credential/session durumu hakkinda yanlis sinyal uretilebilir.
- Session payload'a fazla guvenmek stale permission verisi yaratir.
- Permission cache bu fazda yoktur; her kontrolde DB guncel kaynak kabul edilir.
- Tarih ve timezone karsilastirmalari `timestamptz` ve DB `now()` veya injected clock karariyla tutarli olmali.
- Duplicate grant'ler veya birden fazla rol union davranisini degistirmemeli.
- Policy ile repository sorumluluklari karisirsa test edilebilirlik azalir.
- Her middleware icin parent ve grant query'leri ayri ayri yapilirsa N+1 riski dogar.
- Route param target id dogrulanmadan kullanilirsa authorization bypass veya 500 riski dogar.
- Target bulunamadiginda 403/404 davranisi bilgi sizmasina neden olabilir.

## Açık Sorular ve Çelişkiler

- Mevcut schema'da ayri `roles`, `permissions` veya `user_roles` tablolari yoktur; kaynak istekteki bu tablo arastirmasi mevcut modelde `rolePermissions.permissions[]` olarak karsilik bulur.
- `requirePermission(permission)` scope gerektirmeyen endpointte herhangi bir aktif scoped grant'i kabul etmeli mi, yoksa yalnizca `GLOBAL` grant mi kabul etmeli? Kaynaklar bunu net ayirmiyor.
- Target bulunamadiginda middleware `FORBIDDEN` mi dondurmeli, yoksa handler/service `NOT_FOUND` uretmeli mi? Kaynaklar kesin karar vermiyor.
- `req.user` icin global Express/Passport type augmentation yapilip yapilmayacagi kaynaklarda net degildir; mevcut proje sade Express tipleri kullanir.
- `exactScopeOnly` ileride explicit opsiyon olarak eklenebilir; ilk implementasyonda zorunlu degildir.
