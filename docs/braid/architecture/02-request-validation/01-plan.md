# Request Validation Plan

## Amaç

Request Validation fazinin amaci, API endpointleri cogalmadan once request body, query ve params parsing davranisini tek ve test edilebilir bir middleware standardina baglamaktir. Bu faz sayesinde handler'lar raw HTTP input yerine Zod tarafindan validate, normalize veya coerce edilmis canonical degerlerle calisir; validation hatalari da tamamlanmis Error Contract fazindaki nested response yapisi ile tutarli bicimde doner.

Bu faz uygulama is kurali, authorization veya domain module kurulumu yapmaz. Sadece request contract'ini guvenilir hale getirecek ortak altyapiyi tarif eder.

## Önceki Faza Bağımlılıklar

Error Contract fazindan kullanilacak kesin parcalar:

- `src/http/errors.ts` icindeki `AppError`
- `src/http/errors.ts` icindeki `AppErrorCode`
- `AppErrorCode` -> HTTP status mapping; `VALIDATION_ERROR` bugun 400'e map edilir.
- `src/middlewares/error.middleware.ts` merkezi error middleware'i
- Nested error response: `{ "error": { "code", "message", "details" } }`
- `sanitizeDetails` ile guvenli, JSON-serializable `details` modeli

Mevcut `AppError` sozlesmesi:

```ts
new AppError(code, message, details?)
```

Status code constructor'a verilmez; `src/http/errors.ts` icindeki mapping'den turetilir. Bu fazdaki validation helper'lari hata durumunda `new AppError('VALIDATION_ERROR', 'Request validation failed', { fields })` ureterek merkezi `errorHandler` akisina girmelidir.

## Mevcut Durum

- `package.json` Zod dependency'sini `"zod": "^4.4.3"` olarak tanimlar; `package-lock.json` ve local runtime'da kurulu surum `4.4.3` olarak dogrulandi.
- Mevcut Zod kullanimi sadece `src/config/env.ts` icindedir. `envSchema` `z.object(...)`, `z.enum(...)`, `z.string().min(...)` ve `z.coerce.number().int().default(3000)` kullanir.
- Env validation disinda API request validation yoktur. `validateBody`, `validateQuery`, `validateParams`, `safeParse`, `parseAsync` veya route seviyesinde Zod schema kullanimi bulunmuyor.
- `src/app.ts` `/api` altinda `express.json({ limit: '1mb' })` ve `express.urlencoded({ extended: true, limit: '100kb' })` kullanir. Malformed JSON ve payload-too-large hatalari merkezi `errorHandler` uzerinden nested Error Contract'a map edilir.
- `src/routes/index.ts` bugun sadece `GET /api/csrf-token` endpointini tanimlar; body, query veya params okuyan production endpoint yoktur.
- Manuel body kontrolu production route'larinda yoktur. Unsafe requestlerde `src/auth/csrf.ts` CSRF header/session token kontrolu yapar, ancak body validation yapmaz.
- Manuel query kontrolu production route veya middleware'lerde yoktur.
- Manuel params kontrolu production route veya middleware'lerde yoktur.
- `req.body` production kodunda request data olarak okunmuyor; `src/logger/index.ts` sadece pino redaction path'lerinde `req.body.password`, `req.body.token`, `req.body.passwordConfirm`, `req.body.currentPassword`, `req.body.newPassword` tanimlar.
- `req.query` ve `req.params` production application kodunda okunmuyor.
- Mevcut validation benzeri hatalar su sekilde uretilir:
  - `src/config/env.ts`: startup sirasinda Zod parse hatasi firlatir; HTTP response degildir.
  - `express.json`: malformed JSON icin `BAD_REQUEST` 400.
  - `express.json` veya `express.urlencoded`: payload limit icin `PAYLOAD_TOO_LARGE` 413.
  - `src/auth/csrf.ts`: gecersiz token icin `FORBIDDEN` 403.
  - `src/middlewares/request-id.middleware.ts`: gecersiz `x-request-id` header'ini hata olarak dondurmez, yeni id uretir.
- `src/http/errors.ts` `VALIDATION_ERROR` kodunu 400 status ile zaten icerir; Error Contract entegrasyonu icin yeni status mapping gerekmez.
- `src/middlewares/error.middleware.ts` `AppError` instance'larini status/code/message/details ile nested response'a cevirir. 5xx `AppError` detaylari guvenli internal contract'a normalize edilir; `VALIDATION_ERROR` 4xx oldugu icin message/details korunur.
- Express 5 async error propagation mevcut testlerle kanitlanmis durumda: `src/app.test.ts` icinde async route throw eden test `errorHandler` ile 500 nested response bekler.
- TypeScript request typing yaklasimi sade Express tipleridir. Kod `Request`, `Response`, `NextFunction` ve `RequestHandler` tiplerini dogrudan kullanir; custom validated request type veya module augmentation yoktur.
- Test framework'u `node:test`, `node:assert/strict`, `supertest` ve `tsx --test src/**/*.test.ts` uzerindedir.
- HTTP integration test pattern'i iki sekildedir:
  - `createApp(createTestDeps(...))` ile tam app pipeline testleri.
  - Kucuk `express()` app kurup route + `errorHandler` ekleyerek middleware/error davranisi testleri.
- Zod `z.object(...)` unknown key davranisi local Zod 4.4.3 ile dogrulandi: varsayilan olarak bilinmeyen key'leri strip eder; `.strict()` hata verir; `.passthrough()` unknown key'leri korur.
- Query string ve route params HTTP'den string olarak gelir. Number, boolean, enum normalize etme gibi ihtiyaclarda schema tarafinda `z.coerce.*`, `z.preprocess` veya transform kullanimi gerekir.
- Helper'lari kanitlamak icin mevcut production endpoint uygun degildir; `GET /api/csrf-token` sadece session token uretir ve request body/query/params contract'i tasimaz. En dusuk riskli test pattern'i, production router'a eklenmeyen test-only Express app/route fixture kullanmaktir.
- `src/modules/` ve `src/modules/authorization/` klasorleri mevcut olsa da production domain module dosyasi yoktur. Bu faz domain module veya `*.schemas.ts` dosyasi olusturmak zorunda degildir; ileride domain modulleri kendi schema'larini ilgili `*.schemas.ts` dosyalarinda tutmalidir.
- Express 5.2.1 runtime'da `req.query` prototype uzerinde getter olarak tanimlidir ve setter yoktur. Descriptor configurable oldugu icin dogrudan assignment yerine Express-compatible teknikle request instance uzerinde parse sonrasi canonical query degeri tanimlanmalidir. Bu teknik sadece parse basarili olduktan sonra kullanilmalidir.

## Hedef Durum

Bu faz asagidaki helper/middleware sozlesmelerini standartlastirir:

```ts
validateBody(schema)
validateQuery(schema)
validateParams(schema)
```

Her helper:

- Ilgili request alanini okur.
- Zod ile dogrular.
- Basarili parse sonrasinda canonical parsed degeri ayni request alani uzerine yazar.
- Basarisiz parse durumunda `VALIDATION_ERROR` uretir.
- Handler calismadan akisi durdurur.
- Hata response'unu dogrudan yazmaz; merkezi Error Contract akisina girer.

Kesin generic TypeScript imzasi bu dokumanda zorunlu mimari karar degildir. Mevcut proje Express `RequestHandler` tipini kullandigi ve validated request type pattern'i henuz olmadigi icin ilk implementasyon sade ve uyumlu `RequestHandler` dondurebilir. Daha guclu generic typing onerilecekse Zod 4.4.3 ve `@types/express` 5.0.6 ile typecheck edilerek uygulanmalidir.

## Validation Error Contract

Hedef response:

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

Field hata formati, Error Contract fazindaki JSON-safe details modeliyle uyumlu olmalidir:

```ts
Record<string, string[]>
```

Bu deger `details.fields` altinda tasinacagi icin pratik shape:

```ts
{
  fields: Record<string, string[]>
}
```

Zod issue'lari birden fazla mesaji ayni field key'i altinda toplayabilmelidir. `src/http/errors.ts` icindeki `sanitizeDetails` string array iceren nested objeleri JSON-safe kabul eder.

Nested object ve array path'leri icin Zod issue path'i `string | number` segmentlerinden olusur. Mevcut kaynaklar kesin path formatini belirlemiyor. Onerilen, uygulanmasi kolay ve okunabilir format dot/bracket formatidir:

- `user.email`
- `tags[0]`
- `addresses[1].city`

Bu format kesin kaynak karari degildir; implementasyon oncesi acik soru olarak raporlanmalidir. Format secilirse test matrisiyle sabitlenmelidir.

Root-level Zod issue path'i bos olabilir. Root-level hatalarin hangi field key'i altinda donecegi kaynaklarda net degildir; acik soru olarak kalir.

## Request Mutation Kuralları

- Basarili body parse sonrasi yalnizca `req.body` degistirilir.
- Basarili query parse sonrasi yalnizca `req.query` degistirilir.
- Basarili params parse sonrasi yalnizca `req.params` degistirilir.
- Parse basarisiz oldugunda hedef request alani degistirilmez.
- Parsed veri `res.locals` altinda tutulmaz.
- Raw request body saklanmaz.
- Handler sadece canonical parsed degeri gorur.
- Body helper query veya params alanina dokunmaz.
- Query helper body veya params alanina dokunmaz.
- Params helper body veya query alanina dokunmaz.

Express 5.2.1 teknik notu: `req.query` getter olarak gelir ve setter'i yoktur. Bu nedenle `req.query = parsed` tarzi dogrudan assignment guvenilir bir implementasyon sozlesmesi olarak kabul edilmemelidir. Hedef davranis yine `req.query` uzerinden canonical degerin gorulmesidir; bunu saglayan teknik sadece validation basarili olduktan sonra uygulanmalidir ve testle kanitlanmalidir.

## Helper Sorumlulukları

### `validateBody(schema)`

- Input: Zod schema ve `req.body`.
- Output: Express middleware/`RequestHandler`.
- Basarili davranis: `schema` ile parse eder, canonical sonucu `req.body` uzerine yazar, `next()` ile handler'a gecer.
- Basarisiz davranis: Zod issue'larini field map'e cevirir, `new AppError('VALIDATION_ERROR', 'Request validation failed', { fields })` ile `next(error)` akisina girer.
- Error Contract entegrasyonu: Dogrudan JSON response yazmaz; merkezi `errorHandler` nested response'u uretir.
- Request mutation davranisi: Sadece parse basariliysa ve sadece `req.body` degisir.
- TypeScript typing beklentisi: Ilk fazda `RequestHandler` yeterlidir; generic request body typing uygulanacaksa mevcut Express 5 ve Zod 4 surumleriyle typecheck edilmelidir.

### `validateQuery(schema)`

- Input: Zod schema ve `req.query`.
- Output: Express middleware/`RequestHandler`.
- Basarili davranis: Query object'i parse eder, canonical sonucu `req.query` uzerinden handler'a gorunur hale getirir, `next()` ile devam eder.
- Basarisiz davranis: Zod issue'larini field map'e cevirir, `VALIDATION_ERROR` `AppError` uretir.
- Error Contract entegrasyonu: Dogrudan JSON response yazmaz.
- Request mutation davranisi: Sadece parse basariliysa ve sadece query alani degisir. Express 5 getter kısıtı nedeniyle teknik uygulama testle dogrulanmalidir.
- TypeScript typing beklentisi: Query string coercion schema tarafinda yapilir; middleware tipi mevcut projeyle uyumlu kalir.

### `validateParams(schema)`

- Input: Zod schema ve `req.params`.
- Output: Express middleware/`RequestHandler`.
- Basarili davranis: Params object'i parse eder, canonical sonucu `req.params` uzerine yazar, `next()` ile devam eder.
- Basarisiz davranis: Zod issue'larini field map'e cevirir, `VALIDATION_ERROR` `AppError` uretir.
- Error Contract entegrasyonu: Dogrudan JSON response yazmaz.
- Request mutation davranisi: Sadece parse basariliysa ve sadece `req.params` degisir.
- TypeScript typing beklentisi: Express params tipi string tabanli oldugu icin runtime canonical degerler TypeScript ile farklilasabilir; generic typing bu fazda zorunlu karar degildir.

## Scope

Bu fazda yapilacaklar:

- Ortak request validation helper/middleware'lari
- Zod error -> field error mapping
- Error Contract entegrasyonu
- Body/query/params canonical parsing
- Helper unit veya integration testleri
- Gerekirse production router'a eklenmeyen minimum test route'u veya test fixture'i

## Scope Dışı

Bu fazda yapilmayacaklar:

- Authorization
- Users module
- Academic organization
- Repository veya service mimarisi
- Soft delete
- CORS config
- Error logging refactor'u
- Bütün mevcut route'larin topluca validation yapisina gecirilmesi
- Raw request audit sistemi
- Custom schema framework'u
- Ilgisiz refactor
- Yeni validation dependency'si

## Etkilenmesi Beklenen Dosyalar

Olusturulmasi beklenen dosyalar:

- Oneri: `src/http/request-validation.ts` veya `src/middlewares/request-validation.middleware.ts`
- Oneri: helper testleri icin `src/http/request-validation.test.ts` veya mevcut test organizasyonuna uygun yeni `*.test.ts`

Degistirilmesi beklenen dosyalar:

- `src/http/errors.ts`: Muhtemelen degismez; `VALIDATION_ERROR` mapping zaten var.
- `src/middlewares/error.middleware.ts`: Muhtemelen degismez; `AppError` mapping zaten nested contract uretir.
- `src/app.ts`: Global middleware mount gerekmeyebilir; validation helper route seviyesinde kullanilmalidir.
- `src/routes/index.ts`: Mevcut production endpointleri topluca refactor edilmemelidir. Test-only route production router'a eklenmemelidir.

Test dosyalari:

- Oneri: Yeni request validation integration test dosyasi, kucuk `express()` app + validation helper + `errorHandler` pattern'iyle.
- Alternatif: `src/app.test.ts` icine sadece helper contract testleri eklemek. Mevcut dosya zaten app ve error middleware testlerini tasidigi icin buyuyebilir; yeni test dosyasi daha temiz olabilir.

Gerekirse test-only route veya fixture:

- Production router'a mount edilmeyen, sadece test icinde tanimli `POST /body`, `GET /query`, `GET /items/:id` gibi kucuk route'lar kullanilabilir.

## Değişmez Kurallar

- Validation helper'lari Error Contract fazini bypass etmez.
- Dogrudan custom JSON error response yazilmaz.
- Validation hatasi HTTP 400 ve `VALIDATION_ERROR` olur.
- Hata details degeri JSON-safe olur.
- Parse basarisizsa handler calismaz.
- Parse basarisizsa request alani degistirilmez.
- Parse basariliysa handler canonical parsed degeri gorur.
- `res.locals` kullanilmaz.
- Raw body tutulmaz.
- Domain is kurallari validation helper icine yazilmaz.
- Authorization kontrolu validation helper icine yazilmaz.
- Yeni dependency eklenmez.
- Her helper ayni error mapping standardini kullanir.

## Acceptance Criteria

1. Gecerli body parse edilir ve handler canonical body degerini gorur.
2. Gecersiz body HTTP 400 `VALIDATION_ERROR` dondurur.
3. Gecerli query coercion sonrasi handler canonical query degerini gorur.
4. Gecersiz query HTTP 400 `VALIDATION_ERROR` dondurur.
5. Gecerli params parse edilir ve handler canonical params degerini gorur.
6. Gecersiz params HTTP 400 `VALIDATION_ERROR` dondurur.
7. Field-level hatalar `error.details.fields` altinda bulunur.
8. Validation basarisiz oldugunda handler calismaz.
9. Validation basarisiz oldugunda request alani degistirilmez.
10. Validation basarili oldugunda yalnizca hedef request alani degistirilir.
11. Error response mevcut nested contract ile uyumludur.
12. Typecheck, test ve ilgili Biome kontrolleri temizdir.

## Riskler

- Express request alanlarinin mutation davranisi helper implementasyonunu etkileyebilir.
- Express 5.2.1 `req.query` getter/setter davranisi dogrudan assignment'i engelleyebilir; testle dogrulanmalidir.
- Query object prototype veya getter davranisi parsed degerin handler'a nasil tasinacagini etkileyebilir.
- Zod coercion sonucunda beklenmeyen deger donusumleri olabilir; ozellikle `z.coerce.boolean()` string `"false"` gibi degerlerde dikkatle test edilmelidir.
- Unknown key davranisi Zod 4.4.3 `z.object(...)` icin varsayilan strip'tir; bu handler'in extra alanlari gormemesine neden olabilir.
- Nested field path mapping formatinin net olmamasi client contract'ini etkiler.
- Request typing ile runtime canonical degerler farklilasabilir; TypeScript tarafinda gereksiz guven hissi olusabilir.
- Helper gerektiginden fazla abstraction haline gelirse domain schema ve route okunabilirligi azalabilir.
- Test route'un production router'a yanlislikla eklenmesi public API davranisini degistirir.

## Açık Sorular ve Çelişkiler

- Nested object ve array field path'leri icin kesin string format ne olacak? Oneri: `user.email`, `tags[0]`.
- Root-level Zod issue'lari `fields` altinda hangi key ile temsil edilecek?
- Async Zod refinement veya `parseAsync` destegi bu fazda zorunlu mu? Kaynak plan bunu acikca istemiyor.
- Helper dosyasinin kesin yeri `src/http/`, `src/middlewares/` veya baska bir klasor mu olacak?
- TypeScript generic imza ne kadar guclu olacak? Mevcut proje bunu zorunlu kilmiyor.
- `req.query` mutation icin kullanilacak teknik implementation detayi ne olacak? Express 5 getter kısıtı dogrulandi; davranis testle sabitlenmeli.
- Unknown key davranisi domain schema'larinda default strip olarak mi kabul edilecek, yoksa schema bazinda `.strict()`/`.passthrough()` karari mi verilecek?
- Validation helper testleri yeni dosyada mi, yoksa mevcut `src/app.test.ts` icinde mi tutulacak?
