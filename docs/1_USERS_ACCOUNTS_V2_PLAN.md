# Users & User Credentials V2 Plani

## Summary

V2'de kullanici/auth modeli uc ayri sorumluluga ayrilacak:

- `users`: sistemdeki gercek kisi/domain kaydi.
- `user_credentials`: kullanicinin parola olusturduktan sonraki password credential ve login security state kaydi.
- `password_reset_tokens`: ilk parola olusturma ve parola sifirlama token kayitlari.

`user_profiles` tablosu simdilik olusturulmayacak. Bu proje icin `title`, `user_type` ve `iban` kullanicinin dogal domain bilgileri olarak `users` tablosunda kalacak.

Notification ve deadline/process state alanlari `users` tablosunda tutulmayacak. Ihtiyac dogarsa bu alanlar kendi sorumluluguna ait yeni tablolarla modellenecek.

Admin kullanici olusturdugunda sadece `users` kaydi olusacak. `user_credentials` kaydi parola basariyla olusturulana kadar asla olusmayacak.

Ilk parola olusturma icin ayri bir davet/set-password akisi olmayacak. Kullanici ilk parolasini da mevcut parolasini sifirlar gibi `forgot password` -> `reset password` akisiyle belirleyecek.

Token dogrulanip parola basariyla set edilince credential kaydi yoksa `user_credentials` kaydi atomic upsert ile olusturulacak, varsa mevcut credential kaydi guncellenecek.

## Schema

### `users`

```text
id uuid primary key
name varchar(255) not null
surname varchar(255) not null
email varchar(255) not null unique
user_type enum('ACADEMICIAN', 'POSTDOC', 'STAFF') not null
title enum('PROFESSOR', 'ASSOCIATE_PROFESSOR', 'ASSISTANT_PROFESSOR', 'RESEARCH_ASSISTANT', 'RESEARCH_ASSISTANT_DOCTOR', 'LECTURER', 'LECTURER_DOCTOR', 'DOCTOR') null
status enum('ACTIVE', 'INACTIVE') not null default 'ACTIVE'
iban varchar(255) null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz null
```

Notlar:

- Email sadece `users.email` icinde tutulacak.
- Email kayit ve giris oncesi app tarafinda `trim().toLowerCase()` ile normalize edilecek.
- Email uniqueness DB seviyesinde `users.email` kolonu uzerinde inline `unique` constraint ile garanti edilecek.
- Inline `unique` constraint case-sensitive oldugu icin case-insensitive davranis tamamen app tarafindaki `trim().toLowerCase()` normalizasyonuna birakilacak.
- Email uniqueness `deleted_at` degerinden bagimsiz olacak; ayni email tekrar kullanilamayacak.
- Kullanici normal admin akisiyle delete/soft-delete edilmeyecek.
- Kullanici devre disi birakma `status = INACTIVE` ile yapilacak.
- `deleted_at` kolonu simdilik tutulacak ama user lifecycle, auth lookup ve email uniqueness davranisina dahil edilmeyecek.
- `deleted_at` ileride veri saklama/purge gibi ozel bir ihtiyac dogarsa ayri ve kontrollu bir surecte degerlendirilecek.
- `email_normalized` kolonu kullanilmayacak.
- `email_verified_at` kullanilmayacak, cunku kullaniciyi admin olusturuyor.
- `full_name` DB'de tutulmayacak; gerektiginde `name + surname` olarak hesaplanacak.
- `last_notify_at`, `performance_end_date` ve `incentive_end_date` `users` tablosunda tutulmayacak.
- Notification state gerekirse notification'a ait tablo/log yapisinda tutulacak.
- Performance ve incentive deadline bilgileri gerekirse ilgili surec/donem tablolarinda tutulacak.

### `user_credentials`

```text
id uuid primary key
user_id uuid not null unique references users(id) on delete cascade
password_hash varchar(255) not null
password_changed_at timestamptz not null
last_login_at timestamptz null
failed_login_count int not null default 0
locked_until timestamptz null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Notlar:

- `user_credentials.user_id` unique olacak ve birebir iliskiyi garanti edecek.
- `password_hash` bcrypt hash olacak.
- Ayri `salt` kolonu olmayacak; bcrypt salt bilgisini hash string icinde saklar.
- `password_hash` nullable olmayacak.
- `password_changed_at` ilk parola set edildiginde ve sonraki parola degisimlerinde guncellenecek.
- Credential kaydinin varligi, kullanicinin parola olusturdugu anlamina gelecek.
- `user_credentials.deleted_at` olmayacak.
- Credential kaydi user'dan bagimsiz soft-delete edilmeyecek; login yetkisi `users.status` ile yonetilecek.
- Normal admin akisiyle user hard delete edilmeyecek.
- User ileride ayri bir veri saklama/purge surecinde hard delete edilirse `user_credentials` kaydi `ON DELETE CASCADE` ile silinecek.
- Bu tablo local/password credential icindir.
- Social login/OAuth su an kapsam disi. Ileride eklenirse `user_credentials` genisletilmek yerine ayri provider identity tablosu veya daha genel bir auth identity modeli degerlendirilecek.

### `password_reset_tokens`

```text
id uuid primary key
user_id uuid not null unique references users(id) on delete cascade
token_hash varchar(64) not null unique
expires_at timestamptz not null
created_at timestamptz not null default now()
```

Notlar:

- Bu tablo hem ilk parola olusturma hem de parola sifirlama icin kullanilacak.
- Raw token `crypto.randomBytes(32).toString('base64url')` ile uretilecek.
- Raw token DB'de tutulmayacak; sadece SHA-256 hex digest'i `token_hash` olarak tutulacak.
- Token yuksek entropili oldugu icin bcrypt/argon2 gibi slow hash kullanilmayacak.
- HMAC-SHA-256 su an kullanilmayacak; ileride token secret'i DB'den ayri bir yerde yonetilecekse defense-in-depth olarak degerlendirilecek.
- Bu tablo operasyonel/gecici tablo olacak; audit/history tablosu gibi kullanilmayacak.
- Ayni user icin ayni anda tek token yeterli olacak.
- `password_reset_tokens.user_id` unique olacak; boylece ayni user icin tek token kurali DB seviyesinde garanti edilecek.
- Yeni token uretilirken ayni user'a ait mevcut token kaydi transaction icinde hard delete edilip yeni token insert edilecek.
- Token basariyla kullanildiktan sonra ilgili token kaydi hard delete edilecek.
- Expire olmus tokenlar scheduler/cron ile periyodik olarak hard delete edilecek.
- IP ve user-agent gibi request metadata token tablosunda tutulmayacak.
- Audit gerekiyorsa token tablosunda degil, `audit_logs` icinde event metadata olarak tutulacak.
- `password_reset_tokens.user_id` unique index ayni zamanda user bazli sorgu/delete islemlerini hizlandiracak.

## Auth Flow

### Admin User Create

1. Admin kullaniciyi olusturur.
2. Sadece `users` tablosuna kayit atilir.
3. `user_credentials` kaydi olusturulmaz.
4. `password_reset_tokens` kaydi olusturulmaz.

### Login

1. Email `trim().toLowerCase()` ile normalize edilir.
2. Kullanici case-insensitive `users.email` lookup ile bulunur.
3. Kullanici yoksa login basarisiz olur.
4. Kullanici `INACTIVE` ise login basarisiz olur.
5. Kullanici icin `user_credentials` kaydi bulunur.
6. Credential kaydi yoksa login basarisiz olur.
7. `locked_until` gelecekteyse login basarisiz olur.
8. Bcrypt compare ile parola kontrol edilir.
9. Basarili login sonrasi:
  - `last_login_at` guncellenir.
  - `failed_login_count` sifirlanir.
  - `locked_until` temizlenir.
10. Hatali login sonrasi:
  - Aktif lock penceresi yoksa `failed_login_count` artirilir.
  - 5. hatali denemede `locked_until = now + 15 minutes` set edilir. Esik semantigi `failed_login_count >= 5` lock anlamina gelir.

Kilitliyken gelen login denemelerinde:

- Password compare yapilmaz.
- `failed_login_count` artirilmaz.
- `locked_until` uzatilmaz.
- Generic login hatasi donulur.

Lock suresi dolduktan sonra gelen login denemelerinde:

- `locked_until <= now` eski lock penceresinin bittigi anlamina gelir.
- Ilk basarisiz deneme eski `failed_login_count` degeri uzerinden devam etmez.
- Yeni failure penceresi `failed_login_count = 1`, `locked_until = null` ile baslatilir.

Concurrency ve transaction kurali:

- `bcrypt.compare` hicbir DB transaction veya row lock icinde calistirilmaz.
- Credential ve lock state okunur, bcrypt/dummy compare transaction disinda calisir, sadece sonuc state mutation'i atomik SQL `UPDATE`/upsert ile yazilir.
- CPU-bound hash suresi boyunca DB row lock'u veya connection tutulmaz.

Kullaniciya donen login hata mesaji tum bu failure durumlari icin generic olacak:

```text
E-posta veya sifre hatali.
```

Boylece "user var ama parola kurmamis", "passive user", "credential kaydi yok" gibi durumlar email enumeration'a sebep olmayacak. UX icin parola kurma yonlendirmesi login hata cevabinda degil, forgot password akisi uzerinden cozulur.

### Forgot Password / Ilk Parola Olusturma Token'i

1. Kullanici email girer.
2. Email `trim().toLowerCase()` ile normalize edilir.
3. `status = ACTIVE` olan `users` kaydi case-insensitive email lookup ile aranir.
4. User yoksa disariya generic response donulur; email enumeration yapilmaz.
5. User varsa transaction icinde ayni user'a ait mevcut token kaydi hard delete edilir.
6. `crypto.randomBytes(32).toString('base64url')` ile random reset token uretilir.
7. DB'ye raw token degil, SHA-256 hex digest token hash yazilir.
8. `expires_at = now + 1 hour` set edilir.
9. Email linkinde raw token gonderilir.

Timing oracle notu:

- Forgot password endpoint'i user var/yok bilgisini response govdesi disinda belirgin response suresi farkiyla da sizdirmamalidir.
- User varsa token uretimi, DB write ve email enqueue; user yoksa hicbir sey yapmama gibi hizli path gozlemlenebilir email enumeration'a donusebilir.
- Tercih edilen yaklasim dis response'u generic `204` olarak hizlica dondurmek ve token/email isini async queue/job ile yapmak; queue yoksa user var/yok dallarinin benzer operasyonel maliyet ve rate limit davranisina sahip olmasini saglamaktir.

### Password Set / Reset

1. Gelen raw token SHA-256 hex digest'e cevrilir.
2. Token kaydi `password_reset_tokens.token_hash` ile bulunur ve expire/user status kontrolleri yapilir.
3. Token yoksa veya expire olduysa islem reddedilir.
4. Token'in bagli oldugu user aktif degilse islem reddedilir.
5. Yeni parola bcrypt ile transaction/row lock disinda hashlenir.
6. Kisa bir transaction icinde token tekrar row lock ile okunur ve halen mevcut/expire olmamis/user aktif ise devam edilir.
7. `user_credentials` icin DB-level upsert calisir:
  - `password_hash`
  - `password_changed_at`
  - `failed_login_count = 0`
  - `locked_until = null`
8. User'a ait aktif Redis session'lar invalidate edilir.
9. Token kaydi hard delete edilir.

Credential upsert app seviyesinde `find -> create/update` olarak yapilmayacak. `user_credentials.user_id` unique constraint uzerinden atomic DB upsert kullanilacak. Bcrypt hash CPU-bound oldugu icin token row lock'u veya DB connection'i hash suresi boyunca tutulmayacak; token kullanimi ve credential mutation kisa transaction icinde atomiklestirilecek.

## API / Service Degisiklikleri

- `users.password` kaldirilacak.
- `users.isSetPassword` kaldirilacak.
- `users.temp` icindeki password token yapisi kaldirilacak.
- Passport Local password kontrolunu `users.password` yerine `user_credentials.password_hash` uzerinden yapacak.
- Admin/user response'larinda password hash ve token alanlari asla donmeyecek.
- Ihtiyac olursa response'a computed auth status alanlari eklenebilir:
  - `hasCredential`
  - `hasPassword`
  - `lastLoginAt`
  - `lockedUntil`
- `hasCredential` ve `hasPassword` credential kaydinin varligina gore ayni anlama gelecek.
- Session storage Redis'te kalacak.
- Password set/reset sonrasi kullanicinin mevcut Redis session'lari invalidate edilecek.
- DB session tablosu bu plana dahil degil.
- Password policy DB'de tutulmayacak; app/config seviyesinde tek bir `passwordPolicy` helper/service ile uygulanacak.
- Admin icin manuel account unlock endpoint'i eklenecek; bu endpoint `user_credentials` lock state'ini temizleyecek.

## Security Decisions

- Bcrypt ile devam edilecek.
- V2 default bcrypt salt rounds `12` olacak.
- Password minimum uzunlugu `15` karakter olacak.
- Bcrypt'in 72-byte input limiti nedeniyle password validation'da max byte uzunlugu konacak.
- Password validation `Buffer.byteLength(password, 'utf8') <= 72` kuralini uygulayacak.
- Password composition rule uygulanmayacak; buyuk harf/rakam/sembol zorunlulugu olmayacak.
- Unicode, whitespace ve printable karakterlere izin verilecek.
- `bcryptjs` pure JS oldugu icin rounds `12` performansi load test ile dogrulanacak; yavas kalirsa native `bcrypt` paketine gecis degerlendirilecek.
- Ayri salt kolonu tutulmayacak.
- Reset token ayri tabloda tutulacak.
- Reset token tablosu gecici operasyonel tablo olacak; kalici gecmis tutmayacak.
- Reset token `crypto.randomBytes(32).toString('base64url')` ile uretilecek.
- Reset token DB'de raw halde tutulmayacak; sadece SHA-256 hex digest'i tutulacak.
- Reset token yuksek entropili oldugu icin bcrypt/argon2 gibi slow hash kullanilmayacak.
- HMAC-SHA-256 su an kullanilmayacak; ileride secret DB'den ayri yonetilecekse defense-in-depth olarak degerlendirilecek.
- Reset token basariyla kullanilinca hard delete edilecek.
- Expire tokenlar scheduler/cron ile hard delete edilecek.
- Password reset audit bilgisi gerekiyorsa IP ve user-agent dahil request metadata `audit_logs` eventleriyle tutulacak.
- `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`, `LOGIN_FAILED`, `ACCOUNT_LOCKED` audit eventleri desteklenecek.
- `ACCOUNT_UNLOCKED_BY_ADMIN` audit event'i desteklenecek.
- Forgot password response'u user var/yok bilgisini belli etmeyecek.
- Forgot password endpoint'i rate limit ile korunacak.
- Rate limit icin `express-rate-limit` ve Redis-backed store kullanilacak; default memory store production'da kullanilmayacak.
- Forgot password rate limit iki katmanli olacak:
  - IP bazli: 10 istek / 15 dakika.
  - Email bazli: 3 istek / 1 saat, key `trim().toLowerCase()` email degeri olacak.
- `INACTIVE` kullanicilar login olamayacak.
- `users.deleted_at` normal auth akisi icin kullanilmayacak.

## Admin Operations

### Manual Unlock

Admin kilitlenen kullanicinin credential lock state'ini manuel olarak acabilecek.

```text
POST /manager/users/:userId/unlock-account
```

Islem:

- User bulunur.
- User'a ait credential kaydi bulunur.
- Credential kaydi yoksa unlock edilecek auth kaydi olmadigi icin islem reddedilir.
- `failed_login_count = 0` yapilir.
- `locked_until = null` yapilir.
- Password hash degistirilmez.
- Redis session'lara dokunulmaz.
- `ACCOUNT_UNLOCKED_BY_ADMIN` audit event'i yazilir.

## Test Plan

- Admin user create sadece `users` kaydi olusturmali.
- Admin user create sonrasi `user_credentials` kaydi olusmamali.
- Admin user create sonrasi `password_reset_tokens` kaydi olusmamali.
- `users.email` inline unique constraint ile korunmali.
- `users.email` uniqueness `deleted_at` degerinden bagimsiz olmali.
- Credential kaydi olmayan user login olamamali.
- Tum login failure durumlari generic hata mesaji dondurmeli.
- Forgot password mevcut aktif user icin credential kaydi olusturmamali.
- Forgot password user var/yok dallarinda belirgin timing oracle uretmemeli.
- Forgot password `password_reset_tokens` icine token hash ve expiry yazmali.
- Forgot password token TTL'i 1 saat olmali.
- Forgot password IP bazli rate limit'i asmamali.
- Forgot password email bazli rate limit'i asmamali.
- Forgot password ayni user icin onceki token kaydini transaction icinde hard delete etmeli.
- Ayni user icin ikinci token insert'i DB unique constraint ile engellenmeli.
- Password set token'i dogruysa bcrypt hash yazmali.
- Password set credential kaydi yoksa DB upsert ile credential kaydi olusturmali.
- Password set credential kaydi varsa DB upsert ile mevcut credential kaydini guncellemeli.
- Iki eszamanli password set istegi credential create race condition'a dusmemeli.
- Password set sonrasi `password_changed_at` dolmali.
- Password set/reset sonrasi kullanicinin aktif Redis session'lari invalidate edilmeli.
- Password set sonrasi token kaydi hard delete edilmeli.
- Ayni token iki eszamanli istekle iki kez kullanilamamali.
- Expire olmus tokenlari temizleyen scheduled cleanup test edilmeli.
- 15 karakterden kisa password validation tarafinda reddedilmeli.
- UTF-8 byte uzunlugu 72'den buyuk password validation tarafinda reddedilmeli.
- Password policy reset-password ve change-password akislari icin ayni helper/service uzerinden calismali.
- Basarili login `last_login_at` guncellemeli.
- Basarili login `failed_login_count` ve `locked_until` alanlarini temizlemeli.
- Hatali login `failed_login_count` artirmali.
- 5. hatali login denemesinde `locked_until` set edilmeli.
- Lock suresi dolduktan sonraki ilk basarisiz deneme yeni failure penceresini `failed_login_count = 1` ile baslatmali.
- Bcrypt compare DB transaction/row lock disinda calismali; sadece state mutation atomik update ile yapilmali.
- Lock suresi dolmadan dogru parola girilse bile login reddedilmeli.
- Lock suresi icindeki login denemeleri `failed_login_count` artirmamali ve lock suresini uzatmamali.
- `INACTIVE` user login olamamali.
- `ACCOUNT_LOCKED` audit event'i yazilmali.
- Admin manuel unlock `failed_login_count` ve `locked_until` alanlarini temizlemeli.
- Admin manuel unlock password hash'i degistirmemeli.
- Admin manuel unlock `ACCOUNT_UNLOCKED_BY_ADMIN` audit event'i yazmali.
- Admin/user list response password ve token alanlarini dondurmemeli.

## Assumptions

- Kullanici self-register olmayacak; kullaniciyi admin olusturacak.
- Ilk parola belirleme ayri davet/set-password linkiyle degil, forgot password/reset password akisiyle yapilacak.
- Password reset token TTL'i 1 saat olacak.
- Password minimum uzunlugu 15 karakter olacak.
- Password policy DB'de degil app/config katmaninda tutulacak.
- Forgot password rate limit Redis-backed `express-rate-limit` ile uygulanacak.
- `user_credentials` kaydi admin create sirasinda degil, sadece parola basariyla set edilince olusacak.
- Credential create/update DB-level upsert ile atomic yapilacak.
- Password reset token lifecycle'i `user_credentials` icinde degil, `password_reset_tokens` tablosunda tutulacak.
- `password_reset_tokens` kalici history/audit tablosu olmayacak; kullanilan ve expire olan tokenlar silinecek.
- Ayni user icin tek pending reset token DB tarafinda `password_reset_tokens.user_id` unique ile garanti edilecek.
- `user_profiles` tablosu simdilik yok.
- Email hem auth lookup hem admin iletisim bilgisi olarak `users.email` alaninda tek kaynak olacak.
- User normal admin akisiyle silinmeyecek; aktiflik `users.status` uzerinden `ACTIVE` / `INACTIVE` olarak yonetilecek.
- `users.deleted_at` kolonu simdilik tutulacak ama auth/list/filter lifecycle davranisina dahil edilmeyecek.
- Email unique garanti DB tarafinda `users.email` inline unique constraint ile saglanacak.
- Email uniqueness `deleted_at` degerinden bagimsiz olacak; ayni email tekrar kullanilamayacak.
- Mevcut v1'deki `password` alani v2'de `user_credentials.password_hash` modeline tasinacak.
- Mevcut v1'deki `isSetPassword` kaldirilacak; credential kaydinin varligi bu bilgiyi temsil edecek.
- Mevcut v1'deki `temp.password` yapisi `password_reset_tokens` tablosuna tasinacak.
