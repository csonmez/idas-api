# Auth & Login V2 Planı

## Summary

V2 auth/login mimarisi `passport` + `passport-local` ile local email/password kimlik doğrulaması yapacak; login state `express-session` üzerinden tutulacak ve session store olarak Redis kullanılacak.

Mevcut projede `express-session`, `connect-redis`, `passport`, Redis client, CSRF middleware ve temel `passport.serializeUser` / `deserializeUser` iskeleti hazır. Eksik ana parçalar `passport-local`, LocalStrategy, auth module route/controller/service katmanı, request validation, session invalidation ve auth middleware yüzeyidir.

`connect-redis` kullanılmaya devam edilmeli. `passport-redis` bu proje için önerilmiyor; Passport session persistence zaten `express-session` store üzerinden çözülüyor. `passport-redis` daha çok Passport'a özel ek session/cache stratejileri için değerlendirilebilir, fakat burada ihtiyaç net değil ve fazladan coupling yaratır.

## Implementasyon Öncesi Kilit Kararlar

Bu plan uygulanmaya başlanmadan önce aşağıdaki kararlar implementasyon kontratı olarak sabitlenir:

1. `POST /api/account/session` başarılı login response'u yeni authenticated session'a ait `csrfToken` döner. Client login sonrası ek `GET /api/csrf-token` çağırmak zorunda değildir. Pre-login CSRF token login sonrası mutating endpointlerde geçerli kabul edilmez.
2. `POST /api/account/password-reset-token-verifications` ilk fazda uygulanmaz. Reset token doğrulaması sadece `POST /api/account/password-resets` içinde yapılır. Ürün UX'i ayrı token pre-check gerektirirse endpoint sonraki fazda generic failure, sıkı rate limit ve no-raw-token logging kurallarıyla eklenebilir.
3. Account/auth-specific limiter ilk faz default değerleri açıkça tanımlanır ve test edilir:
  - Session creation: IP + normalized email digest için `5 attempt / 15 minutes`; ayrıca IP bazlı kaba koruma için `50 attempt / 15 minutes`.
  - Password reset request: IP + normalized email digest için `3 request / 1 hour`; ayrıca IP bazlı kaba koruma için `20 request / 1 hour`.
  - Password reset completion: IP + route için `10 request / 15 minutes`.
  - Production store hatasında credential brute force yüzeyinde fail-closed davranılır.
  - IP bazlı rate limit `req.ip`'nin gerçek client IP'sini yansıttığını varsayar; bu, `app.set('trust proxy', ...)` değerinin deployment proxy topolojisine göre ayarlanmasını önkoşul kılar. Tek hop'lı proxy (ör. sadece nginx) için `trust proxy: 1` yeterlidir; çok hop'lı topolojide (ör. CDN + nginx) doğru hop sayısı veya güvenilir proxy IP listesi ayarlanmazsa tüm trafik tek IP altında toplanır ve IP bazlı limit anlamsızlaşır. Proxy topolojisi ve `trust proxy` değeri deploy öncesi netleştirilmelidir; netleşene kadar IP bazlı limit değerlerinin yanıltıcı olabileceği bilinmelidir.
4. Redis session prefix kararı Phase 1/2'de uygulanır: mevcut `sess:` yerine auth v2 başlangıcında tek seferde `idas:sess:` kullanılacaktır. Henüz prod session olmadığı varsayımıyla ayrı migration/session-killing fazı planlanmaz; user-session index de ilk günden `idas:sess:<sid>` store key'lerini tutar.
5. Account limiter Redis keyspace'i global `/api` limiter'dan ayrılır. Global limiter default `rate-limit-redis` prefix'ini kullanabilir; account limiter'lar `idas:rl:account:*` gibi explicit prefix ile IP, emailDigest ve route key'lerini izole eder.
6. Password hashing bağımlılığı Phase 1'de kilitlenir. Deploy/CI uyumluluğu öncelikliyse varsayılan tercih `bcryptjs` olur; native `bcrypt` seçilecekse Docker/CI base image üzerinde prebuilt binary veya build toolchain doğrulanmadan Phase 1 tamamlanmış sayılmaz.
7. Password reset email gönderimi account service'e gömülmez. İlk fazda bile `NotificationAdapter` / `PasswordResetNotifier` benzeri bir interface üzerinden yapılır; gerçek provider hazır değilse test/dev için fake adapter kullanılır.
8. `configurePassport` idempotency stratejisi Phase 1'de çözülür. Tercih edilen yaklaşım module-level guard ile strategy/serializer tekrar register edilmesini engellemektir; alternatif olarak app bootstrap'ın tek çağrı garantisi testle ispatlanmalıdır.
9. Redis session invalidation failure policy net kabul edilir:
  - Logout sırasında session destroy başarılı ama index cleanup başarısızsa 204 dönebilir; cleanup hatası structured log/metric ile izlenir ve sonraki invalidation sırasında stale cleanup best-effort yapılır.
  - Password reset/password change sonrası active session invalidation başarısız olursa use-case security-complete kabul edilmez; ilk fazda hard failure döner ve password reset transaction'ı invalidation başarılı olmadan tamamlanmış sayılmaz.
  - User status `ACTIVE → INACTIVE` değişimi sonrası aktif session invalidation başarısız olursa aynı güvenlik-complete kontratı geçerlidir; invalidasyon hook'u hard failure döner. User'ı `INACTIVE` yapan user-management/admin endpoint'inin kendisi bu planın kapsamında değildir; plan yalnızca invalidasyon mekanizmasını (user-session index'i) ve failure policy'yi tanımlar, ilgili endpoint bu hook'u çağırmalıdır.
10. Mevcut test altyapısı `tsx --test src/**/*.test.ts` / Node test runner pattern'iyle devam eder. Vitest'e geçiş bu planın kapsamında değildir.

## İnceleme Bulguları



### V2 mevcut durum (`idas-api`)

- `package.json` içinde `express-session`, `connect-redis`, `passport`, `redis` ve `zod` mevcut.
- `src/auth/session.ts` RedisStore ile session saklıyor:
  - cookie adı: `idas.sid`
  - Redis prefix: `sess:`
  - `httpOnly`, env'e göre `secure`, `sameSite: lax`
  - `saveUninitialized: false`, `resave: false`
- `src/auth/passport.ts` sadece serialize/deserialize içeriyor:
  - session'a sadece user id yazılıyor.
  - deserialize `users` tablosundan `id` ve `status` okuyor.
  - `INACTIVE` kullanıcı deserialize edilirse session geçersiz sayılıyor.
- `src/app.ts` middleware sırası doğru temele sahip:
  - `/api` rate limit
  - body parser
  - session
  - `passport.initialize()`
  - `passport.session()`
  - CSRF
  - routes
- `src/auth/csrf.ts` unsafe method'larda session-bound CSRF token istiyor.
- `src/routes/index.ts` sadece `/api/csrf-token` sağlıyor; auth route'ları henüz yok.
- `src/http/errors.ts` nested error contract sağlıyor: `{ error: { code, message, details } }`.
- Migrationlar v2 auth modeliyle uyumlu:
  - `users`: domain user, `status` ile aktif/pasif kontrol.
  - `user_credentials`: password hash, login timestamps, failed count, lock state.
  - `password_reset_tokens`: raw token değil hash saklanacak operasyonel token tablosu.
  - `role_permissions`: global/scoped rol ve permission modeli.



### V1 mevcut durum (`../ardek/ardek-api`)

- V1 `source/app.ts` içinde tüm auth bootstrap tek dosyada toplanmış:
  - `express-session` + `connect-redis` kullanılıyor.
  - Redis session prefix `ardek:sess:`.
  - `passport-local` LocalStrategy kullanılıyor.
  - serialize session'a user id yazıyor.
  - deserialize user, rolePermissions ve userAcademicUnits dahil geniş safe user payload'ı yüklüyor.
- V1 login endpointleri:
  - `POST /login`
  - `POST /admin-login`
  - `DELETE /logout`
  - `POST /request-set-password`
  - `POST /forgot-password`
  - `POST /verify-password-token`
  - `POST /set-password`
- V1 LocalStrategy `users.email`, `users.password`, `users.isSetPassword`, `users.status` üzerinden çalışıyor.
- V1 password token modeli `users.temp.password` içinde raw token benzeri state tutuyor.
- V1 bazı auth failure durumlarında farklı status/code döndürüyor; bu email/account state enumeration riskini artırıyor.
- V1 controller response'ları nested v2 error contract ile uyumlu değil.
- V1 authorization middleware `req.isAuthenticated()` ve `req.user.rolePermissions` üzerine kurulu.



## Mimari Kararlar



### 1. Session store

`connect-redis` kullanılacak.

Gerekçe:

- Express session state için doğrudan `express-session` store adapter'ı.
- Mevcut v2 kodunda zaten entegre.
- V1'de çalışan pratik aynı yönde.
- Passport session mekanizması `req.login()` sonrasında sadece session içine user id serialize eder; ayrı Passport-specific Redis store gerektirmez.

`passport-redis` kullanılmayacak.

Gerekçe:

- Bu projedeki ihtiyaç session persistence; bunun doğru katmanı `express-session` store'dur.
- Passport strategy/session serialization katmanını Redis'e özel hale getirmek gereksiz bağımlılık ve belirsiz ownership yaratır.
- Session invalidation, Redis key prefix ve session id index'i ile app seviyesinde daha açık yönetilmelidir.



### 2. Passport stratejisi

`passport-local` eklenecek ve `src/auth/passport.ts` içinde configure edilecek.

- `usernameField: 'email'`
- `passwordField: 'password'`
- Email validation/normalization Zod schema'da yapılacak: `trim().toLowerCase()`.
- Strategy password kontrolünü `user_credentials.password_hash` üzerinden yapacak.
- Strategy başarıda minimal ama authorization için yeterli `AuthenticatedUser` dönecek.



### 3. Session payload

Session'a sadece `user.id` serialize edilecek.

Redis session içinde şunlar bulunabilir:

- Passport user id (`req.session.passport.user`)
- CSRF token (`req.session.csrfToken`)
- İleride session metadata gerekiyorsa minimal, non-sensitive alanlar

Session içinde password hash, role listesi, permission listesi, token veya PII snapshot tutulmayacak.

Kullanıcının fakülte, bölüm ve ana bilim dalı bilgisi session içinde saklanmamalı.

Gerekçe:

- Bu bilgiler authorization scope'u ve UI context'i için önemli, fakat canonical kaynak DB'deki `user_academic_affiliations`, `academic_units`, `departments`, `disciplines` ve `role_permissions` kayıtlarıdır.
- Session içine kopyalanırsa fakülte/bölüm/ABD değişikliklerinde stale session problemi oluşur.
- Kullanıcının görev/scope değişikliği güvenlik kararıdır; eski session'ın eski affiliation snapshot'ı ile yetki vermesi risklidir.
- Redis session payload büyüdükçe her request'te taşınan/deserialize edilen veri ve invalidation karmaşıklığı artar.
- Bu bilgiler PII olmasa bile domain-sensitive context'tir; session store'u cache değil, login state store'u olarak kullanılmalıdır.

Önerilen yaklaşım:

- Session sadece user id ve CSRF gibi session state tutsun.
- `deserializeUser` sadece minimal user payload'ını yüklesin; authorization için gereken güncel role/scope özeti `getCurrentUser`/authorization service gibi route/use-case seviyesindeki okumalarda DB'den alınsın.
- Performans ihtiyacı doğarsa affiliation/scope bilgisi session'a değil, kısa TTL'li ve explicit invalidation destekli ayrı bir cache'e konulsun.
- User affiliation veya role değiştiğinde ilgili kullanıcının aktif session'ları invalidate edilebilsin.



### 4. Request user modeli

`Express.User` tipi v2'ye özel olarak genişletilecek; ancak her request'te çalışan `deserializeUser` pahalı role/affiliation join'leriyle şişirilmemeli.

Önerilen minimal deserialize payload:

```ts
type AuthenticatedUser = {
  id: string
  email: string
  status: 'ACTIVE' | 'INACTIVE'
}
```

Bu tip runtime ile birebir uyumlu olmalıdır. Mevcut `passport.ts` sadece `id` ve `status` seçtiği için Phase 1'de `deserializeUser` query'si `users.email` alanını da seçmelidir veya tipten `email` çıkarılmalıdır. Bu planın tercihi `email` alanını deserialize payload'a dahil etmektir; `req.user.email` response/diagnostic context için kullanılabilir, fakat authorization kararları için role/scope yine ayrıca yüklenmelidir.

LocalStrategy `usernameField: 'email'` ile çalışacağı için Phase 1'de `users.email` canonical login identifier olarak doğrulanmalıdır. `user_credentials` tablosunda email yoktur; credential lookup `users.email` normalize edilmiş input ile bulunup `user_credentials.user_id` join'i üzerinden yapılmalıdır. Generated DB tiplerinde `users.email` mevcut olsa da migration/schema doğrulaması Phase 1 checklist'inin parçasıdır.

`GET /api/account/session` response'u ve authorization middleware'leri ihtiyaç duydukları role/scope özetini ayrıca DB'den veya ileride kısa TTL'li explicit invalidation destekli cache'ten okuyabilir.

Geniş auth context modeli response/service seviyesinde şu alanları içerebilir:

```ts
type AccountSessionUser = {
  id: string
  email: string
  name: string
  surname: string
  userType: 'ACADEMICIAN' | 'POSTDOC' | 'STAFF'
  title: string | null
  status: 'ACTIVE' | 'INACTIVE'
  roles: AuthenticatedRole[]
  affiliations: AuthenticatedAffiliation[]
}
```

Not: Deserialize her request'te çalışacağı için payload dengeli tutulmalı. Authorization için gereken role/scope bilgileri route/use-case ihtiyacına göre alınmalı; raporlama/domain listeleri gibi ağır veriler `req.user` içine otomatik yüklenmemeli.

### 5. Login failure davranışı

Tüm credential failure durumları generic dönecek:

```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "E-posta veya şifre hatalı.",
    "details": {}
  }
}
```

Aynı generic response kapsamı:

- User yok.
- User `INACTIVE`.
- Credential kaydı yok.
- Password yanlış.
- Account lock aktif.

Bu tercih email enumeration ve account state leakage riskini azaltır. Ancak generic response tek başına yeterli değildir; login path'i timing oracle üretmemelidir.

Timing oracle önlemi:

- User yok, user `INACTIVE` veya credential kaydı yok dallarında gerçek credential hash bulunmasa bile aynı cost factor ile üretilmiş sabit bir dummy bcrypt hash'e karşı `bcrypt.compare(password, DUMMY_HASH)` çalıştırılmalı ve sonuç yok sayılmalıdır.
- Amaç, gerçek credential varlığında çalışan bcrypt maliyetini no-user/no-credential dallarında da çalıştırarak email/account existence bilgisinin yanıt süresinden sızmasını zorlaştırmaktır.
- `DUMMY_HASH` runtime'da her request'te üretilmemeli; bcrypt rounds `12` ile önceden hesaplanmış sabit, non-secret bir hash olarak modül seviyesinde tutulmalıdır.
- Eğer password hash cost factor config'ten okunacaksa dummy hash aynı cost factor ile üretilmiş olmalıdır. Gerçek credential hash cost'u ile dummy hash cost'u ayrışırsa no-user/no-credential timing oracle tekrar oluşur; bu nedenle cost factor Phase 1'de sabitlenmeli veya config değiştiğinde dummy hash de aynı değerle güncellenmelidir.
- Locked account dalında password compare yapılmaması lock uzatma/DoS açısından doğru varsayılandır; tam zamanlama tekdüzeliği istenirse locked dalında da dummy compare çalıştırılabilir. Bu dal yine generic 401 döner ve failed count/lock süresini değiştirmez.

`audience: 'admin'` gibi role-gated session creation istenirse credential doğru ama yetki yoksa `403 FORBIDDEN` dönebilir; yine de response rol detayını sızdırmamalıdır.

### 6. Account lock

`user_credentials.failed_login_count` ve `locked_until` kullanılacak.

Önerilen politika:

- Başarısız password denemesi lock penceresi aktif değilse `failed_login_count += 1` yapar.
- 5. başarısız denemede `locked_until = now + 15 minutes` set edilir. Eşik semantiği `failed_login_count >= 5` lock anlamına gelir.
- Kilitliyken password compare yapılmaz.
- Kilitliyken failed count artırılmaz ve lock süresi uzatılmaz.
- `locked_until <= now` olduğunda eski lock süresi bitmiş kabul edilir. Bu durumda sonraki başarısız deneme eski `failed_login_count` üzerinden devam etmemeli; `failed_login_count = 1`, `locked_until = null` ile yeni failure penceresi başlatılmalıdır.
- Başarılı login: `last_login_at = now`, `failed_login_count = 0`, `locked_until = null`.

Concurrency için sadece state mutation kısmı atomik olmalı. `bcrypt.compare` hiçbir DB transaction veya row lock içinde çalıştırılmamalıdır; CPU-bound hash süresi boyunca DB row lock'u veya connection tutulmamalı. Önerilen akış: credential ve lock state'i oku, transaction/row-lock dışında bcrypt veya dummy compare çalıştır, ardından sonucu `failed_login_count`, `locked_until` ve `last_login_at` alanlarını atomik güncelleyen tek SQL `UPDATE`/upsert mantığıyla yaz.

Atomik başarısız login update algoritması:

1. Credential ve lock state'i okunur; `locked_until > now` ise compare yapılmadan generic failure döner ve state değiştirilmez.
2. Lock aktif değilse bcrypt compare transaction/row lock dışında çalıştırılır.
3. Compare başarısızsa DB tarafında tek atomik `UPDATE ... RETURNING` ile state güncellenir:
  - `locked_until <= now` veya eski lock süresi bitmişse yeni failure penceresi `failed_login_count = 1`, `locked_until = null` ile başlar.
  - Aktif pencere devam ediyorsa `failed_login_count = failed_login_count + 1` yapılır.
  - Yeni count `>= 5` ise `locked_until = now + 15 minutes` set edilir.
  - Update sonucu yeni `failed_login_count` ve `locked_until` döner; response yine generic 401 kalır.
4. Compare başarılıysa tek atomik `UPDATE` ile `last_login_at = now`, `failed_login_count = 0`, `locked_until = null` yazılır.
5. Aynı credential için concurrent başarısız denemelerde sayaç DB tarafında increment edilmelidir; application tarafında okunan eski count'a göre overwrite yapılmamalıdır.
6. Bu akış Kysely/Postgres implementation'ında `CASE` ifadeleri ve `RETURNING` ile yazılmalı; bcrypt maliyeti hiçbir transaction süresini uzatmamalıdır.

### 7. Session fixation ve CSRF lifecycle

Başarılı login mevcut anonymous session'ı authenticated session'a çevirmemeli; session id mutlaka rotate edilmelidir.

Zorunlu login lifecycle:

1. Client login öncesi `GET /api/csrf-token` ile pre-login CSRF token alır.
2. `POST /api/account/session` bu pre-login CSRF token ile çağrılır.
3. Credential doğrulaması ve account lock kontrolleri generic failure contract'a uygun yapılır.
4. Başarılı credential sonrası `req.session.regenerate()` veya eşdeğer session id rotation yapılır.
5. Rotation sonrası `req.login()` çağrılır ve Passport user id yeni session'a serialize edilir.
6. Authenticated session için yeni CSRF token üretilir.
7. Client login sonrası mutating request'lerde bu yeni authenticated CSRF token'ı kullanır.

Pre-login CSRF token sadece login request'ini authorize eder; authenticated session CSRF token'ı olarak yeniden kullanılmamalıdır. Login response'u yeni authenticated CSRF token'ı döner; client login sonrası tekrar `GET /api/csrf-token` çağırmak zorunda değildir.

`req.session.regenerate()` callback/Promise sequencing kritik implementation kontratıdır. `req.login()` ve yeni CSRF üretimi regenerate tamamlandıktan sonra, yeni session objesi üzerinde yapılmalıdır. Aksi halde CSRF token eski anonymous session'a yazılıp regenerate sırasında Redis'ten silinebilir. Controller/service helper bu sıralamayı tek yerde sarmalamalı:

```ts
await regenerateSession(req)
await loginUser(req, user)
const csrfToken = issueCsrfToken(req)
```

Callback API kullanılırsa `req.login()` ve `issueCsrfToken(req)` mutlaka `regenerate` callback'i içinde çağrılmalıdır; callback dışı fire-and-forget kullanım kabul edilmez.

Session regeneration sırasında eski anonymous session'dan veri körlemesine kopyalanmamalıdır. Taşınması gereken alan çıkarsa allowlist ile ve gerekçesiyle taşınmalıdır.

### 8. Password reset / ilk parola oluşturma

Mevcut `docs/1_USERS_ACCOUNTS_V2_PLAN.md` kararı korunacak:

- Ayrı invitation/set-password modeli yok.
- İlk parola oluşturma da forgot/reset password akışıyla yapılır.
- Raw reset token DB'de saklanmaz.
- DB'de sadece SHA-256 hex digest `password_reset_tokens.token_hash` tutulur.
- Reset token TTL ilk fazda `1 hour` olmalıdır; `expires_at = now + 1 hour` set edilir.
- Aynı user için tek aktif token DB unique constraint ile korunur.
- Yeni token üretilirken aynı user'a ait mevcut token hard delete edilip yeni token insert edilir; böylece yeni talep eski token'ı invalidate eder.
- Başarılı reset sonrası token hard delete edilir.
- Password reset/set sonrası kullanıcının aktif Redis session'ları invalidate edilir.
- Password reset/set sonrası `user_credentials.password_changed_at` güncellenir.

Password reset request timing güvenlik kontratı:

- `POST /api/account/password-reset-requests` user var/yok bilgisini sadece response gövdesinde değil, belirgin response süresi farkıyla da sızdırmamalıdır.
- User varsa token üretimi, DB write ve email enqueue gibi işler; user yoksa hiçbir şey yapmama gibi hızlı bir path gözlemlenebilir timing oracle oluşturabilir.
- İlk faz için tercih edilen yaklaşım response'u email gönderimi tamamlanmadan generic `204` ile döndürmek ve mail/token işini async queue/job üzerinden yürütmektir. Queue yoksa user var/yok dalları benzer operasyonel maliyet ve rate limit davranışına sahip olacak şekilde tasarlanmalıdır.
- Email gönderim hatası veya user yok durumu dış response'a yansımamalı; operasyonel log/metric raw email veya token içermeden tutulmalıdır.

Reset token doğrulama güvenlik kontratı:

- İlk fazda ayrı `POST /api/account/password-reset-token-verifications` endpoint'i uygulanmayacaktır; token doğrulaması sadece `POST /api/account/password-resets` completion endpoint'i içinde yapılır.
- Invalid, expired, deleted, daha önce kullanılmış veya user'ı inactive token dış response'ta aynı generic failure contract ile ele alınmalıdır.
- Password reset completion endpoint'i IP + route bazlı sıkı rate limit altında olmalıdır.
- Raw token hiçbir log, metric label, error details veya rate limit key içinde yer almamalıdır.
- Token hash üretimi canonical tek fonksiyon üzerinden yapılmalı; lookup raw token ile değil hash ile yapılmalıdır.
- Hash karşılaştırması timing sinyali üretmeyecek şekilde tasarlanmalıdır. DB lookup hash üzerinden yapılacağı için uygulama seviyesinde raw token/string compare gerekiyorsa constant-time compare kullanılmalıdır.
- Password reset completion sırasında yeni parola bcrypt hash'i token row lock veya DB transaction içinde hesaplanmamalıdır. Token geçerliliği ön kontrol edilir, bcrypt hash transaction dışında üretilir, ardından kısa transaction içinde token tekrar lock'lanıp halen geçerliyse credential upsert + token delete atomik yapılır.
- Race condition kontratı: Ön kontrolde geçerli görünen token, bcrypt hash üretilirken başka request tarafından kullanılır veya silinirse transaction içindeki tekrar kontrol başarısız olur; üretilmiş hash discard edilir ve dışarıya generic failure döner.
- Ürün UX'i ayrı token pre-check gerektirirse `POST /api/account/password-reset-token-verifications` sonraki fazda eklenebilir; bu endpoint valid/invalid/expired/used ayrımı sızdırmamalı, raw token loglamamalı ve IP + route bazlı sıkı rate limit altında olmalıdır.

Password reset email/notification adapter kontratı:

```ts
type PasswordResetNotifier = {
  enqueuePasswordResetEmail(input: {
    userId: string
    emailDigest: string
    resetUrl: string
  }): Promise<void>
}
```

- Account service doğrudan SMTP/provider client'a bağlanmamalı; bu interface dependency olarak inject edilmelidir.
- `resetUrl` sadece provider'a gönderilecek payload'da bulunmalı; structured log, metric label veya error details içinde raw token içeren URL yazılmamalıdır.
- Test/dev ortamında fake notifier kullanılabilir; production adapter mail gönderim hatalarını dış response'a yansıtmaz, structured log/metric ile izler.
- Queue altyapısı yoksa bile controller response'u mail gönderimi tamamlanana kadar beklememeli; notifier enqueue semantiğiyle tasarlanmalıdır.



## Önerilen API Yüzeyi

Public session/account lifecycle endpointleri `/api/account` altında olmalı. `auth` adlandırması teknik altyapı ve middleware katmanında korunmalı; dış API yüzeyinde kullanıcıya dönük hesap/oturum işlemleri `account` diliyle ifade edilmeli.

### Public account/session endpointleri

REST resource adlandırması için `login`, `logout`, `admin-login`, `forgot-password`, `reset-password` gibi fiil/action isimleri ana API yüzeyi olarak kullanılmamalı. Account session ve password reset akışları resource olarak modellenmeli.

Önerilen canonical endpointler:


| Method   | Path                                              | Amaç                                                  |
| -------- | ------------------------------------------------- | ----------------------------------------------------- |
| `POST`   | `/api/account/session`                            | Email/password ile current session oluşturur          |
| `GET`    | `/api/account/session`                            | Aktif session ve kullanıcı auth context özetini döner |
| `DELETE` | `/api/account/session`                            | Aktif session'ı sonlandırır                           |
| `POST`   | `/api/account/password-reset-requests`            | İlk parola veya reset token talebi oluşturur          |
| `POST`   | `/api/account/password-resets`                    | Token ile parola set/reset işlemini tamamlar          |


Notlar:

- `POST /api/account/session`, klasik `login` action'ının resource karşılığıdır: current authenticated session oluşturur.
- `DELETE /api/account/session`, klasik `logout` action'ının resource karşılığıdır: mevcut session kaynağını siler.
- `GET /api/account/session`, `/api/me` yerine tercih edilir; dönen kaynak aktif session'ın auth context'idir. İstenirse frontend ergonomisi için daha sonra `/api/users/me` veya `/api/me` ayrı bir user-profile/self-service resource olarak eklenebilir.
- `password-reset-requests` ve `password-resets` isimleri fiili URL'ye taşımadan account recovery akışını resource olarak ifade eder.
- Ayrı `password-reset-token-verifications` endpoint'i ilk fazda yoktur. Token geçerliliği `POST /api/account/password-resets` içinde doğrulanır. Ürün UX'i ayrı pre-check isterse sonraki fazda aynı generic failure ve rate limit kurallarıyla eklenebilir.
- Unauthenticated login dahil tüm unsafe account endpointleri CSRF ister. Client login öncesi `GET /api/csrf-token` çağırır, dönen token'ı configured CSRF header ile `POST /api/account/session` isteğinde gönderir. Başarılı login session id rotate ettiği için authenticated session yeni CSRF token kullanır ve bu token login response'unda döner.



### Admin panel login kararı

Admin paneli user panelinden ayrı bir frontend projesi olsa bile ayrı `admin-login` endpoint'i canonical yüzey olmamalı. Tek canonical endpoint `POST /api/account/session` olmalı.

Gerekçe:

- Kimlik doğrulama aynı credential mekanizmasıdır; admin/user ayrımı authentication değil authorization konusudur.
- İki ayrı login endpoint'i aynı password/lock/rate-limit/session logic'inin duplicate edilmesine yol açar.
- Ayrı endpoint zamanla farklı hata mesajı, farklı lock davranışı veya farklı session policy üreterek güvenlik drift'i yaratabilir.
- Admin panel ayrı proje olduğu için farklı frontend route ve farklı post-login yönlendirme kullanabilir; backend'de farklı authentication endpoint'i gerektirmez.

Önerilen akış:

1. Admin ve user frontend aynı `POST /api/account/session` endpoint'ine email/password gönderir.
2. Backend başarılı session oluşturur ve user'ın role/scope özetini döner.
3. Admin frontend response içinde admin/global/scoped manager yetkisi yoksa kendi içinde erişimi reddeder veya ayrı bir session-check endpoint'i olmadan admin API çağrılarında `403` alır.
4. Admin API route'ları mevcut authorization katmanındaki `requireAuth` + `requirePermission` / `requireScopedPermission` middleware ile korunur.

Opsiyonel olarak, admin panel login ekranında credential doğru ama admin yetkisi yoksa daha erken UX vermek için `POST /api/account/session` body içine `audience: 'admin' | 'user'` eklenebilir. Bu durumda endpoint yine aynı kalır; sadece session creation policy credential sonrası role check yapar. `audience: 'admin'` başarısız olursa `403 FORBIDDEN` döner, fakat credential failure yine generic `401 UNAUTHENTICATED` kalır. İlk fazda bu opsiyon ertelenebilir; daha güvenli varsayılan, başarılı credential sonrası session oluşturmak ve admin authorization kararını admin API route'larında vermektir.

### Response contract

Başarılı session creation ve `GET /api/account/session` response'u password/token içermemeli:

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.edu.tr",
    "name": "Ada",
    "surname": "Lovelace",
    "userType": "ACADEMICIAN",
    "title": "PROFESSOR",
    "status": "ACTIVE",
    "roles": [],
    "affiliations": []
  }
}
```

Login response'u yeni authenticated CSRF token'ı da döner:

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.edu.tr",
    "name": "Ada",
    "surname": "Lovelace",
    "userType": "ACADEMICIAN",
    "title": "PROFESSOR",
    "status": "ACTIVE",
    "roles": [],
    "affiliations": []
  },
  "csrfToken": "new-authenticated-session-csrf-token"
}
```

Client başarılı login sonrası ek `GET /api/csrf-token` çağırmak zorunda değildir. Login öncesi kullanılan CSRF token login sonrası mutating endpointlerde geçerli kabul edilmemelidir.

Session deletion:

```http
204 No Content
```

Password reset request her durumda generic olmalı:

```http
204 No Content
```

User yoksa, inactive ise veya email gönderilemese bile dış response enumeration yaratmamalı. Email gönderim hatası operasyonel log/metric olarak izlenmeli; kullanıcıya doğrudan account var/yok bilgisi verilmemeli.

## Modül Yapısı

Feature-based module yapısına uyumlu olarak kullanıcıya dönük account/session/password reset domain'i `src/modules/account` altında kurulmalı. Public route prefix'i `/api/account` olduğu için module adı da dış API diliyle uyumlu kalır.

Önerilen dosyalar:

```text
src/modules/account/
  account.routes.ts
  account.controller.ts
  account.service.ts
  account.schemas.ts
  account.types.ts
  password-policy.ts
  password-reset-token.ts
  session-invalidation.ts
  password-reset-notifier.ts
```

Mevcut cross-cutting auth bootstrap dosyaları korunmalı:

```text
src/auth/
  passport.ts        # Passport strategy + serialize/deserialize bootstrap
  session.ts         # express-session + connect-redis store
  csrf.ts            # session-bound CSRF
```

Bu ayrım şu ownership'i sağlar:

- `src/auth/*`: Express/Passport/session/CSRF altyapısı; public route adlandırmasını belirleyen domain katmanı değildir.
- `src/modules/account/*`: user-facing account/session/password reset use-case'leri ve HTTP API yüzeyi.

Authorization middleware'leri `account` modülünün parçası olmamalı. Authorization ayrı bir katmandır ve `src/modules/authorization/*` altında zaten uygulanmıştır (`requireAuth`, `requirePermission`, `requireScopedPermission`); bkz. `docs/braid/architecture/03-authorization/`. Account modülü hesap oturumu ve parola kurtarma lifecycle'ını yönetir; role/permission enforcement bu katmanın işi değildir.

`GET /api/account/session` ve login response DTO'ları authorization modülünün internal tiplerini doğrudan dışarı sızdırmamalı; account module kendi response DTO'sunu üretmelidir. İlk faz response shape'i:

```ts
type AccountSessionRole = {
  id: string
  role: string
  scopeType: 'GLOBAL' | 'ACADEMIC_UNIT' | 'DEPARTMENT' | 'DISCIPLINE'
  academicUnitId: string | null
  departmentId: string | null
  disciplineId: string | null
  permissions: string[]
}

type AccountSessionAffiliation = {
  id: string
  affiliationType: 'PRIMARY' | 'SECONDARY'
  academicUnitId: string | null
  departmentId: string | null
  disciplineId: string | null
}
```

Bu DTO'lar canonical permission kararının kaynağı değildir; sadece current session context response'udur. Route authorization kararları yine authorization middleware/service katmanında verilmelidir.

## Implementation Plan



### Phase 1 — Bootstrap ve tipler

1. `passport-local` ve `@types/passport-local` bağımlılıklarını ekle.
2. Password hashing implementasyonunu netleştir ve bağımlılığı ekle. Varsayılan tercih deploy/CI uyumluluğu için `bcryptjs` olmalıdır. Native `bcrypt` seçilecekse Docker/CI base image üzerinde prebuilt binary veya build toolchain doğrulanmadan bu faz tamamlanmış sayılmaz.
3. Password hash cost factor'ını ve aynı cost ile üretilmiş `DUMMY_HASH` değerini birlikte sabitle.
4. `src/types/express.d.ts` veya module augmentation ile `Express.User` ve `express-session` tiplerini tanımla.
5. `AuthenticatedUser` runtime shape'ini `id`, `email`, `status` olarak netleştir; `deserializeUser` query'si `users.email` alanını da seçmelidir.
6. `users.email` canonical login identifier ve `user_credentials.user_id` join path'ini migration/generated schema ile doğrula.
7. `createSessionMiddleware` RedisStore prefix'ini auth v2 başlangıcında `idas:sess:` yap; user-session index aynı store key formatına dayanacağı için bu karar sonraki faza bırakılmamalıdır.
8. `configurePassport` fonksiyonunu LocalStrategy kuracak şekilde genişlet.
9. App startup içinde `configurePassport({ db })` çağrısının net ve tek yerde yapıldığından emin ol.
10. `configurePassport` hot reload/test tekrarlarında strategy ve serializer davranışını duplicate register etmeyecek şekilde idempotent olmalıdır. İlk tercih module-level guard ile aynı process içinde tekrar registration'ı engellemektir; bootstrap single-call garantisi seçilirse bu davranış integration testle ispatlanmalıdır.

Risk: Düşük-orta. Mevcut `passport.ts` bootstrap için ayrılmıştır, ancak password hashing dependency ve Redis prefix kararı erken kilitlenmezse sonraki fazlarda migration/refactor maliyeti doğar.

### Phase 2a — Account session module

1. `account.schemas.ts` içinde session schemas oluştur.
2. `account.service.ts` içinde şu use-case'leri yaz:
  - `createSessionWithPassword`
  - `getCurrentSession`
  - `deleteCurrentSession`
3. `createSessionWithPassword` başarılı credential sonrası session id rotation yapmalı; eski anonymous session authenticated session'a yükseltilmemeli.
4. `req.session.regenerate()` tamamlanmadan `req.login()` veya `issueCsrfToken(req)` çağrılmamalı. Regenerate callback/Promise sırası helper ile tek yerde garanti altına alınmalıdır.
5. Login sonrası authenticated session için yeni CSRF token üretilmeli ve `POST /api/account/session` response'unda dönmelidir.
6. `session-invalidation.ts` minimal login/logout hali Phase 2a içinde eklenmeli:
  - Modül `invalidateUserSessions(userId: string): Promise<void>` imzasını export etmelidir; bu hook `idas:user-sessions:{userId}` set'inden ilgili kullanıcının tüm session store key'lerini siler ve set'i temizler. Password reset (Phase 2b) ve user status `ACTIVE → INACTIVE` değişimi (Phase 3) aynı hook'u çağırır; her iki çağıran da Kilit Karar #9'daki hard-failure kontratına tabidir.
  - Login sonrası final authenticated session key `idas:user-sessions:{userId}` index'ine yazılır.
  - Set içinde düz session id değil `idas:sess:<sid>` store key'i tutulur.
  - Logout ilgili session key'i index'ten temizler.
  - Store key `idas:sess:` + `req.sessionID` formatı connect-redis v9 davranışıyla test edilmelidir.
7. Redis failure policy logout için uygulanır: session destroy başarılı, index cleanup başarısız ise response 204 kalabilir; hata structured log/metric olur.
8. `account.controller.ts` sadece HTTP mapping yapsın; business logic service'te kalsın.
9. `account.routes.ts` route wiring yapsın.
10. `src/routes/index.ts` içine `/account` mount ekle.
11. Session creation limiter route seviyesinde eklenir. İlk faz defaultları: `5/15m` IP+emailDigest ve `50/15m` IP. Account limiter Redis keys global limiter'dan ayrı explicit prefix kullanmalıdır: ör. `idas:rl:account:session:*`.

Risk: Orta-yüksek. Login lock/update davranışı, session regeneration callback sırası, CSRF rotation ve Redis index consistency bu fazın ana riskidir.

### Phase 2b — Password reset module

1. `account.schemas.ts` içinde password reset schemas oluştur.
2. `account.service.ts` içinde şu use-case'leri yaz:
  - `createPasswordResetRequest`
  - `completePasswordReset`
3. `password-reset-notifier.ts` içinde `PasswordResetNotifier` interface'ini tanımla ve account service'e dependency olarak inject et; service doğrudan SMTP/provider client'a bağlanmamalı.
4. `completePasswordReset` aynı `session-invalidation.ts` modülü üzerinden kullanıcının mevcut session'larını invalidate eder.
5. `completePasswordReset`, session invalidation çalışmadan security-complete kabul edilmemeli.
6. Redis failure policy password reset için uygulanır: password reset/password change sonrası session invalidation başarısız ise use-case hard failure döner ve security-complete sayılmaz.
7. Password reset limiter'ları route seviyesinde ekle. İlk faz defaultları: reset request `3/1h` IP+emailDigest ve `20/1h` IP; reset completion `10/15m` IP+route. Account limiter Redis keys global limiter'dan ayrı explicit prefix kullanmalıdır: ör. `idas:rl:account:reset:*`.

Risk: Orta-yüksek. Reset token lifecycle, notifier enqueue semantics, timing oracle, token race condition ve Redis invalidation failure policy bu fazda birlikte test edilmelidir.

### Phase 3 — Session invalidation hardening

1. Phase 2a/2b'de eklenen minimal user-session index lifecycle'ını harden et:
  - Login sonrası Redis set: `idas:user-sessions:{userId}` -> session store keys.
  - Set içinde düz session id yerine store key tut: ör. `idas:sess:<sid>`.
  - Index'e sadece session regeneration sonrası oluşan final authenticated session key eklenir.
  - Logout/session destroy callback'i başarılı olduğunda ilgili session key set'ten kaldırılır.
  - Password reset sonrası set'teki session keys silinir ve `idas:user-sessions:{userId}` set'i temizlenir.
  - Password reset/password change sonrası current session dahil tüm session'ların tekrar login gerektirmesi bilinçli güvenlik kararıdır.
  - User status `ACTIVE → INACTIVE` değişimi sonrası aynı set temizliği uygulanır; disable edilen kullanıcının aktif session'ları invalidate edilir. `deserializeUser` `INACTIVE` user'ı zaten reddeder, ancak Redis session ancak bir sonraki request'te düşer; index temizliği disable anında aktif session'ları hemen düşürür. User'ı `INACTIVE` yapan user-management/admin endpoint'i bu planın kapsamında değildir; plan yalnızca invalidasyon hook'unu (index mekanizması + failure policy) sağlar ve ilgili endpoint invalidasyonu aynı hook üzerinden çağırmalıdır.
  - `idas:user-sessions:{userId}` set'ine session max age ile uyumlu TTL verilir veya login/logout/reset sırasında best-effort stale cleanup yapılır.
  - TTL ile kendiliğinden düşmüş stale session key'ler invalidation sırasında sorun sayılmaz; set cleanup best-effort yapılır.
2. Session id rotation olduğunda eski anonymous session key index'e eklenmemeli; eski session destroy/regenerate sonucundaki Redis cleanup test edilmelidir.
3. Alternatif olarak prefix scan ile user session bulma yaklaşımı sadece düşük hacimli admin operasyonları için değerlendirilebilir; ana tasarım indexed olmalı.

Risk: Orta. Minimal invalidation Phase 2a/2b kapsamındadır; Phase 3 Redis key lifecycle, TTL, stale cleanup, session id rotation edge-case'leri ve session id temizliğini harden eder. Session store prefix değişikliği bu faza bırakılmaz; `idas:sess:` Phase 1/2a'da uygulanmış olmalıdır.

> Not: Authorization middleware (`requireAuth`, `requirePermission`, `requireScopedPermission`) bu planın kapsamı değildir; ayrı authorization fazında `src/modules/authorization/*` altında uygulanmıştır. Bkz. `docs/braid/architecture/03-authorization/`. Account endpointleri korunması gerektiğinde bu mevcut middleware'ler kullanılır.

### Phase 4 — Testler

Öncelikli testler:

- `deserializeUser` runtime payload'ı `AuthenticatedUser` tipiyle uyumludur ve `id`, `email`, `status` döner.
- LocalStrategy credential lookup `users.email` + `user_credentials.user_id` join path'i üzerinden çalışır.
- Redis session store prefix'i auth v2 başlangıcında `idas:sess:` olur; user-session index `idas:sess:<sid>` store key'lerini tutar.
- Login success session cookie üretir.
- Login success Redis-backed session ile `GET /api/account/session` döner.
- Login success session id rotate eder; pre-login anonymous session id authenticated session id olarak kalmaz.
- `req.login()` ve `issueCsrfToken(req)` sadece `req.session.regenerate()` tamamlandıktan sonra yeni session üzerinde çalışır.
- Login sonrası pre-login CSRF token mutating endpointlerde geçerli olmaz.
- Login response'u yeni authenticated `csrfToken` döner.
- Login sonrası yeni authenticated CSRF token ile unsafe account endpointleri çalışır.
- Yanlış email/password aynı generic 401 response'u döner.
- Inactive user generic 401 response'u döner.
- Credential olmayan user generic 401 response'u döner.
- User yok/inactive/credential yok dallarında dummy bcrypt compare çalışır; response timing belirgin account existence oracle üretmez.
- Dummy bcrypt hash cost factor gerçek credential hash cost factor ile aynıdır.
- Failed count 5. başarısız denemede lock set eder.
- Lock süresi dolduktan sonraki ilk başarısız deneme yeni failure penceresini `failed_login_count = 1` ile başlatır.
- Bcrypt compare DB transaction/row lock dışında çalışır; sadece state mutation atomik update ile yapılır.
- Concurrent başarısız login denemeleri failed count'u application-side overwrite yapmadan DB tarafında atomik increment eder.
- Locked account password compare yapmadan generic 401 döner.
- Başarılı login failed count ve lock state'i temizler.
- Logout session destroy eder ve user-session Redis index'inden session key'i temizler.
- Password reset sonrası eski session `GET /api/account/session` için 401 olur.
- Password reset sonrası user-session Redis index'i temizlenir.
- Password reset sırasında Redis session invalidation başarısız olursa use-case hard failure döner.
- User status `ACTIVE → INACTIVE` yapıldıktan sonra kullanıcının aktif session'ı `GET /api/account/session` için 401 olur.
- User disable sonrası user-session Redis index'i temizlenir.
- User disable sonrası Redis session invalidation başarısız olursa invalidasyon hook'u hard failure döner.
- Logout sırasında session destroy başarılı ama index cleanup başarısızsa 204 döner ve structured log/metric üretilir.
- Password reset token DB'de raw değil hash olarak saklanır.
- Password reset completion invalid/expired/used/user inactive token durumlarında detay sızdırmaz.
- Password reset completion endpoint'i rate limit altındadır.
- Ayrı password reset token verification endpoint'i ilk fazda mount edilmez.
- CSRF token olmadan unsafe account mutation endpointleri 403 döner.
- `POST /api/account/password-reset-requests` user yokken de 204 döner.
- Password reset request path'i user var/yok dallarında belirgin timing oracle üretmez.
- Password reset request mail/provider client'a doğrudan bağlanmaz; injected fake `PasswordResetNotifier` üzerinden enqueue çağrısı test edilir.
- Password reset completion ön kontrol sonrası token başka request tarafından kullanılırsa transaction içi tekrar kontrol generic failure döner ve yeni hash persist edilmez.
- Reset token TTL `1 hour` olarak set edilir ve yeni reset talebi aynı user'ın eski token'ını invalidate eder.
- Account-specific rate limit generic response contract ile çalışır ve email/account existence sızdırmaz.
- Account-specific Redis limiter keyspace'i global `/api` limiter'dan explicit prefix ile ayrılır (`idas:rl:account:*`).
- Account-specific limiter testleri sayaç state'ini testler arasında izole eder; Redis/fake Redis veya resetlenebilir injected limiter kullanılır.
- Allowed CORS origin credentials ile çalışır; disallowed origin reddedilir.

Risk: Düşük-orta. Testlerde Redis dependency ve auth limiter sayaç izolasyonu için fake store, test Redis veya resetlenebilir dependency injection stratejisi netleştirilmeli.

## Dependency Graph

```text
config/env.ts
  ├─ auth/session.ts ── redis/client.ts
  ├─ auth/passport.ts ── database/client.ts
  └─ modules/account/*
        ├─ database queries: users, user_credentials, password_reset_tokens, role_permissions
        ├─ auth/session invalidation ── redis/client.ts
        ├─ account/password policy
        └─ communication/mail service (ileride)

app.ts
  ├─ session middleware
  ├─ passport initialize/session
  ├─ csrf middleware
  └─ routes/index.ts ── modules/account/account.routes.ts
```



## V1'den Taşınacaklar

Taşınacak fikirler:

- Passport LocalStrategy kullanımı.
- Session'a sadece user id serialize edilmesi.
- Login sonrası safe user payload dönülmesi.
- Role/permission kararlarının authorization katmanında DB/cache üzerinden verilmesi; `req.user` sadece minimal `id`, `email`, `status` payload'ı taşımalıdır.
- Redis-backed session store.

Taşınmayacak uygulamalar:

- Auth bootstrap'ın `app.ts` içinde büyümesi.
- `users.password` ve `users.isSetPassword` modeli.
- `users.temp.password` içinde token state tutulması.
- Raw token lookup.
- Account/user state'e göre ayrışan login hata response'ları.
- Nested olmayan `{ code: 'AUTHx001' }` error response'ları.
- CORS'ta production'da blocked origin'e izin verme davranışı.



## Security Notes

- Password hash için Phase 1'de seçilen bcrypt-compatible implementasyon kullanılacak; deploy/CI uyumluluğu nedeniyle varsayılan tercih `bcryptjs`, native `bcrypt` için Docker/CI doğrulaması zorunludur. v2 planındaki rounds `12` korunacak.
- Password minimum uzunluğu `15` karakter olmalı.
- Bcrypt 72-byte limiti nedeniyle `Buffer.byteLength(password, 'utf8') <= 72` kontrolü yapılmalı.
- Password schema ayrıca maksimum karakter/byte sınırı koymalı; body limit tek başına password policy yerine geçmemeli.
- Password reset/set sonrası `password_changed_at` güncellenmeli.
- Password unicode normalization kararı netleştirilmeli; ilk fazda en azından byte limit ve validation mesajları aynı canonical ölçüme dayanmalı.
- Session cookie `httpOnly` kalmalı.
- Production'da `secure: true` kalmalı.
- Mevcut `sessionMaxAgeMs = 24h` absolute timeout olarak ele alınmalı; rolling/idle timeout isteniyorsa ayrıca tasarlanmalı.
- Başarılı login session id rotate etmeli ve authenticated session için yeni CSRF token üretilmeli.
- CSRF token karşılaştırması sabit zamanlı yapılmalıdır; `===` gibi kısa-devre string compare yerine `crypto.timingSafeEqual` kullanılmalıdır (önce her iki tarafın aynı uzunlukta olduğu doğrulanmalı, aksi halde `timingSafeEqual` throw eder). Bu kural reset token compare kuralıyla tutarlıdır; CSRF token da her mutating request'te karşılaştırılan bir secret'tır ve timing side-channel'e açık bırakılmamalıdır.
- Cross-site frontend gerekiyorsa `sameSite: 'none'` + `secure: true` zorunludur; mevcut `lax` kararı aynı-site/subpath deployment için uygundur. Deployment topolojisi kesinleşince env ile ayarlanabilir hale getirilmeli.
- Production CORS origin allowlist env/config üzerinden yönetilmeli; `credentials: true` ile wildcard origin asla kullanılmamalı.
- Login ve password reset endpointleri global `/api` rate limit dışında auth/account-specific daha düşük rate limit altında kalmalı. Login için IP + normalized email digest bazlı; password reset request için IP + normalized email digest bazlı; reset completion için IP + route bazlı limit uygulanır.
- Rate limit key'lerinde normalized email doğrudan saklanmamalı; HMAC veya SHA-256 digest gibi non-raw temsil kullanılmalı.
- Production'da auth/account rate limit store hatasında fail-open/fail-closed kararı açık olmalı; credential brute force yüzeyinde fail-closed tercih edilmelidir.
- Auth/account-specific limiter'ın environment davranışı explicit olmalıdır: production Redis-backed ve fail-closed çalışmalı; dev/test için Redis-backed fake/test Redis veya inject edilebilir resetlenebilir memory limiter seçimi belgelenmelidir.
- Account limiter Redis keys global `/api` limiter keyspace'iyle karışmamalıdır; account limiter için explicit prefix kullanılmalıdır (`idas:rl:account:*`).
- CSRF middleware login/logout/reset gibi cookie-auth state değiştiren endpointlerde aktif kalmalı. İlk CSRF token için `/api/csrf-token` kullanılmaya devam edilebilir.
- Logs hiçbir zaman password, raw reset token, session id veya cookie değeri içermemeli.
- HTTP logger/redaction config `cookie`, `authorization`, CSRF header, password alanları ve token alanlarını redact etmelidir.
- Auth operational logları structured olmalı, ancak email/token/session id gibi değerleri raw değil redacted veya digest olarak içermelidir.
- Login failure, account lock, password reset request accepted/enqueued, password reset completed ve session invalidation failure olayları structured log/metric olarak izlenmelidir.
- Metric/log label'larında raw email yerine digest, raw token yerine event outcome, session id yerine redacted/sessionless correlation kullanılmalıdır.



## Open Decisions

1. Frontend/API aynı site mi çalışacak, yoksa cross-site cookie gerekiyor mu?
  - Aynı site: `sameSite: 'lax'` yeterli.
  - Cross-site: `sameSite: 'none'`, `secure: true`, CORS credentials/origin allowlist zorunlu.
2. Auth limiter dev/test ortamlarında hangi store ile çalışacak ve testlerde sayaç state'i nasıl izole edilecek?
  - Rate limit değerleri, production fail-closed davranışı ve account limiter prefix kararı Implementasyon Öncesi Kilit Kararlar bölümünde sabitlenmiştir.
  - Testlerde production ile aynı davranış için test Redis/fake Redis kullanmak veya limiter'ı dependency injection ile resetlenebilir kılmak gerekir.
3. Email provider/queue altyapısının production adapter'ı hangi modülde kurulacak?
  - Account service doğrudan provider'a bağlanmaz; ilk fazda `PasswordResetNotifier` interface'i kullanılır.
  - Gerçek provider adapter'ı ileride `communication`/`notifications` modülünde kurulmalıdır.
4. Admin panel ayrı frontend olduğu için ayrı auth endpoint gerekir mi?
  - Hayır. Canonical endpoint tek kalmalı: `POST /api/account/session`. Admin/user ayrımı authentication değil authorization kararıdır. Gerekirse aynı endpoint body içinde opsiyonel `audience: 'admin'` desteklenebilir, fakat ilk fazda route-level authorization ile yetinmek daha güvenli varsayılandır.
5. Password unicode normalization politikası ne olacak?
  - İlk fazda en azından byte limit, validation ve hashing aynı canonical input'a dayanmalı; daha kapsamlı normalization/blocklist politikası ayrı password policy kararı olarak ele alınabilir.
6. Session timeout modeli absolute mı idle/rolling mi olacak?
  - Mevcut `sessionMaxAgeMs = 24h` absolute timeout varsayımıdır. Admin paneli için ayrıca idle timeout veya daha kısa session süresi isteniyorsa auth/session config ve testleri buna göre genişletilmelidir.



## Rollback Strategy

- Phase 1 rollback: `passport-local` strategy wiring ve `idas:sess:` prefix kararı geri alınacaksa Redis test/prod session etkisi ayrıca değerlendirilir. Auth v2 başlangıcında prod session olmadığı varsayımıyla prefix rollback beklenen bir operasyon değildir.
- Phase 2a rollback: `/api/account/session` route mount kaldırılır; mevcut API yüzeyi etkilenmez. `idas:sess:` prefix kararı korunur veya bilinçli session-killing rollback olarak ele alınır.
- Phase 2b rollback: password reset route mount kaldırılır. Password reset endpoint'i yayında kalacaksa minimal user-session invalidation geri alınmamalıdır.
- Phase 3 rollback: user-session Redis index hardening/TTL/stale cleanup iyileştirmeleri devre dışı bırakılır; Phase 2a/2b minimal invalidation korunur.



## Exit Criteria

- `deserializeUser` `AuthenticatedUser` runtime shape'iyle uyumlu şekilde `id`, `email`, `status` döner.
- LocalStrategy login lookup'ı `users.email` canonical kaynağı ve `user_credentials.user_id` join'i üzerinden çalışır.
- Redis session store prefix'i auth v2 başlangıcında `idas:sess:` olur ve user-session index aynı store key formatını kullanır.
- `POST /api/account/session` başarılı credential ile session cookie üretir.
- `POST /api/account/session` başarılı login sırasında session id rotate eder.
- `req.login()` ve yeni CSRF üretimi session regenerate tamamlandıktan sonra yeni session üzerinde yapılır.
- Login sonrası authenticated session için yeni CSRF token üretilir ve `POST /api/account/session` response'unda döner.
- `GET /api/account/session` session ile kullanıcıyı ve role/scope özetini döner.
- `DELETE /api/account/session` session'ı destroy eder ve Redis user-session index'ini temizler.
- Session creation failure durumları generic nested error contract ile döner.
- No-user, inactive-user ve no-credential login dalları dummy bcrypt compare ile timing oracle riskini azaltır.
- Password reset token DB'de raw saklanmaz.
- Password reset completion invalid/expired/used/user inactive token durumlarında token/account state detayı sızdırmaz.
- Ayrı password reset token verification endpoint'i ilk fazda bulunmaz.
- Password reset sonrası kullanıcının mevcut Redis session'ları invalidate edilir.
- User status `ACTIVE → INACTIVE` değişimi sonrası kullanıcının aktif Redis session'ları invalidate edilir.
- Account-specific rate limit login/reset endpointlerinde global limiter'dan ayrı çalışır ve Redis keyspace'i explicit `idas:rl:account:*` prefix'iyle izole edilir.
- Auth logs password, raw reset token, session id, cookie ve CSRF token içermez.
- Auth operational log/metric'leri login failure, account lock, password reset enqueue/completion ve session invalidation failure olaylarını raw secret/PII sızdırmadan izler.
- Password reset request `PasswordResetNotifier` adapter'ı üzerinden enqueue edilir; account service provider'a doğrudan bağlanmaz.
- Account route'ları Zod validation kullanır.
- `tsc --noEmit` ve auth integration testleri geçer.

