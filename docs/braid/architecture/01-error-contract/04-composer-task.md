# Cursor Composer Task: Error Contract

## Görev

Yalnizca roadmap'in ilk adimi olan Error Contract fazini uygula.

Bu gorev production kodunda sadece Error Contract fazinin gerektirdigi degisiklikleri yapmalidir. Request validation, authorization, domain module, users use-case, academic organization, soft delete, error logging refactor'u ve CORS config fazlarina baslama.

## Okunacak Kaynaklar

- `AGENTS.md`, varsa
- `docs/7_ARCHITECTURE_IMPROVEMENT_PLAN.md`
- `docs/braid/architecture/01-error-contract/01-plan.md`
- `docs/braid/architecture/01-error-contract/02-error-flow.md`
- `docs/braid/architecture/01-error-contract/03-test-matrix.md`

## Kodlamadan Önce

Kod yazmadan once su raporu ver:

1. Mevcut hata uretim noktalarini listele.
2. Degistirecegin ve olusturacagin dosyalari listele.
3. Dokumanlar ile mevcut kod arasindaki celiskileri belirt.
4. Guncelleyecegin ve ekleyecegin testleri listele.
5. Scope disi hicbir ise baslamadigini dogrula.

Bu raporda kaynak dokumanda acik birakilmis kararlari kendi basina cozme. Belirsizlik varsa dar kapsamli ilerlemek icin raporla.

## Implementasyon Kuralları

- Yalnizca Error Contract fazini uygula.
- Request validation helper'larini yazma.
- Authorization implementasyonu yapma.
- Domain module olusturma.
- Users veya academic organization koduna baslama.
- Genel soft-delete abstraction olusturma.
- CORS config degistirme.
- Ilgisiz refactor yapma.
- Yeni dependency ekleme.
- Service katmanina Express `Response` bagimliligi ekleme.
- Tum hata cevaplarini nested contract'a gecir.
- Bilinmeyen hatalari `INTERNAL_ERROR` olarak esle.
- 500 public message olarak `Internal server error` kullan.
- Stack, cause ve internal DB detaylarini response body'ye yazma.
- Not-found, CSRF, rate-limit ve payload-too-large davranislarini ayni contract'a gecir.
- Mevcut basarili response contract'larini degistirme.
- Mevcut error logging davranisini bozma.
- Kaynaklarda olmayan davranisi uydurma.
- Belirsizlik varsa tahmin ederek genis kapsamli degisiklik yapma.

## Doğrulama

Implementasyon sonunda mevcut projede tanimli gercek komutlari kullan:

```bash
npm run typecheck
npm test
npm run check
```

`package.json` icinde `npm run check`, `biome check --write .` calistirir. Sonuc raporunda bu komutun write davranisini acikca belirt.

## Sonuç Raporu

Implementasyon sonunda su bilgileri raporla:

- Degistirilen dosyalar
- Eklenen dosyalar
- Uygulanan acceptance criteria
- Her acceptance criterion'a karsilik gelen test
- Calistirilan komutlar ve sonuclari
- Plan disina cikilan degisiklik varsa aciklamasi
- Kalan belirsizlikler

## Scope Kontrol Listesi

- Error Contract disinda production davranisi degistirilmedi.
- Flat error response shape'i hata kaynaklarindan kaldirildi.
- Nested `{ error: { code, message, details } }` contract'i tum hata kaynaklarinda kullanildi.
- 500 response body icinde stack, cause, SQL veya internal DB detayi yok.
- Not-found, CSRF, rate-limit ve payload-too-large merkezi contract'a baglandi.
- Typecheck, test ve lint/check sonuclari raporlandi.
