# Term & Process V2 Plani

## Summary

V2'de `terms` tablosu yalnizca takvim yilini temsil edecek temel domain kaydi olacak.

Performans ve tesvik ayni takvim yilina baglanabilir; ancak surec olarak birbirinden bagimsiz ilerler. Ornek olarak sistemde ayni anda 2026 performans hedef giris sureci devam ederken, 2024 tesvik hesaplama/onay sureci tamamlanmis veya 2025 tesvik sureci beklemede olabilir.

Bu nedenle performans/tesvik ayrimi `terms` uzerine dogrudan status kolonlari eklenerek degil, `term_processes` tablosu ile modellenmelidir.

## Core Decisions

- `terms` bir takvim yilidir.
- Simdilik her term 1 Ocak - 31 Aralik araligini temsil eder.
- `terms` performans veya tesvik status'u tasimaz.
- Performans ve tesvik icin ayri `term_processes` kayitlari olusturulur.
- `IncentiveTerms` V2'de ayri tablo olarak olusturulmayacak; yerine `term_processes.process_type = 'INCENTIVE'` kullanilacak.
- Performans tarafinda kullanicidan actual/gerceklesen veri girisi alinmaz. Actual degerler veri tabanindaki faaliyetlerden periyodik hesaplanir.
- Tesvik tarafinda basvuru penceresi yoktur. Kisilerin veri tabanindaki aktivitelerine gore otomatik hesaplama yapilir.
- Buyuk tablolarda `year` kolonu korunacak. Bunun ana nedeni ileride yila gore partition ihtimalidir.
- `year` kolonu performans/tesvik hesap tablolarinda tutulsa bile canonical donem baglami `term_process_id` olmalidir.

## Naming Note: Academic Units

Mevcut V2 planinda `academic_units` tablosu fakulte, enstitu, yuksekokul ve meslek yuksekokulu gibi ust akademik yapilari temsil ediyor. Fakat bolum ve anabilim dali da genel anlamda akademik birim oldugu icin bu isim domain dilinde karisiklik uretebilir.

Iki secenek var:

1. Mevcut isim korunur:
   - `academic_units` sadece ust akademik birimler icin kullanilir.
   - Dokuman ve API metinlerinde bu tablo "ust akademik birim" olarak anlatilir.
   - Scope enum'larinda `ACADEMIC_UNIT` yerine daha acik bir deger tercih edilir.

2. Erken asamada isim degistirilir:
   - `academic_units` -> `academic_top_units`
   - Scope enum'unda `ACADEMIC_TOP_UNIT` kullanilir.
   - `departments` ve `disciplines` ayri tablolar olarak kalir.

Bu plan domain acikligi icin ikinci secenegi onerir. Ancak mevcut migrationlar uygulanmaya baslandiysa ve isim degisikligi maliyetli gorulurse birinci secenekle devam edilebilir. Bu durumda dokumanlarda `academic_units` icin "ust akademik birim" ifadesi tutarli kullanilmalidir.

## Schema

### `terms`

```text
id uuid primary key
year int not null unique
starts_on date not null
ends_on date not null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz null
```

Constraintler:

```text
unique (id, year)
check (starts_on <= ends_on)
check (starts_on = make_date(year, 1, 1))
check (ends_on = make_date(year, 12, 31))
```

Notlar:

- `starts_on` ve `ends_on` su an takvim yili icin sabit gibi gorunse de tabloyu okunabilir ve gelecege hazir yapar.
- `year` sadece burada unique olmalidir.
- `performance_status` veya `incentive_status` gibi kolonlar burada tutulmayacak.

### `term_processes`

```text
id uuid primary key
term_id uuid not null
year int not null
process_type term_process_type not null
status term_process_status not null default 'DRAFT'
started_at timestamptz null
completed_at timestamptz null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz null
```

Enumlar:

```text
term_process_type: PERFORMANCE, INCENTIVE
term_process_status: DRAFT, ACTIVE, CLOSED, COMPLETED, CANCELLED
```

FK ve constraintler:

```text
foreign key (term_id, year) references terms(id, year) on update cascade on delete restrict
unique (id, year)
unique active process per term and type:
  unique (term_id, process_type)
  where deleted_at is null
check (completed_at is null or started_at is null or completed_at >= started_at)
```

Notlar:

- Bu tablo `IncentiveTerms` tablosunun V2 karsiligidir.
- Bir term icin bir performans process'i, bir tesvik process'i olabilir.
- Surecler bagimsiz status tasir.
- Ornek aktif durumlar:

```text
2026 / PERFORMANCE / ACTIVE
2025 / INCENTIVE   / DRAFT
2024 / INCENTIVE   / COMPLETED
```

### `performance_target_entry_windows`

Performans surecinde asil zaman penceresi hedef girisidir. Siralama genel olarak:

1. Universite hedefleri
2. Ust akademik birimler
3. Bolumler ve anabilim dallari
4. Akademisyenler

Takvim sikisik oldugunda bu pencereler ayni anda acilabilir. Bu nedenle siralama bilgisi ve tarih araliklari birbirinden bagimsiz tutulur.

```text
id uuid primary key
term_process_id uuid not null
year int not null
scope_type performance_target_scope_type not null
opens_at timestamptz not null
closes_at timestamptz not null
status target_entry_window_status not null default 'DRAFT'
sort_order int not null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz null
```

Enumlar:

```text
performance_target_scope_type:
  UNIVERSITY
  ACADEMIC_UNIT
  DEPARTMENT
  DISCIPLINE
  USER

target_entry_window_status:
  DRAFT
  PUBLISHED
  CLOSED
  CANCELLED
```

FK ve constraintler:

```text
foreign key (term_process_id, year) references term_processes(id, year) on update cascade on delete restrict
unique active target entry window:
  unique (term_process_id, scope_type)
  where deleted_at is null
check (closes_at >= opens_at)
```

Notlar:

- Bu tablo "kim ne zaman hedef girebilir?" sorusunu cevaplar.
- "Kim hedef girdi/girecek?" bilgisi bu tabloda tutulmaz.
- Hedef atama ve giris kayitlari ileride `target_assignments` ve `target_values` tarafinda tutulacak.
- `ACTUAL_ENTRY` gibi bir pencere olmayacak. Actual degerler hesaplama ciktisidir.
- Performans odulu bu tablonun sorumlulugu degildir.

### `incentive_process_details`

Tesvik tarafinda `IncentiveTerms.summary` veya `pricingStatus` gibi surece ozel alanlara ihtiyac varsa, generic `term_processes` tablosunu sisirmemek icin ayri detay tablosu kullanilabilir.

```text
id uuid primary key
term_process_id uuid not null unique
year int not null
pricing_status incentive_pricing_status not null default 'DRAFT'
summary jsonb not null default '[]'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz null
```

Enum:

```text
incentive_pricing_status: DRAFT, CALCULATED, FINALIZED
```

FK:

```text
foreign key (term_process_id, year) references term_processes(id, year) on update cascade on delete restrict
```

Notlar:

- Bu tablo opsiyoneldir; ilk migrationda gerek yoksa ertelenebilir.
- `term_processes.process_type = 'INCENTIVE'` olan kayitlara baglanmalidir. Bu kural uygulama servisinde de dogrulanmalidir.
- `summary` gibi hesaplanmis ozetler burada kalir.

## Year & Partition Strategy

V2'de buyuk ve sorgu yogun tablolarda `year` tutulmaya devam edilecek:

```text
target_definitions.year
target_assignments.year
target_values.year
target_calculation_runs.year
target_actuals.year
target_scores.year
incentive_rules.year
incentive_limits.year
incentive_collaboration_rates.year
user_incentives.year
user_incentive_approvals.year
```

Ancak `year` tek basina domain baglami olarak kullanilmamali. Ilgili process FK ile baglanmali:

```text
term_process_id uuid not null
year int not null
foreign key (term_process_id, year) references term_processes(id, year)
```

Bu desen iki amaca hizmet eder:

- Yila gore partition ihtimalini korur.
- Yanlis yil/process eslesmesini DB seviyesinde engeller.

Ornek hatali durum DB tarafindan engellenmelidir:

```text
user_incentives.year = 2026
user_incentives.term_process_id = 2024 INCENTIVE process id
```

## Performance Flow

Performans sureci hedef toplama ve donem sonu raporlama baglamidir.

1. Ilgili yil icin `terms` kaydi olusturulur.
2. Ayni yil icin `term_processes(process_type = PERFORMANCE)` kaydi olusturulur.
3. Hedef giris pencereleri `performance_target_entry_windows` ile tanimlanir.
4. Universite, ust akademik birim, bolum/anabilim dali ve akademisyen hedefleri ilgili assignment/value tablolarina yazilir.
5. Faaliyet verileri yil icinde kendi tablolarina girilir.
6. Gerceklesen degerler periyodik hesaplama run'lari ile uretilir.
7. Donem sonunda raporlama bu process ve hesaplama run'lari uzerinden yapilir.

Performans hedef giris sirasi domain kuralidir; ancak tarihsel olarak mutlak zorunluluk degildir. Birden fazla scope penceresi ayni anda acilabilir.

## Incentive Flow

Tesvik surecinde kullanici basvurusu yoktur.

1. Ilgili faaliyetler yil boyunca veri tabaninda tutulur.
2. Ilgili yil icin `term_processes(process_type = INCENTIVE)` kaydi olusturulur.
3. Tesvik kurallari, limitleri ve collaboration rate kayitlari bu process'e baglanir.
4. Sistem faaliyetlerden otomatik hesaplama yapar.
5. `user_incentives` ve `user_incentive_approvals` bu process'e baglanir.
6. Gerekirse `incentive_process_details` uzerinde ozet ve pricing/finalization durumu tutulur.

Tesvik sureci performans sureciyle ayni yil akmak zorunda degildir.

## Tables That Should Reference `term_processes`

Performans tarafinda:

```text
target_definitions.term_process_id
target_assignments.term_process_id
target_values.term_process_id
target_calculation_runs.term_process_id
target_actuals.term_process_id
target_scores.term_process_id
```

Tesvik tarafinda:

```text
incentive_rules.term_process_id
incentive_limits.term_process_id
incentive_collaboration_rates.term_process_id
user_incentives.term_process_id
user_incentive_approvals.term_process_id
```

Bu tablolarda `year` da tutulacak ve composite FK deseni uygulanacak.

## Migration Order Impact

Onerilen term/process blok sirasi:

```text
09 create_terms_table
10 create_term_processes_table
11 create_performance_target_entry_windows_table
```

V1'den tasinmayacaklar:

```text
create_term_period -> replace with term_processes + performance_target_entry_windows
create_term_period_exception -> skip for now
create_incentive_term -> replace with term_processes(process_type = INCENTIVE)
```

## Deferred Decisions

- `incentive_process_details` ilk migration setine dahil edilecek mi, yoksa tesvik tablolarina gecilirken mi eklenecek?
- Process status gecisleri icin servis seviyesinde state machine helper yazilacak mi?
- Aylik performans hesaplama run'lari icin scheduler/outbox ilk versiyonda olacak mi, yoksa manuel tetikleme ile mi baslanacak?

## Best Practices

- `terms` tablosunu surec state'i ile sisirme.
- Performans ve tesvik status'larini `term_processes` uzerinde tut.
- Buyuk tablolarda `year` tut ama dogrulugu composite FK ile garanti et.
- Actual degerleri kullanici girdisi gibi modelleme; hesaplama ciktisi olarak sakla.
- Tesvikte basvuru penceresi olusturma; domain'de basvuru yoksa schema'da da olmasin.
- Generic process tablosuna tesvike ozel kolon ekleme; gerekirse detail tablosu kullan.
- Hedef giris penceresi ile hedef assignment/value kayitlarini ayri sorumluluklar olarak tut.
