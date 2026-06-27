# Error Contract Test Matrix

Bu matris Error Contract fazinda guncellenecek veya eklenecek testleri tarif eder. Mevcut test altyapisi `node:test` ve `supertest` uzerindedir; proje komutu `npm test` ile `tsx --test src/**/*.test.ts` calisir.

## Test Notları

- Mevcut app-level test dosyasi: `src/app.test.ts`.
- Mevcut testler flat shape assert eder; Error Contract fazinda nested shape'e guncellenmelidir.
- Yeni helper testleri gerekirse mevcut test framework'una uygun `*.test.ts` dosyalari onerilebilir.
- Error Logging fazina ait kapsamli requestId/stack observability testleri bu fazin ana kapsami degildir; ancak mevcut logging davranisi bozulmamalidir.

| Senaryo | Hata kaynağı | Beklenen HTTP status | Beklenen error code | Beklenen response shape | `details` beklentisi | Logging beklentisi | Mevcut test var mı? | Güncellenecek veya eklenecek test dosyası | Acceptance criterion karşılığı |
|---|---|---:|---|---|---|---|---|---|---|
| 400 bad request | Malformed JSON, `express.json` parse hatasi | 400 | `BAD_REQUEST` | Nested `{ error: { code, message, details } }` | `{}` veya guvenli parse detayi; raw parser/internal detay yok | Mevcut pino-http 4xx warn davranisi bozulmaz | Var, flat shape ile | `src/app.test.ts` guncelle | 400 durumu test edilir; tum hata cevaplari nested contract kullanir |
| 401 unauthenticated | Mevcut auth middleware varsa auth olmayan request | 401 | `UNAUTHENTICATED` | Nested `{ error: { code, message, details } }` | Credential/session internal detayi yok | 4xx client/auth hatasi olarak ele alinmali | Yok; mevcut `requireAuth` yok | Uygulanabiliyorsa `src/app.test.ts` veya ilgili auth test dosyasi | Mevcut auth davranisi varsa 401 durumu test edilir |
| 403 CSRF | `src/auth/csrf.ts` unsafe request, token yok/gecersiz | 403 | `FORBIDDEN` | Nested `{ error: { code, message, details } }` | `{}`; token degeri response'a yazilmaz | Mevcut pino-http 4xx warn davranisi bozulmaz | Var, flat shape ile | `src/app.test.ts` guncelle | Not-found, CSRF ve rate-limit ayni error contract'i kullanir |
| 403 CORS | `src/security/cors.ts` disallowed origin `CorsError` | 403 | `FORBIDDEN` | Nested `{ error: { code, message, details } }` | `{}`; origin policy internal detayi yok | Mevcut pino-http 4xx warn davranisi bozulmaz | Var, flat shape ile | `src/app.test.ts` guncelle | Tum hata cevaplari nested error contract kullanir |
| 404 not found | `src/middlewares/not-found.middleware.ts` | 404 | `NOT_FOUND` | Nested `{ error: { code, message, details } }` | Genellikle `{}` | Mevcut pino-http 4xx warn davranisi bozulmaz | Var, flat shape ile | `src/app.test.ts` guncelle | 404 durumu test edilir |
| 413 payload too large | `express.json` veya `express.urlencoded` body limit asimi | 413 | `PAYLOAD_TOO_LARGE` | Nested `{ error: { code, message, details } }` | Internal parser/body detayi yok | Mevcut pino-http 4xx warn davranisi bozulmaz | Yok | `src/app.test.ts` ekle | 413 durumu test edilir; internal detail sizmaz |
| 429 rate limited | `src/security/rate-limit.ts` limit asimi | 429 | `TOO_MANY_REQUESTS` | Nested `{ error: { code, message, details } }` | `{}` veya guvenli rate metadata; kaynakta kesin metadata karari yok | Mevcut pino-http 4xx warn davranisi bozulmaz | Yok | `src/app.test.ts` veya rate-limit icin uygun yeni test dosyasi | 429 durumu test edilir; rate-limit ayni contract'i kullanir |
| 503 rate-limit store unavailable | Production rate-limit store error branch | 503 | `SERVICE_UNAVAILABLE` | Nested `{ error: { code, message, details } }` | Redis/store internal detayi yok | 5xx olarak error seviyesinde loglanir; kapsamli stack/requestId testi sonraki faz | Yok | Rate-limit icin uygun app veya unit test | Tum hata cevaplari nested contract kullanir; internal detail sizmaz |
| Bilinen `AppError` | Handler veya service tarafindan uretilen application hatasi | AppError status | AppError code | Nested `{ error: { code, message, details } }` | Sadece guvenli, JSON-serializable details | Status 4xx/5xx davranisina gore mevcut log seviyesi korunur | Yok; `AppError` henuz yok | Oneri: helper/error middleware test dosyasi veya `src/app.test.ts` | Bilinen `AppError` status/code/message/details ile doner |
| Bilinmeyen exception | Express 5 async route throw | 500 | `INTERNAL_ERROR` | Nested `{ error: { code, message, details } }` | `{}`; stack/cause/internal detail yok | 5xx error seviyesinde mevcut logging bozulmaz | Var, flat shape ile | `src/app.test.ts` guncelle | Bilinmeyen hata `500 INTERNAL_ERROR` doner |
| 500 response'unda internal detail sizmamasi | Unknown error message, stack, cause veya DB-like detay | 500 | `INTERNAL_ERROR` | Nested `{ error: { code, message, details } }` | Stack, cause, SQL/internal DB detayi yok | 5xx log davranisi korunur | Kismi; sadece code assert var | `src/app.test.ts` veya error middleware test dosyasi ekle | 500 response'unda stack veya internal detail bulunmaz |
| `details` alaninin guvenli veri tasimasi | Bilinen `AppError` guvenli details ile | AppError status | AppError code | Nested `{ error: { code, message, details } }` | Guvenli JSON-serializable obje doner | Log beklentisi status'a gore degismez | Yok | Oneri: helper/error middleware test dosyasi | `details` yalnizca guvenli veri icerir |
| Eski flat shape'in donmemesi | Not-found, CSRF, malformed JSON, unknown exception | Ilgili status | Ilgili code | `body.error.code` vardir; `body.error` string degildir | Ilgili scenario'ya gore | Mevcut logging bozulmaz | Yok; mevcut testler flat shape bekliyor | `src/app.test.ts` guncelle | Tum hata cevaplari nested error contract kullanir |

## Eksik Test Alanları

- 413 payload-too-large mevcutta test edilmemis.
- 429 rate-limit mevcutta test edilmemis.
- `AppError` henuz olmadigi icin bilinen application error mapping'i test edilmemis.
- 401 unauthenticated mevcutta uygulanabilir bir `requireAuth` endpoint'i olmadigi icin bu fazda test edilebilirlik implementasyon oncesi raporlanmalidir.
- Internal detail sizmamasi icin explicit negative assertion'lar eklenmelidir.
