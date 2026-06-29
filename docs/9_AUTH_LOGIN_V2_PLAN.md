# Auth & Login V2 Planı

## Summary

V2 auth/login mimarisi `passport` + `passport-local` ile local email/password kimlik doğrulaması yapacak; login state `express-session` üzerinden tutulacak ve session store olarak Redis kullanılacak.

Mevcut projede `express-session`, `connect-redis`, `passport`, Redis client, CSRF middleware ve temel `passport.serializeUser` / `deserializeUser` iskeleti hazır. Eksik ana parçalar `passport-local`, LocalStrategy, auth module route/controller/service katmanı, request validation, session invalidation ve auth middleware yüzeyidir.

`connect-redis` kullanılmaya devam edilmeli. `passport-redis` bu proje için önerilmiyor; Passport session persistence zaten `express-session` store üzerinden çözülüyor. `passport-redis` daha çok Passport'a özel ek session/cache stratejileri için değerlendirilebilir, fakat burada ihtiyaç net değil ve fazladan coupling yaratır.

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
- `deserializeUser` veya `getCurrentUser` authorization için gereken güncel role/scope özetini DB'den okusun.
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

Pre-login CSRF token sadece login request'ini authorize eder; authenticated session CSRF token'ı olarak yeniden kullanılmamalıdır. Login response'u yeni CSRF token'ı dönebilir veya client login sonrası tekrar `GET /api/csrf-token` çağırabilir. Hangi akış seçilirse seçilsin client contract açıkça belgelenmelidir.

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

- `POST /api/account/password-reset-token-verifications` sadece token geçerliliği için kullanılacaksa valid/invalid/expired/used ayrımı response detaylarında sızdırılmamalıdır.
- Invalid, expired, deleted veya user'ı inactive token dış response'ta aynı generic failure contract ile ele alınmalıdır.
- Token verification ve password reset completion endpointleri IP + route bazlı sıkı rate limit altında olmalıdır.
- Raw token hiçbir log, metric label, error details veya rate limit key içinde yer almamalıdır.
- Token hash üretimi canonical tek fonksiyon üzerinden yapılmalı; lookup raw token ile değil hash ile yapılmalıdır.
- Hash karşılaştırması timing sinyali üretmeyecek şekilde tasarlanmalıdır. DB lookup hash üzerinden yapılacağı için uygulama seviyesinde raw token/string compare gerekiyorsa constant-time compare kullanılmalıdır.
- Password reset completion sırasında yeni parola bcrypt hash'i token row lock veya DB transaction içinde hesaplanmamalıdır. Token geçerliliği ön kontrol edilir, bcrypt hash transaction dışında üretilir, ardından kısa transaction içinde token tekrar lock'lanıp halen geçerliyse credential upsert + token delete atomik yapılır.
- Verification endpoint'i ürün ihtiyacı değilse ilk fazda kaldırılıp token kontrolü sadece `POST /api/account/password-resets` içinde yapılabilir; ayrı endpoint kalacaksa yukarıdaki rate limit ve generic response kuralları zorunludur.



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
| `POST`   | `/api/account/password-reset-token-verifications` | Reset token geçerliliğini kontrol eder                |
| `POST`   | `/api/account/password-resets`                    | Token ile parola set/reset işlemini tamamlar          |


Notlar:

- `POST /api/account/session`, klasik `login` action'ının resource karşılığıdır: current authenticated session oluşturur.
- `DELETE /api/account/session`, klasik `logout` action'ının resource karşılığıdır: mevcut session kaynağını siler.
- `GET /api/account/session`, `/api/me` yerine tercih edilir; dönen kaynak aktif session'ın auth context'idir. İstenirse frontend ergonomisi için daha sonra `/api/users/me` veya `/api/me` ayrı bir user-profile/self-service resource olarak eklenebilir.
- `password-reset-requests` ve `password-resets` isimleri fiili URL'ye taşımadan account recovery akışını resource olarak ifade eder.
- Unauthenticated login dahil tüm unsafe account endpointleri CSRF ister. Client login öncesi `GET /api/csrf-token` çağırır, dönen token'ı configured CSRF header ile `POST /api/account/session` isteğinde gönderir. Başarılı login session id rotate ettiği için authenticated session yeni CSRF token kullanmalıdır; login response'u token dönebilir veya client login sonrası tekrar `GET /api/csrf-token` çağırabilir.



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

Login response'u yeni authenticated CSRF token'ı dönecek şekilde tasarlanırsa response şu alanı da içerebilir:

```json
{
  "csrfToken": "new-authenticated-session-csrf-token"
}
```

Alternatif olarak login response'u CSRF token dönmez ve client başarılı login sonrası `GET /api/csrf-token` ile yeni token alır. İlk fazda hangi seçenek seçilirse frontend contract ve integration testleri aynı kararı takip etmelidir. Login öncesi kullanılan CSRF token login sonrası mutating endpointlerde geçerli kabul edilmemelidir.

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

## Implementation Plan



### Phase 1 — Bootstrap ve tipler

1. `passport-local` ve `@types/passport-local` bağımlılıklarını ekle.
2. Password hashing implementasyonunu netleştir ve bağımlılığı ekle: native `bcrypt` + `@types/bcrypt` veya deploy/CI uyumluluğu öncelikliyse `bcryptjs`.
3. `src/types/express.d.ts` veya module augmentation ile `Express.User` ve `express-session` tiplerini tanımla.
4. `configurePassport` fonksiyonunu LocalStrategy kuracak şekilde genişlet.
5. App startup içinde `configurePassport({ db })` çağrısının net ve tek yerde yapıldığından emin ol.
6. `configurePassport` hot reload/test tekrarlarında strategy ve serializer davranışını duplicate register etmeyecek şekilde idempotent olmalı veya bootstrap tarafından tek çağrı garantisi verilmelidir.

Risk: Düşük. Mevcut `passport.ts` zaten bootstrap için ayrılmış. Native `bcrypt` seçilirse CI/Docker build ortamı ayrıca doğrulanmalı.

### Phase 2 — Account module

1. `account.schemas.ts` içinde Zod session/password reset schemas oluştur.
2. `account.service.ts` içinde şu use-case'leri yaz:
  - `createSessionWithPassword`
  - `getCurrentSession`
  - `deleteCurrentSession`
  - `createPasswordResetRequest`
  - `verifyPasswordResetToken`
  - `completePasswordReset`
3. `createSessionWithPassword` başarılı credential sonrası session id rotation yapmalı; eski anonymous session authenticated session'a yükseltilmemeli.
4. Login sonrası authenticated session için yeni CSRF token üretilmeli veya client'ın login sonrası yeni token alacağı açık contract uygulanmalı.
5. `session-invalidation.ts` minimal hali Phase 2 içinde eklenmeli:
  - Login sonrası final authenticated session key `idas:user-sessions:{userId}` index'ine yazılır.
  - Logout ilgili session key'i index'ten temizler.
  - `completePasswordReset` aynı modül üzerinden kullanıcının mevcut session'larını invalidate eder.
6. `completePasswordReset`, session invalidation çalışmadan security-complete kabul edilmemeli. Password reset use-case'i Phase 2'de yer aldığı için minimal invalidation da Phase 2 kapsamındadır.
7. `account.controller.ts` sadece HTTP mapping yapsın; business logic service'te kalsın.
8. `account.routes.ts` route wiring yapsın.
9. `src/routes/index.ts` içine `/account` mount ekle.
10. Account-specific rate limit middleware'lerini route seviyesinde ekle; global `/api` limiter login/reset güvenliği için yeterli kabul edilmemeli.

Risk: Orta. Login lock/update davranışı, session regeneration, CSRF rotation, session invalidation ve generic response contract dikkat ister.

### Phase 3 — Session invalidation hardening

1. Redis session prefix standardize et: ör. `idas:sess:`.
  - Mevcut `sess:` prefix'inden `idas:sess:` prefix'ine geçiş mevcut Redis session'ları geçersiz kılar. Bu auth migration sırasında kabul edilebilir bir session-killing değişiklik olarak ele alınmalı.
2. Phase 2'de eklenen minimal user-session index lifecycle'ını harden et:
  - Login sonrası Redis set: `idas:user-sessions:{userId}` -> session store keys.
  - Set içinde düz session id yerine store key tut: ör. `idas:sess:<sid>`.
  - Index'e sadece session regeneration sonrası oluşan final authenticated session key eklenir.
  - Logout/session destroy callback'i başarılı olduğunda ilgili session key set'ten kaldırılır.
  - Password reset sonrası set'teki session keys silinir ve `idas:user-sessions:{userId}` set'i temizlenir.
  - Password reset/password change sonrası current session dahil tüm session'ların tekrar login gerektirmesi bilinçli güvenlik kararıdır.
  - `idas:user-sessions:{userId}` set'ine session max age ile uyumlu TTL verilir veya login/logout/reset sırasında best-effort stale cleanup yapılır.
  - TTL ile kendiliğinden düşmüş stale session key'ler invalidation sırasında sorun sayılmaz; set cleanup best-effort yapılır.
3. Session id rotation olduğunda eski anonymous session key index'e eklenmemeli; eski session destroy/regenerate sonucundaki Redis cleanup test edilmelidir.
4. Alternatif olarak prefix scan ile user session bulma yaklaşımı sadece düşük hacimli admin operasyonları için değerlendirilebilir; ana tasarım indexed olmalı.

Risk: Orta. Minimal invalidation Phase 2 kapsamındadır; Phase 3 Redis key lifecycle, TTL, stale cleanup, session id rotation edge-case'leri ve session id temizliğini harden eder.

> Not: Authorization middleware (`requireAuth`, `requirePermission`, `requireScopedPermission`) bu planın kapsamı değildir; ayrı authorization fazında `src/modules/authorization/*` altında uygulanmıştır. Bkz. `docs/braid/architecture/03-authorization/`. Account endpointleri korunması gerektiğinde bu mevcut middleware'ler kullanılır.

### Phase 4 — Testler

Öncelikli testler:

- Login success session cookie üretir.
- Login success Redis-backed session ile `GET /api/account/session` döner.
- Login success session id rotate eder; pre-login anonymous session id authenticated session id olarak kalmaz.
- Login sonrası pre-login CSRF token mutating endpointlerde geçerli olmaz.
- Login sonrası yeni authenticated CSRF token ile unsafe account endpointleri çalışır.
- Yanlış email/password aynı generic 401 response'u döner.
- Inactive user generic 401 response'u döner.
- Credential olmayan user generic 401 response'u döner.
- User yok/inactive/credential yok dallarında dummy bcrypt compare çalışır; response timing belirgin account existence oracle üretmez.
- Failed count 5. başarısız denemede lock set eder.
- Lock süresi dolduktan sonraki ilk başarısız deneme yeni failure penceresini `failed_login_count = 1` ile başlatır.
- Bcrypt compare DB transaction/row lock dışında çalışır; sadece state mutation atomik update ile yapılır.
- Locked account password compare yapmadan generic 401 döner.
- Başarılı login failed count ve lock state'i temizler.
- Logout session destroy eder ve user-session Redis index'inden session key'i temizler.
- Password reset sonrası eski session `GET /api/account/session` için 401 olur.
- Password reset sonrası user-session Redis index'i temizlenir.
- Password reset token DB'de raw değil hash olarak saklanır.
- Password reset token verification invalid/expired/user inactive durumlarında detay sızdırmaz.
- Password reset token verification ve reset completion endpointleri rate limit altındadır.
- CSRF token olmadan unsafe account mutation endpointleri 403 döner.
- `POST /api/account/password-reset-requests` user yokken de 204 döner.
- Password reset request path'i user var/yok dallarında belirgin timing oracle üretmez.
- Reset token TTL `1 hour` olarak set edilir ve yeni reset talebi aynı user'ın eski token'ını invalidate eder.
- Account-specific rate limit generic response contract ile çalışır ve email/account existence sızdırmaz.
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
- Role/permission bilgisinin `req.user` üzerinden authorization katmanına sunulması.
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

- Password hash için bcrypt kullanılacak; v2 planındaki rounds `12` korunacak.
- Password minimum uzunluğu `15` karakter olmalı.
- Bcrypt 72-byte limiti nedeniyle `Buffer.byteLength(password, 'utf8') <= 72` kontrolü yapılmalı.
- Password schema ayrıca maksimum karakter/byte sınırı koymalı; body limit tek başına password policy yerine geçmemeli.
- Password reset/set sonrası `password_changed_at` güncellenmeli.
- Password unicode normalization kararı netleştirilmeli; ilk fazda en azından byte limit ve validation mesajları aynı canonical ölçüme dayanmalı.
- Session cookie `httpOnly` kalmalı.
- Production'da `secure: true` kalmalı.
- Mevcut `sessionMaxAgeMs = 24h` absolute timeout olarak ele alınmalı; rolling/idle timeout isteniyorsa ayrıca tasarlanmalı.
- Başarılı login session id rotate etmeli ve authenticated session için yeni CSRF token üretilmeli.
- Cross-site frontend gerekiyorsa `sameSite: 'none'` + `secure: true` zorunludur; mevcut `lax` kararı aynı-site/subpath deployment için uygundur. Deployment topolojisi kesinleşince env ile ayarlanabilir hale getirilmeli.
- Production CORS origin allowlist env/config üzerinden yönetilmeli; `credentials: true` ile wildcard origin asla kullanılmamalı.
- Login ve password reset endpointleri global `/api` rate limit dışında auth/account-specific daha düşük rate limit altında kalmalı. Login için IP + normalized email digest bazlı; password reset request için IP + normalized email digest bazlı; token verification için IP + route bazlı limit önerilir.
- Rate limit key'lerinde normalized email doğrudan saklanmamalı; HMAC veya SHA-256 digest gibi non-raw temsil kullanılmalı.
- Production'da auth/account rate limit store hatasında fail-open/fail-closed kararı açık olmalı; credential brute force yüzeyinde fail-closed tercih edilmelidir.
- Auth/account-specific limiter'ın environment davranışı explicit olmalıdır: production Redis-backed ve fail-closed çalışmalı; dev/test için Redis-backed fake/test Redis veya inject edilebilir resetlenebilir memory limiter seçimi belgelenmelidir.
- CSRF middleware login/logout/reset gibi cookie-auth state değiştiren endpointlerde aktif kalmalı. İlk CSRF token için `/api/csrf-token` kullanılmaya devam edilebilir.
- Logs hiçbir zaman password, raw reset token, session id veya cookie değeri içermemeli.
- HTTP logger/redaction config `cookie`, `authorization`, CSRF header, password alanları ve token alanlarını redact etmelidir.
- Auth operational logları structured olmalı, ancak email/token/session id gibi değerleri raw değil redacted veya digest olarak içermelidir.



## Open Decisions

1. Frontend/API aynı site mi çalışacak, yoksa cross-site cookie gerekiyor mu?
  - Aynı site: `sameSite: 'lax'` yeterli.
  - Cross-site: `sameSite: 'none'`, `secure: true`, CORS credentials/origin allowlist zorunlu.
2. Login sonrası CSRF token client'a nasıl verilecek?
  - Seçenek A: `POST /api/account/session` response'u yeni authenticated CSRF token döner.
  - Seçenek B: Client başarılı login sonrası tekrar `GET /api/csrf-token` çağırır.
  - Her iki seçenekte de pre-login CSRF token login sonrası geçersiz kabul edilmelidir.
3. Account/auth-specific rate limit değerleri ne olacak?
  - Öneri: session creation için IP + email digest bazlı kısa pencere; password reset request için IP + email digest bazlı daha sıkı pencere; token verification/reset completion için IP + route bazlı limit.
  - Production store hatasında credential brute force yüzeyi için fail-closed varsayımı tercih edilmelidir.
  - Auth limiter hangi ortamlarda Redis-backed olacak ve testlerde sayaç state'i nasıl izole edilecek? Tercih edilen yaklaşım production ile aynı davranış için test Redis/fake Redis kullanmak veya limiter'ı dependency injection ile resetlenebilir kılmaktır.
4. Session invalidation için Redis user-session index'i hemen mi eklenecek?
  - Evet, minimal user-session index Phase 2 içinde eklenmelidir; çünkü password reset completion Phase 2'de yer alır ve reset sonrası session invalidation security requirement'tır. Phase 3 sadece hardening/TTL/stale cleanup/standardizasyon kapsamıdır.
5. Email gönderim altyapısı v2'de hangi modülde kurulacak?
  - Account service doğrudan provider'a bağlanmamalı; `communication`/`notifications` adapter'ı beklenmeli.
6. Admin panel ayrı frontend olduğu için ayrı auth endpoint gerekir mi?
  - Hayır. Canonical endpoint tek kalmalı: `POST /api/account/session`. Admin/user ayrımı authentication değil authorization kararıdır. Gerekirse aynı endpoint body içinde opsiyonel `audience: 'admin'` desteklenebilir, fakat ilk fazda route-level authorization ile yetinmek daha güvenli varsayılandır.
7. Password reset token verification endpoint'i gerçekten gerekli mi?
  - Ürün UX'i ayrı token pre-check gerektirmiyorsa ilk fazda kaldırılıp doğrulama sadece `POST /api/account/password-resets` içinde yapılabilir. Kalacaksa generic failure, no raw token logging ve sıkı rate limit zorunludur.
8. Password unicode normalization politikası ne olacak?
  - İlk fazda en azından byte limit, validation ve hashing aynı canonical input'a dayanmalı; daha kapsamlı normalization/blocklist politikası ayrı password policy kararı olarak ele alınabilir.
9. Session timeout modeli absolute mı idle/rolling mi olacak?
  - Mevcut `sessionMaxAgeMs = 24h` absolute timeout varsayımıdır. Admin paneli için ayrıca idle timeout veya daha kısa session süresi isteniyorsa auth/session config ve testleri buna göre genişletilmelidir.



## Rollback Strategy

- Phase 1 rollback: `passport-local` strategy wiring geri alınır; mevcut serialize/deserialize korunur.
- Phase 2 rollback: `/api/account/*` route mount kaldırılır; mevcut API yüzeyi etkilenmez. Password reset endpoint'i yayında kalacaksa minimal user-session invalidation geri alınmamalıdır.
- Phase 3 rollback: user-session Redis index hardening/TTL/stale cleanup iyileştirmeleri devre dışı bırakılır; Phase 2 minimal invalidation korunur.



## Exit Criteria

- `POST /api/account/session` başarılı credential ile session cookie üretir.
- `POST /api/account/session` başarılı login sırasında session id rotate eder.
- Login sonrası authenticated session için yeni CSRF token üretilir veya client'ın yeni token alacağı contract test edilir.
- `GET /api/account/session` session ile kullanıcıyı ve role/scope özetini döner.
- `DELETE /api/account/session` session'ı destroy eder ve Redis user-session index'ini temizler.
- Session creation failure durumları generic nested error contract ile döner.
- No-user, inactive-user ve no-credential login dalları dummy bcrypt compare ile timing oracle riskini azaltır.
- Password reset token DB'de raw saklanmaz.
- Password reset token verification/reset invalid durumları token/account state detayı sızdırmaz.
- Password reset sonrası kullanıcının mevcut Redis session'ları invalidate edilir.
- Account-specific rate limit login/reset/token endpointlerinde global limiter'dan ayrı çalışır.
- Auth logs password, raw reset token, session id, cookie ve CSRF token içermez.
- Account route'ları Zod validation kullanır.
- `tsc --noEmit` ve auth integration testleri geçer.

