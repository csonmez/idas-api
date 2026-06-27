# Error Contract Plan

## Amaç

Error Contract fazinin amaci, API hata cevaplarini tek bir nested contract altinda standartlastirmak ve handler/service/middleware katmanlarinin kullanabilecegi merkezi application hata modelini hazirlamaktir. Kaynak planda bu faz, endpointler cogalmadan once client-facing error shape'in sabitlenmesi ve internal detaylarin response body'ye sizmamasini garanti altina almak icin ilk uygulama adimi olarak siralanmistir.

## Mevcut Durum

- `src/app.ts` Express pipeline'i kurar; `/api` altinda rate-limit, JSON/urlencoded parser, session, passport, CSRF ve router calisir; en sonda `notFoundHandler` ve `errorHandler` vardir.
- `src/middlewares/error.middleware.ts` merkezi error middleware'dir. `status`, `statusCode`, `entity.parse.failed` ve `entity.too.large` degerlerinden status uretir; response body bugun flat shape ile doner: `{ error, message, details }`.
- `src/middlewares/error.middleware.ts` 400, 403, 404 ve 413 icin code mapping yapar; diger status'ler default olarak `INTERNAL_ERROR` code'una duser.
- `src/middlewares/not-found.middleware.ts` dogrudan flat `NOT_FOUND` JSON response yazar.
- `src/auth/csrf.ts` guvensiz methodlarda token gecersizse dogrudan flat `FORBIDDEN` JSON response yazar.
- `src/security/rate-limit.ts` rate-limit handler'larinda dogrudan flat `TOO_MANY_REQUESTS` ve production store error durumunda flat `SERVICE_UNAVAILABLE` JSON response yazar.
- `src/security/cors.ts` disallowed origin icin `CorsError` firlatir; bu hata status `403` ile merkezi `errorHandler` uzerinden flat response'a map edilir.
- Payload parse hatalari `express.json` veya `express.urlencoded` tarafindan uretilir; `entity.parse.failed` bugun 400 `BAD_REQUEST`, `entity.too.large` bugun 413 `PAYLOAD_TOO_LARGE` olarak flat response'a map edilir.
- `src/routes/index.ts` yalnizca `/api/csrf-token` icin basarili `{ token }` response doner; mevcut route icinde error JSON response yoktur.
- `src/app.test.ts` Node test runner ve Supertest kullanir. Mevcut testler 400 malformed JSON, 403 CORS, 403 CSRF, 404 not-found ve Express 5 async 500 akisini flat shape uzerinden kontrol eder.
- 413 payload-too-large, 429 rate-limit, 401 unauthenticated ve bilinen `AppError` icin mevcut test yoktur.
- Mevcut kodda `AppError`, `AppErrorCode`, `sendError` veya benzeri merkezi response helper yoktur.
- `src/logger/http-logger.ts` status code'a gore pino-http log seviyesi belirler; `src/middlewares/error.middleware.ts` icinde stack/requestId ile explicit error logging henuz yoktur. Kapsamli observability refactor'u kaynak planda sonraki Error Logging fazina aittir.

## Hedef Durum

Tum hata cevaplari asagidaki nested contract ile donmelidir:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Message",
    "details": {}
  }
}
```

Bilinmeyen hatalar her zaman `500 INTERNAL_ERROR` olarak doner. 500 public message tam olarak `Internal server error` olur. Stack, cause, SQL mesaji ve internal DB detayi response body'ye yazilmaz.

## Uygulama Kapsamı

Bu fazda yapilacak isler:

- Merkezi `AppErrorCode` tipi
- `AppError` class veya kaynak planla uyumlu factory modeli
- Merkezi error response helper
- Error middleware mapping
- Not-found davranisi
- CSRF hata davranisi
- Rate-limit hata davranisi
- Payload-too-large davranisi
- Bilinmeyen hatalarin `INTERNAL_ERROR` olarak donmesi
- Ilgili testlerin guncellenmesi

## Scope Dışı İşler

Bu fazda yapilmayacak isler:

- Request validation helper'lari
- Authorization mimarisi
- Domain modulleri
- Users use-case'i
- Academic organization
- Genel soft-delete altyapisi
- CORS config
- Error logging fazina ait kapsamli observability refactor'u
- Ilgisiz kod refactor'lari

Mevcut error handler'in temel 5xx davranisi korunmalidir. Ancak 5xx hatalari requestId ve stack ile structured loglama gibi genis observability iyilestirmeleri Error Logging fazina birakilmalidir.

## Etkilenmesi Beklenen Dosyalar

Degismesi beklenen mevcut dosyalar:

- `src/middlewares/error.middleware.ts`: `AppError` ve bilinmeyen hata mapping'i, nested response contract.
- `src/middlewares/not-found.middleware.ts`: merkezi helper veya `AppError` uyumlu not-found response.
- `src/auth/csrf.ts`: dogrudan custom JSON yerine merkezi contract.
- `src/security/rate-limit.ts`: 429 ve 503 cevaplarinin merkezi contract'a gecmesi.
- `src/app.test.ts`: mevcut flat shape assert'lerinin nested shape'e guncellenmesi ve eksik error scenario testlerinin eklenmesi.

Dolayli etkilenmesi veya test edilmesi beklenen mevcut dosyalar:

- `src/security/cors.ts`: CORS hatasi merkezi `errorHandler` uzerinden aktigi icin nested contract testlerinden etkilenir; config refactor'u bu fazin kapsami degildir.
- `src/app.ts`: Payload parser sirasi ve error middleware sirasi korunmalidir; degisiklik gerekip gerekmedigi implementasyon oncesi tekrar listelenmelidir.
- `src/logger/http-logger.ts`: Mevcut log seviyesi davranisi bozulmamalidir; kapsamli logging refactor'u bu fazda yapilmaz.

Olusturulmasi beklenen dosyalar icin kaynak plan secenek birakir; kesin karar implementasyon oncesi raporlanmalidir:

- Oneri: `src/http/errors.ts`
- Alternatif kaynak plan secenegi: `src/http/responses.ts`
- Oneri: helper unit test dosyasi gerekiyorsa mevcut test yapisina uygun yeni `*.test.ts`

Guncellenmesi beklenen testler:

- `src/app.test.ts` mevcut app-level error response testlerini tasir.
- Ek helper unit testleri gerekiyorsa Node test runner yapisina uygun yeni test dosyasi onerilebilir; mevcut olmayan test dosyasi kesinlesmis kabul edilmemelidir.

## Değişmez Kurallar

- Service katmani Express `Response` bilmez.
- Service ve application kodu hata durumunda `AppError` uretir.
- Bilinmeyen hatalar her zaman `500 INTERNAL_ERROR` olur.
- 500 public message tam olarak `Internal server error` olur.
- Stack, cause, SQL mesaji ve internal DB detaylari response body'ye yazilmaz.
- `details` yalnizca guvenli ve JSON-serializable veri icerir.
- Middleware'ler birbirinden farkli custom JSON error formatlari uretmez.
- Success response'lara bu fazda zorunlu wrapper eklenmez.
- Hata kodlari kaynak dokumandaki `AppErrorCode` listesiyle uyumlu olur.
- Yeni dependency eklenmez; zorunlu gorulurse sadece oneri olarak raporlanir.
- Mevcut public API davranisinda plan disinda degisiklik yapilmaz.

## AppError Kod Matrisi

Kaynak dokuman kod listesini belirler; kaynakta netlesmemis public message degerleri kesin standart olarak uydurulmaz. `INTERNAL_ERROR` icin public message kaynak dokumanda kesin olarak `Internal server error` seklindedir.

| AppError code | Varsayılan HTTP status | Kullanım amacı | Public message davranışı | `details` kullanım durumu |
|---|---:|---|---|---|
| `BAD_REQUEST` | 400 | Genel hatali request veya malformed JSON gibi request parse hatalari | Kaynakta tek global mesaj standardi verilmez; mevcut davranis `Bad request` olabilir | Guvenli request hata bilgisi varsa kullanilir; internal parser detayi yazilmaz |
| `VALIDATION_ERROR` | 400 | Request validation helper'larindan gelecek field-level validation hatalari | Validation fazinda kaynak ornek `Request validation failed` der; bu faz validation helper yazmaz | Field-level bilgiler ileride `fields` altinda guvenli bicimde tasinir |
| `UNAUTHENTICATED` | 401 | Auth olmayan request | Kaynakta exact message belirlenmez | Genellikle bos veya guvenli auth context; credential detayi yazilmaz |
| `FORBIDDEN` | 403 | CSRF, CORS veya permission olmayan request | Kaynakta exact message belirlenmez; CSRF mevcutta `Invalid CSRF token` doner | Guvenli policy/CSRF detayi varsa kullanilir |
| `NOT_FOUND` | 404 | Route veya resource bulunamadiginda | Kaynak hedef ornegi `Not found` kullanir | Genellikle `{}` |
| `CONFLICT` | 409 | Unique constraint veya domain conflict gibi application-level cakismalar | Kaynakta exact message belirlenmez | Guvenli conflict alanlari varsa kullanilir; DB constraint detayi yazilmaz |
| `PAYLOAD_TOO_LARGE` | 413 | Body parser limit asimi | Mevcut davranis `Payload too large`; kaynak exact global mesaj belirlemez | Genellikle `{}`; limit bilgisi guvenli kabul edilirse implementasyon oncesi raporlanir |
| `TOO_MANY_REQUESTS` | 429 | Rate-limit asimi | Mevcut davranis `Too many requests`; kaynak exact global mesaj belirlemez | Genellikle `{}`; rate-limit metadata guvenli ise ayrica kararlastirilir |
| `SERVICE_UNAVAILABLE` | 503 | Gecici altyapi/service unavailable durumlari | Mevcut rate-limit store error davranisi `Service unavailable`; kaynak exact global mesaj belirlemez | Internal store/Redis detayi yazilmaz |
| `INTERNAL_ERROR` | 500 | Bilinmeyen exception ve internal hatalar | Exact public message: `Internal server error` | Response body'de stack, cause, SQL veya internal DB detayi bulunmaz |

## Acceptance Criteria

- Tum hata cevaplari nested error contract kullanir.
- 400, 403, 404, 413, 429 ve 500 durumlari test edilir.
- Mevcut auth davranisi varsa 401 durumu da test edilir.
- Bilinmeyen hata `500 INTERNAL_ERROR` doner.
- 500 response'unda stack veya internal detail bulunmaz.
- Not-found, CSRF ve rate-limit ayni error contract'i kullanir.
- Typecheck, test ve lint temiz gecer.

## Riskler

- Mevcut testler flat shape'e bagli oldugu icin refactor sirasinda beklenen test kirilmalari olacaktir.
- Farkli middleware'lerde dogrudan JSON yazan hata cevaplari tek helper'a tasinirken status/message davranisi istemeden degisebilir.
- 401, 409, 429 ve 503 gibi kodlar icin mevcut merkezi mapping eksik oldugundan yanlis `INTERNAL_ERROR` code'u donme riski vardir.
- Payload-too-large ve malformed JSON hatalarinda Express/body-parser error objesi internal mesaj tasiyabilir; response body'ye sizdirilmamalidir.
- CORS config bu fazin kapsami degildir; CORS error response contract'i degisirken allowlist davranisi degistirilmemelidir.
- `npm run check` mevcut `package.json` icinde `biome check --write .` calistirir; dogrulama raporunda write davranisi belirtilmelidir.

## Açık Sorular ve Çelişkiler

- Kaynak dokuman `src/http/errors.ts` veya `src/http/responses.ts` secenegi verir; helper dosyasinin kesin adi implementasyon oncesi raporlanmalidir.
- Kaynak dokuman `AppError` class veya factory modeline izin verir; hangisinin secilecegi uygulama oncesi net yazilmalidir.
- Mevcut kodda auth zorunlu endpoint veya `requireAuth` yoktur; 401 testinin bu fazda uygulanabilir olup olmadigi mevcut davranisa gore raporlanmalidir.
- Mevcut `/health/ready` 503 cevaplari body olmadan doner; kaynak planin "tum hata cevaplari" ifadesinin health readiness cevaplarini kapsayip kapsamadigi acik degildir.
- Kaynak dokumandaki Production CORS allowlist config modeli acik karardir; bu faz CORS error contract'ini kapsar, CORS config kararini cozmez.
- Kaynak dokumanda public/API-key tabanli machine-to-machine API olup olmayacagi aciktir; bu faz auth modeli uretmez.
