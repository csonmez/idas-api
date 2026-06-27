# Error Contract Flow

Bu dosya Error Contract fazinda uygulanacak merkezi hata akisini Mermaid diyagramlariyla gosterir. Diyagramlar implementation contract seviyesindedir; diger roadmap fazlarini kapsama dahil etmez.

## Diyagram 1: Hatanın Oluşması ve Merkezi İşlenmesi

```mermaid
flowchart TD
  MW[Middleware]
  H[Handler]
  S[Service]
  R[Repository]
  E[Olusan hata]
  EH[Merkezi error handler]
  RESP["Standard error response<br/>{ error: { code, message, details } }"]
  SCOPE1[Service Express Response bilmez]
  SCOPE2[Repository Express Response bilmez]

  MW -->|throw, next veya AppError| E
  H -->|throw, next veya AppError| E
  S -->|AppError veya hata firlatir| E
  R -->|Persistence hatasi firlatir| E
  S -.-> SCOPE1
  R -.-> SCOPE2
  E --> EH
  EH --> RESP
```

### Amaç

Middleware, handler, service veya repository katmanindan cikan hatalarin tek merkezi error handler tarafindan standard response'a cevrilmesini gosterir.

### Kaynak Kararlar

- Service katmani Express `Response` bilmez; hata gerekiyorsa `AppError` firlatir.
- Handler/middleware katmani dogrudan custom JSON error yazmak yerine helper veya `AppError` kullanir.
- Tum hata cevaplari `{ error: { code, message, details } }` seklinde doner.

### Değişmez Kurallar

- Service ve repository Express response olusturmaz.
- Hata response shape'i middleware'e gore degismez.
- Success response'lara bu fazda zorunlu wrapper eklenmez.

### Acceptance Criteria

- Not-found, CSRF, rate-limit, payload-too-large ve unknown exception ayni nested contract'i kullanir.
- Handler/service kaynakli bilinen hatalar `AppError` veya kaynak planla uyumlu factory modeli ile merkezi handler'a akar.

## Diyagram 2: AppError ve Bilinmeyen Hata Ayrımı

```mermaid
flowchart TD
  START[Error handler hatayi alir]
  SENT{Headers sent mi?}
  NEXT[Express next error akisi]
  CHECK{Hata AppError mi?}
  APP[status, code, message ve guvenli details kullan]
  UNKNOWN["500 INTERNAL_ERROR olustur<br/>message: Internal server error"]
  LOG{Hata 5xx mi?}
  LOGGED[Internal hata loglanir]
  REDACT[Stack, cause ve internal details response'tan cikarilir]
  RESP["Nested error response gonderilir<br/>{ error: { code, message, details } }"]

  START --> SENT
  SENT -- "Evet" --> NEXT
  SENT -- "Hayir" --> CHECK
  CHECK -- "Evet" --> APP
  CHECK -- "Hayir" --> UNKNOWN
  APP --> LOG
  UNKNOWN --> LOG
  LOG -- "Evet" --> LOGGED
  LOG -- "Hayir" --> REDACT
  LOGGED --> REDACT
  REDACT --> RESP
```

### Amaç

Bilinen application hatalari ile bilinmeyen exception'larin nasil ayrildigini ve response body'ye yalnizca guvenli alanlarin yazilacagini gosterir.

### Kaynak Kararlar

- `errorHandler`, `AppError` hatalarini status/code/message/details ile standart response'a map eder.
- Bilinmeyen hatalar her zaman 500 `INTERNAL_ERROR` olarak doner.
- `details` sadece client'a gosterilmesi guvenli, JSON-serializable veri tasir.
- `cause`, stack veya internal DB hata detayi response body'ye yazilmaz.
- 500 hatalarda public message sabit kalir: `Internal server error`.

### Değişmez Kurallar

- AppError olmayan internal hata client'a raw message, stack, cause veya DB detayi dondurmez.
- `details` alani guvenli degilse bos obje olarak donmelidir.
- Headers zaten gonderilmisse Express'in mevcut error akisi korunur.

### Acceptance Criteria

- Bilinmeyen async route exception'i `500 INTERNAL_ERROR` nested contract ile doner.
- 500 response body icinde `stack`, `cause`, SQL mesaji veya internal DB detayi bulunmaz.
- Bilinen `AppError` status, code, message ve guvenli details ile doner.

## Diyagram 3: HTTP Hata Kaynakları

```mermaid
flowchart LR
  REQ[Request veya route hatasi]
  CSRF[CSRF hatasi]
  RATE[Rate-limit hatasi]
  PAYLOAD[Payload-too-large hatasi]
  NF[Not-found]
  APP[Bilinen application hatasi]
  UNKNOWN[Bilinmeyen exception]
  CONTRACT[Merkezi error contract]
  RESP["{ error: { code, message, details } }"]

  REQ -->|400 BAD_REQUEST| CONTRACT
  CSRF -->|403 FORBIDDEN| CONTRACT
  RATE -->|429 TOO_MANY_REQUESTS veya 503 SERVICE_UNAVAILABLE| CONTRACT
  PAYLOAD -->|413 PAYLOAD_TOO_LARGE| CONTRACT
  NF -->|404 NOT_FOUND| CONTRACT
  APP -->|AppError code ve status| CONTRACT
  UNKNOWN -->|500 INTERNAL_ERROR| CONTRACT
  CONTRACT --> RESP
```

### Amaç

Mevcut projede farkli yerlerden uretilen hata kaynaklarinin tek response contract'a baglanmasini gosterir.

### Kaynak Kararlar

- `error.middleware.ts`, `not-found.middleware.ts`, `csrf.ts`, `rate-limit.ts` merkezi helper'i kullanmalidir.
- 400, 403, 404, 413, 429 ve 500 durumlari test edilmelidir.
- Bilinmeyen hatalar `INTERNAL_ERROR` olarak donmelidir.

### Değişmez Kurallar

- CSRF ve rate-limit kendi ozel flat JSON formatlarini uretmez.
- Payload parser internal detayi response body'ye yazilmaz.
- CORS config veya allowlist modeli bu diyagram kapsaminda degistirilmez.

### Acceptance Criteria

- Eski flat `{ error, message, details }` shape'i error kaynaklarindan donmez.
- Tum listelenen hata kaynaklari nested `{ error: { code, message, details } }` contract'i kullanir.
- 429 ve 503 rate-limit davranisinda status korunurken response shape standartlasir.
