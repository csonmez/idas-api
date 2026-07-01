# Auth/Login V2 — Uygulama İnceleme Rehberi

> Bu rehber, `docs/9_AUTH_LOGIN_V2_PLAN.md` planının t1–t30 tasklarıyla uygulanan auth sisteminde **değişen/eklenen tüm dosyaları** mantıksal bir inceleme sırasıyla listeler.
> Bağımlılık zincirine göre düzenlenmiştir: altyapı → config/DI → modül iç yapısı → wire-up → testler → plan.

---

## İçindekiler

1. [Bağımlılıklar](#1-bağımlılıklar)
2. [Tip augmentation](#2-tip-augmentation--expressuser-tanımı)
3. [Auth altyapısı (`src/auth/`)](#3-auth-altyapısı-srcauth)
4. [Config / DI genişletme](#4-config--di-genişletme)
5. [Account modülü (`src/modules/account/`)](#5-account-modülü-srcmodulesaccount)
6. [Wire-up — modül mount](#6-wire-up--modül-mount)
7. [Test mock güncellemeleri](#7-test-mock-güncellemeleri)
8. [Plan dokümanı](#8-plan-dokümanı)
9. [Önerilen okuma sırası](#önerilen-okuma-sırası)

---

## 1. Bağımlılıklar

Plan Phase 1 step 1–2. Tüm auth işlevinin runtime bağımlılıkları.

| Dosya | Değişiklik | Amaç |
|-------|-----------|------|
| `package.json` | ✏️ | `passport-local` (dependency), `@types/passport-local` (devDependency), `bcryptjs` (dependency) |
| `package-lock.json` | ✏️ | npm lock senkronizasyonu |

**Not:** `@types/passport-local` doğruca `devDependencies`'te olmalı — uygulama sırasında yanlışlıkla `dependencies`'e düştü, düzeltildi.

---

## 2. Tip augmentation — `Express.User` tanımı

Global tip augmentation. Tüm auth katmanının tip temeli; **ilk okunmalı** çünkü passport, controller ve middleware hep bu tipleri kullanır.

| Dosya | Değişiklik | Amaç |
|-------|-----------|------|
| `src/types/express.d.ts` | 🇳 | `declare global namespace Express { interface User { id, email, status } }` + `declare module 'express-session' { interface SessionData { csrfToken? } }`. `export {}` ile modül olarak işaretlendi (global augmentation uygulanır). |

**İnceleme notu:** Bu augmentation olmadan `req.user.id` / `req.session.csrfToken` tiplenemezdi. `authorization.middleware.ts` zaten `req.user?.id` kullanıyordu — bu dosya onu da tipliyor.

---

## 3. Auth altyapısı (`src/auth/`)

Cross-cutting auth bootstrap. Plan "src/auth/*: altyapı; account modülü domain" ayrımına uygun.

### 3a. `src/auth/password-policy.ts` 🇳

**Hiçbir şeye bağımlı değil; her yerden import edilir.**

- `BCRYPT_ROUNDS = 12` — password hash cost factor
- `DUMMY_HASH = '$2b$12$...'` — rounds 12 ile önceden üretilmiş sabit, non-secret hash. No-user/no-credential login dallarında timing oracle eşitleme için (Mimari Karar 5).

**İnceleme notu:** `BCRYPT_ROUNDS` env config'inde de var (`config.auth.bcryptRounds`, default 12). İkisi uyumlu olmalı; cost ayrışırsa timing oracle geri döner. Gerçek credential hash üretimi Phase 2a service'inde `config.auth.bcryptRounds` kullanır; DUMMY_HASH ise bu sabitle uyumlu varsayılır.

### 3b. `src/auth/session.ts` ✏️

- `SESSION_STORE_PREFIX`: `'sess:'` → `'idas:sess:'` (Kilit Karar #4)
- `csrfToken` augmentation'ı **kaldırıldı** — `src/types/express.d.ts`'e taşındı (merkezi yer)

**İnceleme notu:** `idas:sess:` prefix'i user-session index'inin `idas:sess:<sid>` store key formatına temel. connect-redis v9 ile key format uyumu Phase 2a'da doğrulanmalı.

### 3c. `src/auth/passport.ts` ✏️

- LocalStrategy eklendi: `usernameField: 'email'`, `passwordField: 'password'`
- verify fonksiyonu: `users` ⟕ `userCredentials` join (camelCase), `bcrypt.compare`, başarılıda `AuthenticatedUser` dön
- `deserializeUser` query'sine `email` eklendi (`select(['id','email','status'])`)
- **Idempotent guard**: module-level `isConfigured` — ikinci `configurePassport` çağrısı no-op
- `_resetPassportConfig()` — test izolasyonu için guard sıfırlama

**İnceleme notu (önemli):** verify fonksiyonu **minimal** — account lock, dummy compare, atomic UPDATE **yok**. Yorumla "Phase 2a'da account service'e taşınacak" notu var. Gerçek login logic `account.service.ts` `createSessionWithPassword`'da. LocalStrategy'nin verify'si ile service'in credential doğrulaması **çakışabilir** — hangisinin route'ta kullanıldığını kontrol et.

---

## 4. Config / DI genişletme

Plan'ın "config/DI genişletme" açık maddesi (t10). Tüm auth parametrelerinin env'den okunması.

### 4a. `src/config/env.ts` ✏️

Zod schema + `AppConfig` type + `readEnv()` genişletildi. Yeni auth alanları:

- `bcryptRounds` (default 12, min 10 max 13)
- `passwordMinLength` (default 15)
- `corsAllowedOrigins` (comma-separated → `string[]`)
- `trustProxyHops` (default 1)
- `sessionCookieSameSite` (env'den, default 'lax')
- `rateLimit` alt-objesi:
  - `session: { windowMs: 15m, ipEmailMax: 5, ipMax: 50 }`
  - `resetRequest: { windowMs: 1h, ipEmailMax: 3, ipMax: 20 }`
  - `resetCompletion: { windowMs: 15m, ipRouteMax: 10 }`

**İnceleme notu:** WindowMs'ler sabit (rate-limit değerleri env'den). `corsAllowedOrigins.split(',').filter(s => s.length > 0)` — boş stringler filtrelenir.

### 4b. `src/app.types.ts` ✏️

`AppDependencies`'e `passwordResetNotifier?: PasswordResetNotifier` opsiyonel slot eklendi. `PasswordResetNotifier` structural tip `app.types.ts` içinde tanımlı (Phase 2b'de `password-reset-notifier.ts`'ten import edilmeli).

**İnceleme notu:** Structural tip ile gerçek interface arasında drift riski. Phase 2b'de `password-reset-notifier.ts` interface'i ile uyumlu tutulmalı.

### 4c. `src/security/cors.ts` ✏️

`createCorsMiddleware()` → `createCorsMiddleware(allowedOrigins: readonly string[])`. Hardcode `ALLOWED_ORIGINS` kalktı.

### 4d. `src/app.ts` ✏️

- `app.set('trust proxy', deps.config.auth.trustProxyHops)` (önce `isProduction ? 1 : false`)
- `createCorsMiddleware(deps.config.auth.corsAllowedOrigins)`

**İnceleme notu:** `trustProxyHops` default 1 — çok hop'lı CDN arkasında yanlış IP → rate limit bozulur. Proxy topolojisi deploy öncesi netleştirilmeli (Kilit Karar #3).

---

## 5. Account modülü (`src/modules/account/`)

Feature-based modül. Plan Modül Yapısı'na göre. **İç okuma sırası:** types → schemas → notifier → service → limiter → controller → routes → test.

### 5a. `account.types.ts` 🇳

Response DTO'ları (Mimari Karar 4). Bağımlılıksız tip tanımları.

- `AccountSessionRole`, `AccountSessionAffiliation`, `AccountSessionUser`
- `CreateSessionResponse` (user + csrfToken), `GetSessionResponse`

**İnceleme notu:** Bu DTO'lar canonical permission kararının kaynağı değil, sadece current session context response'u. Route authorization kararları authorization middleware'de.

### 5b. `account.schemas.ts` 🇳

Zod v4 validation schemas'ları.

- `createSessionBodySchema` — email `trim().toLowerCase().email()`, password `min(1)`
- `completePasswordResetBodySchema` — password `min(15)` + bcrypt byte limit (≤72)
- `createPasswordResetRequestBodySchema` — sadece email
- `PASSWORD_MIN_LENGTH = 15`, `PASSWORD_MAX_BYTE_LENGTH = 72` sabitleri

### 5c. `account.service.ts` 🇳 — **EN BÜYÜK DOSYA**

Tüm business logic. AccountServiceDeps: `{ db, redisClient, config, passwordResetNotifier }`.

**`createSessionWithPassword`** (Mimari Karar 5/6):
1. Email normalize
2. `users` ⟕ `userCredentials` join lookup
3. No-credential / INACTIVE → dummy bcrypt compare + generic 401
4. `locked_until > now` → generic 401 (compare yok)
5. `bcrypt.compare` (transaction dışı)
6. Match yok → **raw SQL atomic `UPDATE ... RETURNING`**: failed_login_count increment + lock (≥5 → +15dk)
7. Match var → `UPDATE` last_login_at, reset count/lock
8. `regenerateSession` → `loginUser` → `issueCsrfToken` (sıralama kritik)
9. Redis user-session index'ine store key yaz

**`getCurrentSession`**: user base info (roles/affiliations şimdilik boş)

**`deleteCurrentSession`**: `req.session.destroy` + Redis index'ten store key `sRem`

**`createPasswordResetRequest`** (Mimari Karar 8):
- User yok/INACTIVE → no-op (generic 204, timing)
- Token üret (`randomBytes(32).base64url`), SHA-256 hash, TTL 1h
- Transaction: eski token hard delete + yeni insert
- `passwordResetNotifier.enqueuePasswordResetEmail`

**`completePasswordReset`** (Mimari Karar 8):
- SHA-256 hash lookup
- bcrypt hash **transaction dışı**
- Transaction: token re-check (race), credential upsert (`onConflict doUpdateSet`), token hard delete
- `invalidateUserSessions` (hard failure: Kilit Karar #9)

**İnceleme notları:**
- `invalidateUserSessions` helper: `sMembers` + `del([...members, key])` — Redis SET index temizliği
- Raw SQL CASE ifadesi Kysely `sql` template ile — Kysely CASE API'si yerine raw tercih edildi
- Race: token consumed mid-hash → transaction içi re-check başarısız, hash discard, generic failure

### 5d. `account.controller.ts` 🇳

Thin HTTP mapping. 5 handler: `createSession`, `getSession`, `deleteSession`, `createPasswordResetRequest`, `completePasswordReset`. Service çağrısı + response. Business logic service'te.

### 5e. `password-reset-notifier.ts` 🇳

- `PasswordResetNotifier` interface: `enqueuePasswordResetEmail({ userId, emailDigest, resetUrl })`
- `createFakePasswordResetNotifier()` — no-op (queue altyapısı yok, kapsam dışı)

**İnceleme notu:** `app.types.ts`'teki structural tip ile bu interface uyumlu olmalı. Gerçek provider adapter'ı ileride `communication` modülünde.

### 5f. `account.limiter.ts` 🇳

Account-specific rate limiter factory. `express-rate-limit` + `rate-limit-redis` + explicit prefix.

- `createSessionCreationLimiters` — 5/15m IP+emailDigest + 50/15m IP
- `createPasswordResetRequestLimiters` — 3/1h IP+emailDigest + 20/1h IP
- `createPasswordResetCompletionLimiter` — 10/15m IP+route
- Prefix'ler: `idas:rl:account:session:*`, `idas:rl:account:reset:*`
- Email digest: SHA-256 (raw email değil)

**İnceleme notu:** `emailDigestFromBody` — `req.body?.email` (body parser'dan sonra çalışır). Limiter route seviyesinde, validateBody'den önce ama app.ts body parser'ından sonra.

### 5g. `account.routes.ts` 🇳

Route wiring. 5 endpoint:

| Method | Path | Middleware |
|--------|------|-----------|
| POST | `/session` | session limiters + validateBody + createSession |
| GET | `/session` | requireAuth + getSession |
| DELETE | `/session` | deleteSession |
| POST | `/password-reset-requests` | reset request limiters + validateBody + createPasswordResetRequest |
| POST | `/password-resets` | reset completion limiter + validateBody + completePasswordReset |

### 5h. `account.schemas.test.ts` 🇳

12 unit test (P4a): session schema, password reset schema, email normalize davranışı.

---

## 6. Wire-up — modül mount

| Dosya | Değişiklik | Amaç |
|-------|-----------|------|
| `src/routes/index.ts` | ✏️ | `/account` mount; `createAccountService` DI (db + redis + config + notifier); `createAccountRoutes`'a rateLimit config wiring; `passwordResetNotifier` slot → fake adapter fallback |

---

## 7. Test mock güncellemeleri

| Dosya | Değişiklik | Amaç |
|-------|-----------|------|
| `src/app.test.ts` | ✏️ | `createTestConfig` mock'una yeni auth alanları eklendi (bcryptRounds, passwordMinLength, corsAllowedOrigins, trustProxyHops, rateLimit) |
| `src/modules/authorization/__tests__/authorization.middleware.test.ts` | ✏️ | `createRoutes` mock'una `config.auth.rateLimit` eklendi (test kırılması düzeltmesi) |

---

## 8. Plan dokümanı

| Dosya | Değişiklik | Amaç |
|-------|-----------|------|
| `docs/9_AUTH_LOGIN_V2_PLAN.md` | ✏️ | User disable (ACTIVE→INACTIVE) invalidasyonu, `invalidateUserSessions(userId)` hook imzası, CSRF constant-time compare kuralı, trust proxy + proxy topolojisi netleştirmesi eklendi |

---

## Önerilen okuma sırası

Bağımlılık zincirini takip eder: **tipler ve sabitler → altyapı → config/DI → modül iç yapısı → mount → testler → plan**.

```
1.  package.json                              (bağımlılıklar)
2.  src/types/express.d.ts                    (Express.User augmentation — tip temeli)
3.  src/auth/password-policy.ts               (BCRYPT_ROUNDS + DUMMY_HASH sabitleri)
4.  src/auth/session.ts                       (idas:sess: prefix)
5.  src/auth/passport.ts                      (LocalStrategy + idempotent guard)
6.  src/config/env.ts                         (auth config genişletme)
7.  src/app.types.ts                          (PasswordResetNotifier DI slot)
8.  src/security/cors.ts                      (config'ten allowlist)
9.  src/app.ts                                (trust proxy + cors config)
10. src/modules/account/account.types.ts      (response DTO'ları)
11. src/modules/account/account.schemas.ts    (Zod validation)
12. src/modules/account/password-reset-notifier.ts  (interface + fake adapter)
13. src/modules/account/account.service.ts    (TÜM business logic — en büyük)
14. src/modules/account/account.limiter.ts    (rate limiter factory)
15. src/modules/account/account.controller.ts (HTTP mapping)
16. src/modules/account/account.routes.ts     (route wiring)
17. src/routes/index.ts                       (modül mount + DI)
18. src/modules/account/account.schemas.test.ts (unit testler)
19. src/app.test.ts                           (config mock güncellemesi)
20. src/modules/authorization/__tests__/authorization.middleware.test.ts (test mock)
21. docs/9_AUTH_LOGIN_V2_PLAN.md              (plan güncellemeleri)
```

---

## İnceleme odak noktaları

İnceleme sırasında özellikle şu noktalara dikkat:

1. **`account.service.ts` `createSessionWithPassword`** — raw SQL CASE ile atomic lock update. Kysely `sql` template doğru mu, race güvenli mi.
2. **`account.service.ts` `completePasswordReset`** — bcrypt hash transaction dışı, token re-check transaction içinde. Race condition kontratı.
3. **`passport.ts` verify vs `account.service.ts` createSessionWithPassword** — iki credential doğrulama yolu var. Route'ta hangisi kullanılıyor? Çakışma var mı?
4. **`account.limiter.ts`** — `req.body.email` erişimi body parser'dan sonra mı çalışıyor. `keyGenerator` async/sync uyumu.
5. **`express.d.ts` augmentation** — global augmentation'ın tüm dosyalara uygulandığı (tsc geçti ama runtime'da `req.user` shape).
6. **`password-policy.ts` BCRYPT_ROUNDS vs `env.ts` bcryptRounds** — ikisi uyumlu mu, cost drift riski.
7. **`invalidateUserSessions`** — `sMembers` + `del` atomic değil; race window'u var (okuma ile silme arasında login).
8. **CSRF compare** — `csrf.ts` hâlâ `===` (plan constant-time ister ama kod değiştirilmedi — Security Notes'a kural eklendi, implementasyon Phase 2a'da atlandı).

---

## Kapsam dışı bırakılanlar (bilinçli)

- **Cron**: expired token cleanup — `password_reset_tokens`'da expire token birikebilir
- **Queue**: fake `PasswordResetNotifier` senkron — gerçek email provider + queue altyapısı sonraki iş
- **Integration testleri (Redis)**: test Redis altyapısı kurulmadı — 136 mevcut test DI fake'lerle
- **Timing testleri**: opsiyonel/manuel — CI'da flaky olacak testler yazılmadı
