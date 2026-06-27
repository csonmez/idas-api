# Architecture BRAID Roadmap

Bu roadmap, `docs/7_ARCHITECTURE_IMPROVEMENT_PLAN.md` dosyasındaki `Suggested Implementation Order` siralamasini uygulama sirasi olarak kabul eder. Bu dosya faz detaylarini kodlama planina cevirmek yerine, Cursor Composer tarafindan ayrik ve takip edilebilir BRAID klasorlerine bolunmus genel yol haritasini tarif eder.

## Kaynak ve Öncelik

Karar onceligi:

1. Kaynak dokumandaki `Resolved Decisions`
2. Kaynak dokumandaki ilgili fazin acik kurallari
3. Kaynak dokumandaki `Suggested Implementation Order`
4. Mevcut kodun gercek davranisi
5. Kaynak dokumandaki `Open Decisions`

`Open Decisions` maddeleri bu roadmap icinde cozulmus kabul edilmez.

## 1. Error Contract

- Amaç: Tum API hata cevaplarini standart nested error contract'a tasimak ve application hata tipini merkezilestirmek.
- Kaynak dokümandaki ilgili bölüm: `Phase 1: API Contract Standardization`, `1.1 Standard error response shape`, `1.3 Application error types`, `Testing Strategy`.
- Ön koşullar: Mevcut error middleware, not-found, CSRF, rate-limit, payload-too-large ve ilgili test davranislari tespit edilmis olmalidir.
- Bağımlı olduğu önceki adımlar: Yok.
- Risk seviyesi: Medium.
- Scope özeti: Error response helper hedefi, `AppErrorCode`, `AppError` class veya factory modeli, middleware mapping, not-found, CSRF, rate-limit, payload-too-large ve ilgili test guncellemeleri.
- Tamamlanma kriterleri: Tum hata cevaplari `{ error: { code, message, details } }` seklinde doner; 400, 403, 404, 413, 429 ve 500 test edilir; client'a 500 stack trace veya internal detail sizmaz.
- Bir sonraki adıma geçiş kriterleri: Error contract testlerle sabitlenir, mevcut basarili response contract'lari degistirilmez, typecheck/test/lint temiz gecmeye hazirdir.
- İlgili BRAID klasörü: `docs/braid/architecture/01-error-contract/`

## 2. Request Validation

- Amaç: API request validation icin Zod tabanli `validateBody`, `validateQuery` ve `validateParams` helper'larini standartlastirmak.
- Kaynak dokümandaki ilgili bölüm: `Phase 4: Validation and Request Parsing`, `Resolved Decisions`.
- Ön koşullar: Error Contract fazi tamamlanmis ve `VALIDATION_ERROR` standart contract ile donebilir hale gelmis olmalidir.
- Bağımlı olduğu önceki adımlar: 1. Error Contract.
- Risk seviyesi: Medium.
- Scope özeti: Zod parse, validation hatalarinin `VALIDATION_ERROR` olarak donmesi, field-level details, canonical parsed degerlerin `req.body`, `req.query`, `req.params` alanlarina yazilmasi.
- Tamamlanma kriterleri: Handler'lar raw input yerine normalize/coerce edilmis request verisiyle calisir; raw request body ilk fazda saklanmaz; validation hatalari nested error contract kullanir.
- Bir sonraki adıma geçiş kriterleri: Validation helper'lari testlerle sabitlenir ve domain modulleri tarafindan kullanilabilecek hale gelir.
- İlgili BRAID klasörü: `docs/braid/architecture/02-request-validation/`

## 3. Authorization

- Amaç: Scope-aware authorization icin merkezi middleware/service/policy temelini kurmak.
- Kaynak dokümandaki ilgili bölüm: `Phase 3: Authorization Architecture`, `Resolved Decisions`.
- Ön koşullar: Error Contract fazi tamamlanmis olmalidir; request parametrelerinin guvenilir bicimde okunmasi icin Request Validation fazi tamamlanmis olmalidir.
- Bağımlı olduğu önceki adımlar: 1. Error Contract, 2. Request Validation.
- Risk seviyesi: High.
- Scope özeti: `requireAuth`, `requirePermission`, `requireScopedPermission`, hierarchical scope policy, aktif permission lookup, parent scope cozumu.
- Tamamlanma kriterleri: Auth olmayan istek 401 doner; auth var ama permission yoksa 403 doner; hierarchical authorization varsayilan davranis olur; tum hata cevaplari standart error shape kullanir.
- Bir sonraki adıma geçiş kriterleri: Authorization middleware/service/policy akisi testlerle dogrulanir ve ilk users use-case'i icin kullanilabilir hale gelir.
- İlgili BRAID klasörü: `docs/braid/architecture/03-authorization/`

## 4. Users Module

- Amaç: Ilk gercek users use-case'i ile route-service-repository-schema modul pattern'ini kanitlamak.
- Kaynak dokümandaki ilgili bölüm: `Phase 2.1 Users module pattern`, `Resolved Decisions`, `Open Decisions`.
- Ön koşullar: Ilk gercek users use-case'i secilmis olmalidir; Error Contract, Request Validation ve Authorization temelleri hazir olmalidir.
- Bağımlı olduğu önceki adımlar: 1. Error Contract, 2. Request Validation, 3. Authorization.
- Risk seviyesi: Low.
- Scope özeti: Sadece secilen gercek use-case'in ihtiyac duydugu users route/handler/service/repository/schema/types dosyalari olusturulur; bos modul kalibi olusturulmaz.
- Tamamlanma kriterleri: Users module pattern'i gercek bir use-case uzerinden calisir; repository Express Request/Response bilmez; service Express Response bilmez.
- Bir sonraki adıma geçiş kriterleri: Pattern sonraki domain modulunde tekrar kullanilabilecek kadar netlesir.
- İlgili BRAID klasörü: `docs/braid/architecture/04-users-module/`

## 5. Academic Organization

- Amaç: Academic organization module pattern'ini users module pattern'iyle tutarli bicimde kurmak.
- Kaynak dokümandaki ilgili bölüm: `Phase 2.2 Academic organization module pattern`, `Resolved decision`.
- Ön koşullar: Users module pattern'i ilk gercek use-case ile kanitlanmis olmalidir.
- Bağımlı olduğu önceki adımlar: 4. Users Module.
- Risk seviyesi: Low.
- Scope özeti: `academic_units`, `departments`, `disciplines`, `user_academic_affiliations` alaninda users pattern'ini izleyen route/service/repository yapisi; `academic_units` adinin korunmasi.
- Tamamlanma kriterleri: Academic organization route/service/repository yapisi users pattern'iyle tutarlidir; `academic_top_units` veya `ACADEMIC_TOP_UNIT` kullanilmaz.
- Bir sonraki adıma geçiş kriterleri: Repository pattern'i soft delete convention fazi icin yeterince gorunur hale gelir.
- İlgili BRAID klasörü: `docs/braid/architecture/05-academic-organization/`

## 6. Soft Delete

- Amaç: Soft delete kullanan tablolarda tablo bazli repository convention'ini standart hale getirmek.
- Kaynak dokümandaki ilgili bölüm: `Phase 5: Soft Delete and Repository Conventions`, `Resolved Decisions`.
- Ön koşullar: Ilgili domain repository pattern'leri kurulmus olmalidir.
- Bağımlı olduğu önceki adımlar: 4. Users Module, 5. Academic Organization.
- Risk seviyesi: Medium.
- Scope özeti: `academic_units`, `departments`, `disciplines`, `user_academic_affiliations`, `role_permissions` icin `deleted_at is null` aktif kayit convention'i; `users` istisnasinin korunmasi.
- Tamamlanma kriterleri: Soft deleted kayitlar normal liste/detail endpointlerinde gorunmez; silme islemleri fiziksel delete yerine `deleted_at` set eder; restore ayri use-case olarak kalir.
- Bir sonraki adıma geçiş kriterleri: Repository convention'i testlerle korunur ve error logging fazindan bagimsiz hale gelir.
- İlgili BRAID klasörü: `docs/braid/architecture/06-soft-delete/`

## 7. Error Logging

- Amaç: Error middleware icinde 5xx exception context'ini structured olarak loglamak.
- Kaynak dokümandaki ilgili bölüm: `Phase 6: Observability and Error Logging`.
- Ön koşullar: Error Contract fazi tamamlanmis olmalidir.
- Bağımlı olduğu önceki adımlar: 1. Error Contract.
- Risk seviyesi: Low.
- Scope özeti: 5xx hatalarda request id ve stack ile loglama; 4xx validation/client hatalari icin uygun seviye; secret/cookie/authorization/password redaction davranisinin korunmasi.
- Tamamlanma kriterleri: 500 hatalarda logda request id ve stack vardir; response body stack veya internal detail icermez; redaction test veya smoke test ile dogrulanir.
- Bir sonraki adıma geçiş kriterleri: Logging davranisi response contract'i degistirmeden sabitlenir.
- İlgili BRAID klasörü: `docs/braid/architecture/07-error-logging/`

## 8. CORS Config

- Amaç: Production CORS allowlist davranisini runtime config'e tasimak.
- Kaynak dokümandaki ilgili bölüm: `Phase 7.1 CORS config`, `Open Decisions`.
- Ön koşullar: Production CORS allowlist config modeline karar verilmis olmalidir.
- Bağımlı olduğu önceki adımlar: 1. Error Contract.
- Risk seviyesi: Low.
- Scope özeti: `CORS_ALLOWED_ORIGINS` env degeri, virgulle ayrilmis origin parse, production bos allowlist davranisinin belirlenen karara gore uygulanmasi, allowed/disallowed origin testleri.
- Tamamlanma kriterleri: Hardcoded local allowlist production davranisinin yerine config tabanli model gelir; testlerde allowed/disallowed origin davranisi dogrulanir.
- Bir sonraki adıma geçiş kriterleri: Roadmap tamamlanir ve kaynak plandaki exit criteria yeniden degerlendirilir.
- İlgili BRAID klasörü: `docs/braid/architecture/08-cors-config/`

## Açık Kararlar

Kaynak dokumanda hala acik olan kararlar:

- Public/API-key tabanli machine-to-machine API olacak mi, yoksa sadece browser session modeli mi kalacak?
- Production CORS allowlist config modeli ne olacak?
- Ilk gercek users use-case'i hangisi olacak?

## Mevcut Kod ile Plan Arasındaki Çelişkiler ve Belirsizlikler

- Mevcut hata cevaplari flat shape kullanir; kaynak plan nested `{ error: { code, message, details } }` contract'ini hedefler.
- Mevcut kodda merkezi `AppError` veya error response helper yoktur.
- Mevcut `errorHandler` 401, 409, 429 ve 503 gibi kaynak plandaki tum `AppErrorCode` degerlerini merkezi code mapping olarak kapsamiyor.
- Mevcut `/health/ready` 503 cevaplari body olmadan doner; kaynak planin "tum hata cevaplari" ifadesinin health readiness cevaplarini kapsayip kapsamadigi ayrica netlestirilmelidir.
- Mevcut CORS allowlist hardcoded local origin listesi kullanir; production config modeli kaynak dokumanda acik karardir.
