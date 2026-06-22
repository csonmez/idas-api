# Architecture Improvement Plan

## Summary

Bu dokuman, mevcut `idas-api` mimarisinin incelenmesi sonucunda belirlenen iyilestirme alanlarini ve uygulanmasi gereken adimlari siralar.

Mevcut durum:

- Express 5 + TypeScript strict tabanli API iskeleti kurulmus durumda.
- `server.ts` / `app.ts` ayrimi, env validation, DB/Redis lifecycle, logging, healthcheck ve temel guvenlik middleware'leri mevcut.
- Kysely + PostgreSQL tipi uretilmis schema kullaniliyor.
- Redis session ve rate limit altyapisi var.
- Test, typecheck ve lint mevcut durumda temiz.

Ana eksik, altyapi kabugunun uzerine oturacak domain/application mimarisinin henuz netlesmemis olmasidir. Bu planin hedefi, endpointler hizla cogalmadan once API contract, modul sinirlari, authorization modeli ve repository/service yapisini standartlastirmaktir.

## Goals

- API response/error contract'ini standart hale getirmek.
- Domain modullerinin dosya ve sorumluluk yapisini belirlemek.
- Authorization/policy katmanini `role_permissions` modeliyle uyumlu tasarlamak.
- Soft delete, validation ve repository kullanimini standartlastirmak.
- Production'a hazirlik icin config, observability ve deployment eksiklerini siralamak.

## Non-Goals

- Bu dokuman tek tek tum endpointleri tasarlamaz.
- Tum domain tablolarinin final schema'sini belirlemez.
- UI/frontend davranisini tarif etmez.
- Buyuk bir DDD rewrite onermez; amac sade ama buyuyebilir bir uygulama katmani kurmaktir.

## Current Architecture Snapshot

```text
src/
  app.ts              Express middleware pipeline
  server.ts           runtime bootstrap, DB/Redis connect, shutdown
  config/env.ts       env validation
  database/           Kysely DB factory + generated DB types
  redis/              Redis client factory
  auth/               session, csrf, passport bootstrap
  security/           cors, helmet, rate-limit
  logger/             pino + pino-http
  middlewares/        request-id, error, not-found
  routes/             current API route entrypoint
```

Guculu taraflar:

- Runtime bootstrap ile Express app kurulumu ayrilmis durumda.
- Dependency injection pattern'i `createApp(deps)` ile baslamis.
- DB client top-level singleton degil; factory ile uretiliyor.
- Env okuma `config/env.ts` altinda merkezilesmis.
- Healthcheck, graceful shutdown, structured logging ve temel guvenlik middleware'leri mevcut.
- Testler mevcut altyapi davranisini kapsiyor.

Zayif/eksik taraflar:

- API error response sekli standart nested contract degil.
- Domain/application/service/repository katmani henuz yok.
- Authorization policy modeli uygulama kodunda henuz kurulmamış.
- Soft delete query standardi yok.
- Request validation standardi henuz sadece env validation seviyesinde.
- Production CORS/config/deployment/observability kararlari eksik.

## Target Layering

Endpoint sayisi artmadan once hedef katmanlama su sekilde olmalidir:

```text
HTTP Layer
  routes/controllers
  - Express route binding
  - request param/body/query parse
  - response mapping

Application Layer
  services/use-cases
  - transaction orchestration
  - business workflow
  - authorization intent checks

Domain/Policy Layer
  policies/invariants
  - role/scope permission decisions
  - domain rule validation

Data Access Layer
  repositories
  - Kysely queries
  - soft delete filtering
  - persistence mapping

Infrastructure Layer
  db, redis, logger, config
```

Ilk fazda agir DDD uygulanmayacak. Ancak route dosyalarinin dogrudan DB query ve is kurali tasimasi engellenecek.

## Proposed Module Structure

Yeni domain kodlari icin onerilen yapi:

```text
src/modules/
  users/
    users.routes.ts
    users.handlers.ts
    users.service.ts
    users.repository.ts
    users.schemas.ts
    users.types.ts

  academic-organization/
    academic-organization.routes.ts
    academic-organization.handlers.ts
    academic-organization.service.ts
    academic-organization.repository.ts
    academic-organization.schemas.ts
    academic-organization.types.ts

  auth/
    auth.routes.ts
    auth.handlers.ts
    auth.service.ts
    auth.repository.ts
    auth.schemas.ts
    auth.types.ts

  authorization/
    authorization.middleware.ts
    authorization.service.ts
    authorization.policy.ts
    authorization.types.ts
```

Notlar:

- `routes/` klasoru top-level API router composition icin kalabilir.
- Domain route'lari `src/modules/*/*.routes.ts` altinda tutulabilir.
- Her modul kendi Zod schema'larini ve public tiplerini tasir.
- Repository katmani Kysely detaylarini saklar.
- Service katmani repository ve policy katmanini kullanir.

## Phase 1: API Contract Standardization

### 1.1 Standard error response shape

Mevcut hata formati:

```json
{
  "error": "NOT_FOUND",
  "message": "Not found",
  "details": {}
}
```

Hedef format:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Not found",
    "details": {}
  }
}
```

Yapilacaklar:

1. `src/http/errors.ts` veya `src/http/responses.ts` olustur.
2. `sendError(res, status, code, message, details?)` helper'i ekle.
3. `error.middleware.ts`, `not-found.middleware.ts`, `csrf.ts`, `rate-limit.ts` bu helper'i kullansin.
4. Testlerde response shape yeni contract'a gore guncellensin.

Acceptance criteria:

- Tum hata cevaplari `{ error: { code, message, details } }` seklinde doner.
- 400, 403, 404, 413, 429, 500 durumlari test edilir.
- Client'a 500 stack trace veya internal detail sizmaz.

### 1.2 Success response convention

Ilk fazda zorunlu wrapper gerekmez. Kaynak endpointleri dogrudan resource dondurebilir.

Liste endpointleri icin ileride standart:

```ts
type PaginatedResponse<T> = {
  data: T[]
  nextCursor: string | null
  hasMore: boolean
}
```

Offset pagination kullanilmamalidir; buyuk listelerde cursor-based pagination tercih edilmelidir.

## Phase 2: Domain Module Foundation

### 2.1 Users module skeleton

Ilk kurulacak domain modulunun `users` olmasi onerilir. Sebep: mevcut DB'de `users`, `user_credentials`, `password_reset_tokens` tablolari hazir.

Yapilacaklar:

1. `src/modules/users/` klasorunu olustur.
2. `users.repository.ts` icinde temel query fonksiyonlarini yaz.
3. `users.service.ts` icinde public use-case fonksiyonlarini tanimla.
4. `users.schemas.ts` icinde Zod request schema'larini tut.
5. `users.routes.ts` icinde Express route binding yap.
6. Top-level `src/routes/index.ts` icinden users route'unu mount et.

Repository kurallari:

- Kysely sadece repository katmaninda dogrudan kullanilsin.
- Soft delete tablolari icin default query `deleted_at is null` filtresini uygulasin.
- Repository fonksiyonlari raw Express request/response bilmesin.

Service kurallari:

- Is kurallari route handler'a yazilmasin.
- Transaction ihtiyaci service katmaninda yonetilsin.
- Authorization kararini direkt DB query ile dagitmak yerine policy/service katmanina delege etsin.

### 2.2 Academic organization module skeleton

Mevcut tablolar:

- `academic_units`
- `departments`
- `disciplines`
- `user_academic_affiliations`

Yapilacaklar:

1. `academic_units` adlandirma karari netlestir.
2. Eger mevcut isim korunacaksa dokumanlarda ve API'de "ust akademik birim" anlami tutarli kullanilsin.
3. Production oncesi rename gerekiyorsa migration planlansin.
4. Akademik organizasyon route/service/repository yapisi users moduluyle ayni pattern'i izlesin.

Open decision:

- `academic_units` kalacak mi, yoksa `academic_top_units` gibi daha acik bir isim mi kullanilacak?

## Phase 3: Authorization Architecture

Mevcut DB modeli `role_permissions` ile scope-aware authorization'a hazir gorunuyor. Uygulama kodunda merkezi policy katmani kurulmalidir.

### 3.1 Required primitives

Olusturulacak parcalar:

```text
src/modules/authorization/
  authorization.middleware.ts
  authorization.service.ts
  authorization.policy.ts
  authorization.types.ts
```

Temel middleware'ler:

```ts
requireAuth()
requirePermission(permission)
requireScopedPermission(options)
```

Ornek route kullanimi:

```ts
router.post(
  '/academic-units',
  requireAuth(),
  requirePermission('academic-unit:create'),
  handler
)
```

Scope-aware ornek:

```ts
requireScopedPermission({
  permission: 'target:approve',
  scopeType: 'ACADEMIC_UNIT',
  resolveScopeId: (req) => req.params.academicUnitId
})
```

### 3.2 Permission lookup rules

- Kullanici session payload'i minimum user id tasimali.
- Authorization service kullanicinin aktif role permission kayitlarini repository uzerinden okumali.
- `deleted_at is null` olmayan permission kayitlari dikkate alinmamali.
- Tarih araligi varsa `start_date` / `end_date` kontrolleri uygulanmali.
- Global permission ile scoped permission ayrimi acik olmali.

Acceptance criteria:

- Auth olmayan istek 401 doner.
- Auth var ama permission yoksa 403 doner.
- Global permission scope gerektirmeyen endpointte calisir.
- Scoped permission sadece ilgili akademik scope icin calisir.
- Tum cevaplar standart error shape kullanir.

## Phase 4: Validation and Request Parsing

Zod sadece env validation icin degil, API request validation icin de standart hale getirilmelidir.

Yapilacaklar:

1. `validateBody(schema)`, `validateQuery(schema)`, `validateParams(schema)` middleware/helper'lari ekle.
2. Validation hatalari `VALIDATION_ERROR` koduyla 400 donsun.
3. Field-level error detaylari `error.details` altinda donsun.
4. Moduller schema'larini kendi `*.schemas.ts` dosyasinda tutsun.

Ornek hedef response:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "fields": {
        "email": ["Invalid email"]
      }
    }
  }
}
```

## Phase 5: Soft Delete and Repository Conventions

Soft delete kullanan tablolarda `deleted_at is null` filtresi merkezi hale getirilmelidir.

Yapilacaklar:

1. Her repository'de aktif kayit query helper'i tanimla.
2. Soft deleted kayitlari varsayilan liste/detail endpointlerinden disla.
3. Gerekirse admin/audit endpointleri icin explicit `includeDeleted` opsiyonu kullan.
4. Unique constraintlerde partial unique index pattern'i korunmali.

Ornek:

```ts
const activeUsers = (db: Kysely<DB>) => {
  return db.selectFrom('users').where('deletedAt', 'is', null)
}
```

Acceptance criteria:

- Soft deleted kayitlar normal GET/list endpointlerinde gorunmez.
- Silme islemleri fiziksel delete yerine `deleted_at` set eder.
- Restore ihtiyaci varsa ayri use-case olarak modellenir.

## Phase 6: Observability and Error Logging

Mevcut pino/pino-http altyapisi iyi bir baslangic. Error middleware exception context'ini structured olarak loglamalidir.

Yapilacaklar:

1. `errorHandler` icinde 5xx hatalari stack/message/requestId ile logla.
2. 4xx validation/client hatalarini gerekirse warn seviyesinde tut.
3. Loglarda secret, cookie, authorization header ve password alanlari redacted kalmali.
4. Request id tum error loglarinda bulunmali.

Acceptance criteria:

- 500 hatalarda logda request id ve stack vardir.
- Response body stack veya internal detail icermez.
- Secret/cookie/header redaction test veya smoke test ile dogrulanir.

## Phase 7: Production Configuration and Deployment Readiness

### 7.1 CORS config

Mevcut allowlist local degerlerle hardcoded durumda. Production oncesi config'e tasinmalidir.

Yapilacaklar:

1. `CORS_ALLOWED_ORIGINS` env degeri ekle.
2. Virgulle ayrilmis origin listesi parse et.
3. Production'da bos allowlist ile uygulama fail-fast dussun veya bilincli default belirlensin.
4. Testlerde allowed/disallowed origin davranisi dogrulansin.

### 7.2 Database SSL decision

Managed PostgreSQL kullanilacaksa SSL config modeli netlesmelidir.

Open decision:

- `DATABASE_SSL_MODE` gibi explicit env mi olacak?
- Yoksa connection string parametresi yeterli mi kabul edilecek?

### 7.3 Dockerfile

Production deployment hedefleniyorsa Dockerfile eklenmelidir.

Kurallar:

- Node base image version pinned olmali.
- Multi-stage build kullanilmali.
- Container root olarak calismamali.
- Secrets image icine bake edilmemeli.
- Healthcheck `/health/live` veya uygun CLI/HTTP check ile tanimlanmali.

## Suggested Implementation Order

1. API error response helper ve middleware refactor.
2. Request validation helper'lari.
3. Users module skeleton.
4. Authorization module skeleton.
5. Academic organization naming decision.
6. Academic organization module skeleton.
7. Soft delete repository conventions.
8. Error logging iyilestirmesi.
9. CORS production config.
10. Docker/deployment hazirliklari.

## Phase/Risk Matrix

| Phase | Area | Risk | Notes |
|---|---|---:|---|
| 1 | Error contract | Medium | Testleri guncellemek gerekir; client yoksa risk dusuk |
| 2 | Module structure | Low | Yeni kod pattern'i; mevcut davranisi az etkiler |
| 3 | Authorization | High | Guvenlik kritik; test kapsamı sart |
| 4 | Validation | Medium | Request contract'larini etkiler |
| 5 | Soft delete | Medium | Query unutma riskini azaltir |
| 6 | Observability | Low | Response contract degismeden eklenebilir |
| 7 | Deployment config | Medium | Production ortam kararlarina bagli |

## Testing Strategy

Her faz icin minimum test beklentisi:

- Error helper: status/code/message/details response testleri.
- Validation helper: body/query/params validation failure testleri.
- Users module: repository ve route/service integration testleri.
- Authorization: 401, 403, scoped allow, scoped deny testleri.
- Soft delete: deleted kayitlarin list/detail endpointlerinden dislanmasi.
- CORS config: allowed/disallowed origin testleri.

Komutlar:

```bash
npm run typecheck
npm test
npm run check
```

Not: `npm run check` Biome'i `--write` ile calistirir; CI icin ayrica write yapmayan `check:ci` script'i eklenmesi degerlendirilebilir.

## Open Decisions

- API prefix gelecekte versioned olacak mi? Ornek: `/api/v1`.
- `academic_units` ismi korunacak mi, yoksa `academic_top_units` gibi daha acik bir isim mi kullanilacak?
- Public/API-key tabanli machine-to-machine API olacak mi, yoksa sadece browser session modeli mi kalacak?
- Authorization permission string format standardi ne olacak? Ornek: `resource:action`.
- Cursor pagination icin standart cursor encoding formati ne olacak?
- Managed PostgreSQL SSL ayari nasil yapilacak?
- Production CORS allowlist config modeli ne olacak?

## Exit Criteria

Bu plan tamamlanmis sayilmak icin:

- Tum hata cevaplari standart nested error shape kullanir.
- En az bir domain modulu route-service-repository-schema pattern'i ile uygulanmistir.
- Authorization middleware/service/policy temel akisi vardir.
- Request validation helper'lari standartlasmistir.
- Soft delete kullanan repository'lerde aktif kayit convention'i vardir.
- Error logging request id ve stack context'i ile 5xx hatalari structured loglar.
- Production CORS/config kararları netlesmistir.
- Typecheck, test ve lint temizdir.
