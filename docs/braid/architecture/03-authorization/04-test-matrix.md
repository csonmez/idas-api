# Authorization Test Matrix

## Test notları

- Test framework'u `node:test`, `node:assert/strict`, `supertest` ve `tsx --test src/**/*.test.ts`.
- Middleware/policy unit testleri icin onerilen dosya: `src/modules/authorization/authorization.policy.test.ts`.
- Repository/service/middleware integration testleri icin onerilen dosya: `src/modules/authorization/authorization.middleware.test.ts` veya mevcut test organizasyonuna uygun yeni `*.test.ts`.
- Production router'a test-only route eklenmemelidir; kucuk Express app fixture pattern'i kullanilmalidir.
- DB integration testi icin gercek PostgreSQL zorunlu olacaksa Composer implementasyon oncesi raporlamalidir. Alternatif olarak repository fake ile middleware/service integration, policy icin saf unit test yazilabilir.

| ID | Senaryo | Middleware/katman | Kullanıcı durumu | Permission | Grant scope | Target scope | Parent ilişkisi | Tarih durumu | Beklenen sonuç | HTTP status | Error code | Test seviyesi | Test dosyası | Acceptance criterion |
|---|---|---|---|---|---|---|---|---|---|---:|---|---|---|---|
| AUTH-001 | Session yok | `requireAuth` | Yok | Yok | Yok | Yok | Yok | Yok | Handler calismaz | 401 | `UNAUTHENTICATED` | Integration | `authorization.middleware.test.ts` | AC-1, AC-16 |
| AUTH-002 | Kullanici var, permission yok | `requirePermission` | Auth | `user:read` | Yok | Yok | Yok | Aktif grant yok | Handler calismaz | 403 | `FORBIDDEN` | Integration | `authorization.middleware.test.ts` | AC-2 |
| AUTH-003 | Global permission basarili | `requirePermission` | Auth | `user:read` | `GLOBAL` | Yok | Yok | Aktif | Handler calisir | 200 | Yok | Integration | `authorization.middleware.test.ts` | AC-3 |
| AUTH-004 | Yanlis permission string | Policy/service | Auth | `user:read` | `GLOBAL` grant `user:write` | Yok | Yok | Aktif | Deny | 403 | `FORBIDDEN` | Unit + integration | `authorization.policy.test.ts` | AC-14 |
| AUTH-005 | ACADEMIC_UNIT -> ayni unit | Policy | Auth | `department:manage` | `ACADEMIC_UNIT` | `ACADEMIC_UNIT` | Grant unit = target unit | Aktif | Allow | 200 | Yok | Unit | `authorization.policy.test.ts` | AC-5 |
| AUTH-006 | ACADEMIC_UNIT -> child department | Policy/service | Auth | `department:manage` | `ACADEMIC_UNIT` | `DEPARTMENT` | Grant unit = department parent unit | Aktif | Allow | 200 | Yok | Unit + service | `authorization.policy.test.ts` | AC-5 |
| AUTH-007 | ACADEMIC_UNIT -> child discipline | Policy/service | Auth | `discipline:manage` | `ACADEMIC_UNIT` | `DISCIPLINE` | Grant unit = discipline parent unit | Aktif | Allow | 200 | Yok | Unit + service | `authorization.policy.test.ts` | AC-5 |
| AUTH-008 | ACADEMIC_UNIT -> baska unit reddi | Policy | Auth | `department:manage` | `ACADEMIC_UNIT` | `DEPARTMENT` | Grant unit != department parent unit | Aktif | Deny | 403 | `FORBIDDEN` | Unit | `authorization.policy.test.ts` | AC-6 |
| AUTH-009 | DEPARTMENT -> ayni department | Policy | Auth | `department:manage` | `DEPARTMENT` | `DEPARTMENT` | Grant department = target department | Aktif | Allow | 200 | Yok | Unit | `authorization.policy.test.ts` | AC-7 |
| AUTH-010 | DEPARTMENT -> child discipline | Policy/service | Auth | `discipline:manage` | `DEPARTMENT` | `DISCIPLINE` | Grant department = discipline parent department | Aktif | Allow | 200 | Yok | Unit + service | `authorization.policy.test.ts` | AC-7 |
| AUTH-011 | DEPARTMENT -> sibling department reddi | Policy | Auth | `department:manage` | `DEPARTMENT` | `DEPARTMENT` | Grant department != target department | Aktif | Deny | 403 | `FORBIDDEN` | Unit | `authorization.policy.test.ts` | AC-8 |
| AUTH-012 | DISCIPLINE -> ayni discipline | Policy | Auth | `discipline:manage` | `DISCIPLINE` | `DISCIPLINE` | Grant discipline = target discipline | Aktif | Allow | 200 | Yok | Unit | `authorization.policy.test.ts` | AC-9 |
| AUTH-013 | DISCIPLINE -> baska discipline reddi | Policy | Auth | `discipline:manage` | `DISCIPLINE` | `DISCIPLINE` | Grant discipline != target discipline | Aktif | Deny | 403 | `FORBIDDEN` | Unit | `authorization.policy.test.ts` | AC-9 |
| AUTH-014 | Birden fazla rol union | Policy/service | Auth | `report:read` | Mixed | Mixed | En az bir grant match | Aktif | Allow | 200 | Yok | Unit | `authorization.policy.test.ts` | AC-10 |
| AUTH-015 | Soft-deleted grant | Repository/service | Auth | `report:read` | `GLOBAL` | Yok | Yok | `deletedAt` set | Dikkate alinmaz, deny | 403 | `FORBIDDEN` | Repository/unit or service fake | `authorization.repository.test.ts` | AC-11 |
| AUTH-016 | Future start date | Repository/service | Auth | `report:read` | `GLOBAL` | Yok | Yok | `startDate > now` | Dikkate alinmaz, deny | 403 | `FORBIDDEN` | Repository/unit or service fake | `authorization.repository.test.ts` | AC-12 |
| AUTH-017 | Expired end date | Repository/service | Auth | `report:read` | `GLOBAL` | Yok | Yok | `endDate < now` | Dikkate alinmaz, deny | 403 | `FORBIDDEN` | Repository/unit or service fake | `authorization.repository.test.ts` | AC-13 |
| AUTH-018 | Sinir tarihleri | Repository/service | Auth | `report:read` | `GLOBAL` | Yok | Yok | `startDate <= now`, `endDate >= now` | Allow | 200 | Yok | Repository/unit or service fake | `authorization.repository.test.ts` | AC-12, AC-13 |
| AUTH-019 | Duplicate grant | Policy | Auth | `report:read` | Duplicate `GLOBAL` | Yok | Yok | Aktif | Allow, tek sonuc gibi | 200 | Yok | Unit | `authorization.policy.test.ts` | AC-10 |
| AUTH-020 | Target bulunamamasi | Service/middleware | Auth | `department:manage` | Any | `DEPARTMENT` | Repository null | Aktif | Handler calismaz | 403 | `FORBIDDEN` | Integration | `authorization.middleware.test.ts` | AC-15 |
| AUTH-021 | Repository error | Service/middleware | Auth | `report:read` | Any | Any | DB hata | Yok | Internal detay sizmaz | 500 | `INTERNAL_ERROR` | Integration | `authorization.middleware.test.ts` | AC-17 |
| AUTH-022 | Nested Error Contract | Middleware | Yok veya deny | Any | Any | Any | Any | Any | `body.error.code` object icinde | 401/403 | Ilgili code | Integration | `authorization.middleware.test.ts` | AC-16 |
| AUTH-023 | Handler'in deny durumunda calismamasi | Middleware | Auth | `report:read` | Yok | Yok | Yok | Yok | Sentinel handler 0 call | 403 | `FORBIDDEN` | Integration | `authorization.middleware.test.ts` | AC-2 |
| AUTH-024 | Test route'un production router'a eklenmemesi | Test setup | Any | Any | Any | Any | Any | Any | `src/routes/index.ts` degismez | N/A | N/A | Static/smoke | Test review | Scope disi kural |
| AUTH-025 | GLOBAL grant scoped target'larda gecerli | Policy | Auth | `discipline:manage` | `GLOBAL` | `ACADEMIC_UNIT`, `DEPARTMENT`, `DISCIPLINE` | Any | Aktif | Allow | 200 | Yok | Unit | `authorization.policy.test.ts` | AC-4 |
| AUTH-026 | Scoped grant scope'suz global endpointte reddi | `requirePermission` | Auth | `user:read` | `DEPARTMENT` | Yok (global endpoint) | Yok | Aktif | Deny | 403 | `FORBIDDEN` | Integration | `authorization.middleware.test.ts` | AC-19 |

## Ek kapsam kontrolleri (Resolved)

- Permission string format'i developer contract'tir: permission'lar tipli sabit (`Permission` union/const) olarak tanimlanir, runtime format validation eklenmez. Bir unit test tanimli sabitlerin `resource:action` lower-kebab-case formatina uydugunu dogrular.
- `requirePermission` yalnizca GLOBAL grant kabul eder; scoped grant scope'suz endpointte 403 doner (bkz. AUTH-026, AC-19).
- Date karsilastirmasi injected clock ile yapilir; testler sabit `now` enjekte ederek deterministik calisir (bkz. AUTH-018).
