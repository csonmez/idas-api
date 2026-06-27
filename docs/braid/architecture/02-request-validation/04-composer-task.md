# Request Validation Implementation Task

## Görev

Yalnizca roadmap'in ikinci adimi olan Request Validation altyapisini uygula.

Production davranisinda bu fazin gerektirmedigi degisiklik yapma. Authorization, users module, academic organization, repository/service mimarisi, soft delete, error logging refactor'u veya CORS config fazlarina baslama.

## Okunacak Kaynaklar

- `AGENTS.md`, varsa
- `.wrongstack/AGENTS.md`, proje icinde mevcut oldugu icin kontrol et
- `docs/7_ARCHITECTURE_IMPROVEMENT_PLAN.md`
- `docs/braid/architecture/00-roadmap.md`
- `docs/braid/architecture/01-error-contract/01-plan.md`
- `docs/braid/architecture/01-error-contract/02-error-flow.md`
- `docs/braid/architecture/01-error-contract/03-test-matrix.md`
- `docs/braid/architecture/01-error-contract/04-composer-task.md`
- `docs/braid/architecture/02-request-validation/01-plan.md`
- `docs/braid/architecture/02-request-validation/02-validation-flow.md`
- `docs/braid/architecture/02-request-validation/03-test-matrix.md`
- Guncel Error Contract production kodu:
  - `src/http/errors.ts`
  - `src/middlewares/error.middleware.ts`
  - `src/middlewares/not-found.middleware.ts`
  - `src/auth/csrf.ts`
  - `src/security/rate-limit.ts`
  - `src/app.ts`
  - `src/routes/index.ts`
  - `src/app.test.ts`

## Kodlamadan Önce

Composer sunlari raporlasin:

1. Mevcut Zod kullanim noktalari
2. Olusturacagi dosyalar
3. Degistirecegi dosyalar
4. Error Contract ile entegrasyon sekli
5. Request mutation yaklasimi
6. Yazacagi testler
7. Acik sorular ve teknik kısıtlar
8. Scope disi ise baslamayacagini dogrulamasi

Kodlamadan once ozellikle su teknik kısıtı raporla: Express 5.2.1 `req.query` alanini getter olarak tanimlar ve setter yoktur. `req.query` uzerinden canonical degerin handler'a gorunmesi testle kanitlanmalidir.

## Implementasyon Kuralları

- Yalnizca Request Validation fazini uygula.
- `validateBody`, `validateQuery` ve `validateParams` helper/middleware'larini olustur.
- Mevcut Zod dependency'sini kullan.
- Yeni dependency ekleme.
- Validation hatalarini `VALIDATION_ERROR` olarak uret.
- HTTP status merkezi AppError code/status mapping uzerinden 400 olmali.
- Error Contract fazindaki merkezi error middleware'i kullan.
- Dogrudan custom error JSON yazma.
- Field-level hatalari `error.details.fields` altinda dondur.
- Basarili parse sonrasinda canonical parsed degeri ilgili request alanina yaz.
- Basarisiz parse durumunda request alanini degistirme.
- Parsed veriyi `res.locals` altinda tasima.
- Raw body saklama.
- Domain is kurali ekleme.
- Authorization kodu ekleme.
- Users veya baska domain modulu olusturma.
- Bütün mevcut route'lari topluca refactor etme.
- Ilgisiz production koduna dokunma.
- Basarili response contract'larini degistirme.
- Kaynaklarda olmayan davranisi uydurma.
- Teknik engel varsa tahmin ederek workaround yapma; raporla.
- Nested object ve array path formatini uygulamadan once raporla; kaynaklarda kesin karar yoktur.
- Async Zod refinement destegini zorunlu scope kabul etme; gerekiyorsa acik soru olarak raporla.
- Unknown key davranisini Zod schema davranisina birak; global custom schema framework'u yazma.

## Test Kuralları

- Body, query ve params icin basarili ve basarisiz akislari test et.
- Gercek Express middleware zinciri uzerinden integration testleri ekle.
- Handler'in validation basarisizliginda calismadigini dogrula.
- Canonical parsed degerlerin handler'a ulastigini dogrula.
- Nested validation error response'u dogrula.
- Field-level details yapisini dogrula.
- Mevcut Error Contract testlerinin bozulmadigini dogrula.
- `req.query` canonical mutation davranisini Express 5.2.1 runtime'inda test et.
- Validation basarisiz oldugunda request alaninin degismedigini test et.
- Validation basarili oldugunda yalnizca hedef request alaninin degistigini test et.
- Test-only route veya fixture kullanirsan production router'a ekleme.
- Mevcut `GET /api/csrf-token` success response'unun degismedigini koru.

## Doğrulama

`package.json` icindeki gercek scriptleri kontrol et ve uygun komutlari calistir.

En az:

```bash
npm run typecheck
npm test
```

Biome script'i write islemi yapiyorsa once yazmayan kontrol komutunu kullan. Bu projede `npm run check`, `biome check --write .` calistirir.

Degisiklikler tamamlandiktan sonra gerektiginde:

```bash
npx biome check <degistirilen-dosyalar>
git diff --check
```

calistir.

`npm run check` kullanilirsa dosya yazabilecegini sonuc raporunda acikca belirt ve sonrasinda diff'i kontrol et.

## Sonuç Raporu

Composer sunlari raporlasin:

1. Eklenen dosyalar
2. Degistirilen dosyalar
3. Helper sozlesmeleri
4. Error Contract entegrasyonu
5. Request mutation davranisi
6. Eklenen testler
7. Acceptance criterion -> test eslesmesi
8. Calistirilan komutlar ve sonuclari
9. Scope disi degisiklikler
10. Kalan acik sorular

## Scope Kontrol Listesi

- Request Validation disinda production davranisi degistirilmedi.
- Error Contract fazi bypass edilmedi.
- Validation hatalari `VALIDATION_ERROR` ve HTTP 400 oldu.
- Field-level details `error.details.fields` altinda dondu.
- Basarili parse sonrasi handler canonical body/query/params degerini gordu.
- Basarisiz parse sonrasi handler calismadi.
- Basarisiz parse sonrasi request alani degismedi.
- Parsed veri `res.locals` altina yazilmadi.
- Raw request body tutulmadi.
- Yeni dependency eklenmedi.
- Domain module, authorization veya sonraki roadmap fazlari baslatilmadi.
- Typecheck, test ve ilgili Biome kontrolleri raporlandi.
