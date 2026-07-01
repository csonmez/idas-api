# Articles / Publications V2 Plan

## Summary

Bu doküman, v1 `ardek-api` içindeki article/journal/user-article yapısı incelendikten sonra `idas-api` v2 için belirlenen makale/yayın domain tasarımını tanımlar.

V1'de makaleler sadece Web of Science kaynağı ile sisteme alınmış, Prisma oncesinde Sequelize geçmişi olan mevcut PostgreSQL şeması üzerinden devam edilmiştir. V2'de Kysely kullanılacak, Web of Science ve Scopus kaynakları birlikte desteklenecek, sistem raporlama ağırlıklı çalışacaktır.

Ana hedefler:

- WoS ve Scopus makalelerini duplicate üretmeden aynı article kaydında birleştirebilmek.
- WoS'tan gelen eksik/tam olmayan tarih metinlerini kaybetmeden yıl/ay bazında raporlayabilmek.
- Aynı derginin WoS ve Scopus'tan farklı metrik ve kısaltmalarını kaynak bazında saklayabilmek.
- Journal metric geçici kopyalama (provisional) modelini desteklemek.
- Kurum içi ve kurum dışı yazar bilgilerini ayrı ama ilişkili şekilde saklamak.
- Mega-collaboration makalelerindeki (5000+ yazar) yüksek satır sayısını verimli yönetmek.
- Makaleleri kullanıcının akademik affiliation kaydı ile raporlayabilmek.
- Anahtar kelimeleri normalize ederek raporlanabilir hale getirmek.
- Kysely ile CRUD ve raporlama sorgularını ayrı repository/service katmanlarında tutmak.
- Gelecekte WoS ve Scopus dışında yeni kaynaklar eklenebilmesi için sistemi hazır tutmak.

## V1 Snapshot

V1'de article domain şu ana tablolardan oluşur:

```text
Articles
JournalMetrics
Journals
UserArticles
ArticleCitationCounts
```

V1 `Articles` tablosunda dikkat çeken alanlar:

```text
wosId
publicationDate      varchar/string
year                  integer
journalId
journalMetricId
citationCount
isOpenAccess
isTopTenPercent
earlyAccessDate      varchar/string
isEarlyAccess
hasInternationalCollaboration
hasIndustryCollaboration
hasNationalCollaboration
```

V1 `UserArticles` tablosu sadece kurum içi kullanıcı ile article arasında link table gibi çalışır:

```text
userId
articleId
createdAt
updatedAt
deletedAt
```

V1'den alınacak iyi kararlar:

- Article, journal, journal metric, user article ve citation counts ayrımı genel olarak doğru.
- `wosId` tekilliği veri tekrarını engellemek için faydalı.
- `ArticleCitationCounts(articleId, year)` modeli yıllık atıf trendi için doğru.
- `journalMetricId` ile article'ın ilgili yılın metric kaydına bağlanması pratik.

V1'den aynen taşınmaması gerekenler:

- Sadece `wosId` üzerinden dış kaynak takibi v2 için yetersizdir; Scopus da desteklenecek.
- `UserArticles` sadece link table olarak kalırsa kurum dışı yazar ve affiliation raporları zayıf kalır.
- Duplicate kontrol sadece service katmanında kalmamalı; partial unique index ile DB seviyesinde garanti verilmelidir.
- CamelCase tablo/kolon isimleri v2'ye taşınmamalıdır; snake_case kullanılmalıdır.
- `publicationDate` string olarak tutuluyor ama parse edilmiş yıl/ay ayrı alanlar yok.
- Journal metric provisional kopyalama mantığı var ama açık alanlarla izlenmiyor.
- V1'de `isManager` middleware comment-out edilmiş — yetki kontrolü devre dışı.
- V1'de `updateArticle` içinde hardcoded `year === 2024` kontrolü var.
- Anahtar kelimeler hiç tutulmuyor.
- Kurum dışı yazarlar hiç tutulmuyor.
- Bibliyografik bilgiler (volume, issue, sayfa) tutulmuyor.

## Core Domain Decisions

### 1. Source systems

V2 makale kaynakları:

```text
WOS
SCOPUS
MANUAL
```

İlk hedef WoS + Scopus'tur. MANUAL kayıt opsiyonu admin düzeltmeleri ve WoS/Scopus'ta olmayan makale girişleri için tutulur.

Gelecekte yeni bir veri tabanı (örn. PubMed, IEEE) eklenebilir. Tüm `source` alanları `varchar(32)` + check constraint olarak tasarlanmıştır. Yeni kaynak eklemek tek `ALTER TABLE` ile yapılabilir — şema yapısı değişmez.

MANUAL source'un kullanım senaryoları:

- WoS veya Scopus'ta olmayan bir makale (kitap bölümü, indekste olmayan dergi).
- Akademisyen makalesinin eksik olduğunu iddia edip ticket açar, admin manuel ekler.
- Import sırasında eksik kalan bir yazar bilgisini admin tamamlar.

Tek bir article kaydı birden fazla external id'ye sahip olabilir:

```text
WOS: WOS:000123456789
SCOPUS: 85123456789
DOI: 10.xxxx/yyyy
```

DOI article'ın kendi alanında tutulur, kaynak bazlı ID'ler `article_external_ids` tablosunda tutulur. Bu ayrım aşağıda açıklanmıştır.

### 2. Publication date handling

WoS `publicationDate` ve `earlyAccessDate` alanlarını tam tarih olarak vermeyebilir. Örnekler:

```text
2025
JAN 2025
JAN-FEB 2025
MAY 2025
```

Sistem için asıl önemli alan yıldır. Ay bilgisi gelirse saklanmalıdır. Bu nedenle raw string ve parse edilmiş yıl/ay birlikte tutulur.

Önerilen article alanları:

```text
publication_date_raw text null
publication_year integer not null
publication_month smallint null

early_access_date_raw text null
early_access_year integer null
early_access_month smallint null
is_early_access boolean not null default false
```

Kurallar:

- Raw değer kaybedilmemelidir.
- Raporlar `publication_year` üzerinden çalışmalıdır.
- Ay parse edilebiliyorsa `publication_month` veya `early_access_month` doldurulmalıdır.
- Ay parse edilemiyorsa null kalmalıdır.
- `publication_month` ve `early_access_month` için `1..12` check constraint eklenmelidir.

### 3. Journal source data — kaynak bazlı dergi bilgileri

Aynı dergi WoS ve Scopus'ta farklı isim, kısaltma veya dergi ID'si ile gelebilir. `journals` tablosunda canonical (kurum için tercih edilen) isim ve kısaltma tutulurken, kaynak bazlı farklılıklar ayrı bir tabloda saklanır.

Bu yapı gelecekte yeni bir kaynak eklendiğinde sadece yeni `source` değeri ile kayıt eklenmesini sağlar — şema değişikliği gerekmez.

### 4. Journal metrics lifecycle ve kaynak bazlı metrikler

Journal metricleri her yıl temmuz ayında açıklanır ve bir yıl geriden gelir.

Örnek:

```text
2026 Temmuz -> 2025 journal metricleri açıklanır.
```

Ayrıca aynı derginin WoS (JCR) ve Scopus (SJR) metrikleri aynı yıl için farklı olabilir. Bu nedenle `journal_metrics` tablosunda `(journal_id, metric_year, source)` üçlüsü unique olmalıdır.

V1'de uygulanan model:

- 2025 makaleleri metriksiz kalmaz.
- 2025 metric kaydı, geçici olarak 2024 metric değerleriyle oluşturulur.
- 2025 gerçek metricleri açıklanınca aynı `journal_metrics.year = 2025` kaydı güncellenir.
- Article zaten `journal_metric_id` ile bu kayda bağlı olduğu için raporlar otomatik güncel metric değerlerini kullanır.

V2'de bu model korunmalı, fakat daha açık alanlarla izlenmelidir.

Önerilen alanlar:

```text
metric_year integer not null
source varchar(64) not null default 'WOS'
announced_year integer null
announced_month smallint null
status varchar(32) not null default 'PROVISIONAL'
source_metric_year integer null
```

Status değerleri:

```text
PROVISIONAL
FINAL
```

Anlamları:

- `PROVISIONAL`: Bu metric kaydı henüz ilgili yılın gerçek JCR/metric verisi değildir; önceki yılın değerlerinden kopyalanmıştır.
- `FINAL`: İlgili yılın gerçek metric verisi açıklanmış ve kayıt nihai hale gelmiştir.

Örnek:

```text
journal_metrics.metric_year = 2025
source = WOS
status = PROVISIONAL
source_metric_year = 2024
q_value = 2024 değeri
impact_factor = 2024 değeri

2026 Temmuz sonrası:
metric_year = 2025
source = WOS
status = FINAL
source_metric_year = 2025
q_value = 2025 gerçek değeri
impact_factor = 2025 gerçek değeri
```

Aynı dergi için Scopus metric'i ayrı bir kayıt olarak tutulur:

```text
journal_metrics.metric_year = 2025
source = SCOPUS
status = FINAL
q_value = Scopus SJR Q değeri
```

### 5. Article to journal metric relation

Article, yayın yılına ait journal metric kaydına bağlanmalıdır:

```text
articles.publication_year = journal_metrics.metric_year
articles.journal_id = journal_metrics.journal_id
articles.journal_metric_id = journal_metrics.id
```

Article alanları:

```text
journal_id uuid not null
journal_metric_id uuid null
```

`journal_metric_id` teknik olarak nullable olabilir, ancak normal workflow'da her article için provisional veya final metric kaydı bulunması hedeflenmelidir.

Hangi kaynağın metric'i kullanılacağı: Article `primary_source` alanından belirlenir. WoS makalesi WoS metric'ine, Scopus makalesi Scopus metric'ine bağlanır. Eğer makale her iki kaynakta da varsa (merge edilmiş), `primary_source` hangisi ise onun metric'i tercih edilir.

Create/import workflow:

1. Article'ın `journal_id` ve `publication_year` değeri belirlenir.
2. `journal_metrics(journal_id, metric_year = publication_year, source = primary_source)` aranır.
3. Varsa article bu metric'e bağlanır.
4. Yoksa önceki yıl metric kaydı bulunur.
5. Onceki yıl metric kaydı varsa yeni yıl için `PROVISIONAL` metric kaydı kopyalanır.
6. Article yeni provisional metric kaydına bağlanır.
7. Gerçek metric açıklanınca aynı `journal_metrics` kaydı `FINAL` olarak güncellenir.

Bu model sayesinde makaleler hiç metriksiz kalmaz ve article kayıtlarını tek tek yeniden bağlamak gerekmez.

### 6. Internal and external authors

V1'de sadece kurum içi yazarlar `UserArticles` ile tutulur. V2'de kurum dışı yazarlar da saklanabilmelidir, ancak kurum dışı yazarlar `users` tablosuna eklenmemelidir.

Bu nedenle iki tablo ayrımı önerilir:

```text
article_authors -> makaledeki tüm yazarlar, kurum içi/dışı
user_articles   -> sistemdeki user ile article arasındaki raporlama ilişkisi
```

#### article_authors vs user_articles — sorumluluk ayrımı

Bu iki tablonun sorumlulukları farklıdır:

**`article_authors`** = WoS/Scopus'tan gelen ham yazar listesi. Makaledeki tüm yazarlar buraya yazılır — kurum içi akademisyenler dahil. Import sırasında kurum içi yazarlar isim/e-posta eşleştirmesi ile `users` tablosuna bağlanır (`user_id` doldurulur). Kurum dışı yazarlarda `user_id = null` kalır.

**`user_articles`** = Raporlama ve teşvik hesaplama ilişkisi. "Bu makale, bu kullanıcı için, bu affiliation altında raporlanacak" bilgisini tutar. Her kurum içi yazar için bir `user_articles` kaydı oluşur — ama affiliation, doğrulama durumu, kaynak bilgisi burada tutulur.

Neden ikisi de lazım:

| Durum | article_authors | user_articles |
|-------|-----------------|---------------|
| WoS'tan import edilen kurum içi yazar | var, `user_id` dolu | var, affiliation ile |
| WoS'tan import edilen kurum dışı yazar | var, `user_id = null` | yok, gerek yok |
| Admin manuel atama (kayıt WoS'ta yok) | olabilir veya olmayabilir | var, admin oluşturur |
| Akademisyen birden fazla affiliation | tek kayıt (`user_id` dolu) | her affiliation için ayrı kayıt (ileride) |

Akademisyenler her iki tabloda da olacak, ama farklı amaçlarla. `article_authors` "bu makalenin yazarı budur" derken, `user_articles` "bu makale bu kullanıcı için şu birim altında raporlanır" der.

Eğer bunu tek tabloda birleştirmeye çalışılırsa: kurum dışı yazarlar için `user_id = null` kayıtların yanına affiliation alanları da koymak gerekir (ki onlar için anlamı yok), ve bir akademisyenin birden fazla affiliation'ı varsa aynı article-author kaydını çoğaltmak gerekir. İki tablo ayrı kalınca her biri kendi sorumluluğunu temiz tutar.

Şu an için first author, corresponding author ve author order kaynak veri sağlıyorsa saklanır; `author_order` zorunludur.

### 7. Academic affiliations

Bazı akademisyenlerin birden fazla academic unit, department ve discipline kaydı olabilir. Makaleler bu affiliation kayıtlarına göre raporlanabilmelidir.

Bu nedenle `user_academic_affiliations` tablosunda tarih aralığı olmalıdır:

```text
start_date date null
end_date date null
affiliation_type varchar not null default 'MAIN'
is_primary boolean not null default false
```

`user_articles` kaydı ilgili affiliation'a bağlanabilmelidir:

```text
user_academic_affiliation_id uuid null
```

Bu alan sayesinde bir makalenin hangi akademik birim/bölüm/discipline altında raporlanacağı netleşir.

Varsayılan raporlama yaklaşımı:

- Eğer `user_articles.user_academic_affiliation_id` doluysa raporda bu affiliation kullanılır.
- Boş ise article yayın yılı ile kullanıcının aktif affiliation tarih aralığı eşleştirilir.
- Birden fazla uygun affiliation varsa `is_primary = true` olan tercih edilir.
- Hala belirsizse kayıt rapor öncesi manuel review gerektirir.

### 8. Keywords

WoS ve Scopus anahtar kelimeleri saklanmalıdır. Keywordler normalize edilerek tekrarlar azaltılmalıdır.

Önerilen ayrım:

```text
keywords
article_keywords
```

`keywords.normalized_name` unique olmalıdır. `article_keywords` source bilgisini saklamalıdır.

Normalize kuralı ilk fazda basit tutulabilir:

```text
trim
lowercase
multiple whitespace -> single whitespace
```

### 9. Pagination

Front-end klasik sayfalamalı tablo kullandığı için admin/list endpointlerinde cursor pagination zorunlu değildir.

Liste endpointleri için `page/limit` kullanılabilir:

```json
{
  "rows": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

Karar:

- Admin tablolarında `page/limit` kullanılır.
- Büyük export, background sync veya internal batch işlerinde gerekirse cursor/keyset kullanılabilir.
- Offset pagination kullanılırken sıralama stabil olmalıdır: `order by created_at desc, id desc`.

### 10. DOI storage — tek yer

DOI evrensel bir kimliktir — kaynağa bağlı değildir. Bu nedenle DOI sadece `articles.doi` alanında tutulur. `article_external_ids` tablosu sadece kaynak bazlı ID'leri tutar (WOS:000123, SCOPUS:85123). DOI bu tabloda yer almaz.

Bu ayrım gereksiz duplication'ı önler ve duplicate detection mantığını netleştirir:

- DOI eşleşmesi → `articles.doi` üzerinde unique index ile.
- Kaynak ID eşleşmesi → `article_external_ids(source, external_id)` üzerinde unique index ile.

### 11. Mega-collaboration senaryosu — yüksek yazar sayısı

Kurumda yaklaşık 100 makalede 5000 veya daha fazla yazar olabilmektedir (büyük fizik/medical işbirlikleri). Bu senaryo için veri saklama stratejisi aşağıda tanımlanmıştır.

#### Ölçek hesabı

| Senaryo | Makale | Yazar/makale | Toplam satır |
|---------|--------|-------------|-------------|
| Mega-collaboration | ~100 | 5.000+ | ~500.000 |
| Normal makaleler | ~10.000 | 5-20 | ~100.000 |
| Toplam | | | ~600.000 |

PostgreSQL için 600K satır trivial düzeydedir. Tüm yazarlar ilişkisel tabloda saklanır — JSONB hibrit veya partitioning gerekmez.

#### İndeksleme stratejisi

Sıcak yol (kurum içi yazar arama, raporlama) ile soğuk yol (dış yazar bireysel sorgulama) ayrı tutulur:

```sql
-- SICAK YOL: Kurum içi yazar arama (raporlama, user-article atama)
-- Bu indeks sadece user_id dolu satırları içerir — mega-collab'lerin
-- 5000 dış yazarı BU indekste yer almaz
create index article_authors_user_idx
on article_authors(user_id)
where user_id is not null and deleted_at is null;

-- SICAK YOL: Makale bazlı yazar listesi (pagination ile)
create index article_authors_article_idx
on article_authors(article_id, author_order)
where deleted_at is null;

-- SOĞUK YOL: Kurum adına göre dış yazar arama (nadiren, gereksinim çıkarsa)
create index article_authors_institution_idx
on article_authors(normalized_name)
where is_internal = false and deleted_at is null;
```

Kritik nokta: `user_id` indeksi partial — yani sadece `user_id IS NOT NULL` satırlarını içerir. 500K dış yazar (user_id = null) bu indekste hiç yer kaplamaz. Kurum içi yazar arama her zaman hızlı kalır.

#### Önbellek alanları articles üzerinde

COUNT(*) sorgularından kaçınmak için:

```sql
alter table articles
  add column author_count integer not null default 0,
  add column internal_author_count integer not null default 0;
```

Import sırasında bu alanlar doldurulur. Raporlama (örn. "işbirliği büyüklüğü", "yazar sayısı dağılımı") bu cache'lerden okur — `article_authors` üzerinde aggregate yapmaz.

#### Sorgu pattern'leri

Makale detayı — yazar listesi:

```sql
-- İlk 50 yazarı getir + toplam sayı articles.author_count'ten oku
select * from article_authors
where article_id = $1 and deleted_at is null
order by author_order
limit 50 offset $2;
```

5000 yazarlı bir makalede ilk 50'yi getirmek, `article_authors_article_idx` üzerinden < 1ms sürer. Frontend "Tüm yazarları göster" derse pagination ile devam eder.

Kurum içi yazarları getir (raporlama):

```sql
select * from article_authors
where article_id = $1 and user_id is not null and deleted_at is null
order by author_order;
```

Partial index sayesinde, 5000 yazarlı makalede bile bu sorgu sadece kurum içi yazarları (genelde 1-5 tane) tarar.

İşbirliği istatistiği:

```sql
-- author_count cache'inden oku, article_authors'a dokunma
select
  count(*) filter (where author_count > 100) as mega_collab_count,
  avg(author_count) as avg_authors,
  sum(author_count) as total_author_slots
from articles
where deleted_at is null and publication_year = $1;
```

#### Import stratejisi

5000 yazarlı bir makale import edilirken:

```typescript
// Kysely ile batch insert — 5000 satırı tek sorguda
await trx.insertInto('article_authors')
  .values(authorRows)  // 5000 satırlık array
  .execute()

// Alternatif: pg driver'ın copyFrom'u ile (en hızlı)
// Çok büyük batch'lerde (10K+) COPY daha verimli
```

Kysely'nin çoklu `values()` metodu 5000 satırı tek INSERT ile yazar. PostgreSQL bunu < 200ms'de işler. Transaction içinde olduğu için ya hep ya hiç.

#### raw_data optimizasyonu

Dış yazarlar için `raw_data = null` bırakılabilir. Sadece kurum içi yazarlarda ve first/corresponding author'da raw_data tutulur. 5000 yazarlı makalede bu, yaklaşık 4990 satırın raw_data'sını boş bırakır — storage tasarrufu.

#### Partitioning değerlendirmesi — bu ölçekte gerekmez

PostgreSQL partitioning'in bu senaryoda kullanılmaması için teknik nedenler:

| Sorun | Açıklama |
|-------|----------|
| FK kısıtı | `user_articles.article_author_id -> article_authors.id` FK'su partitioned tabloya çalışmaz (PG kısıtlaması) |
| PK değişikliği | Partition key PK'nın parçası olmalı — `(id, is_internal)` gibi kompozit PK gerekir, bu da FK referanslarını karmaşıklaştırır |
| Gains minimal | 600K satırda partitioning'in getirisinden çok complexity maliyeti yüksektir |

Partitioning ancak tablo 10M+ satıra ulaşırsa düşünülmeli. O noktada `article_id` hash partition mantıklı olur.

#### JSONB hibrit — ne zaman düşünülmeli

Eğer tablo 5M+ satıra ulaşırsa veya dış yazar başına çok büyük `raw_data` tutulması gerekirse, alternatif depolama stratejisi:

```sql
-- articles tablosuna:
external_authors_json jsonb null  -- Mega-collab dış yazarları JSON array olarak

-- article_authors tablosunda:
-- Sadece kurum içi + first + corresponding yazarlar kalır
```

Bu yaklaşımda:
- `article_authors` küçük kalır (50K satır civarı).
- Dış yazarlar `articles.external_authors_json` JSONB alanında.
- GIN index ile JSONB içinde arama mümkün.
- Ama FK, JOIN ve match işlemi karmaşıklaşır.

Şu anki 600K ölçek için bu gerekmez. `author_count` cache'i mimariyi bunu ileride gerektiğinde kolayca geçişe izin verecek şekilde hazırlar.

## Authorization ve Rol Modeli

### Roller

Projede şu roller bulunmaktadır:

```text
ACADEMICIAN
DEAN
DEPARTMENT_HEAD
DISCIPLINE_HEAD
ADMIN
```

Admin dışındaki rollerin articles modülünde yalnızca okuma yetkisi vardır (ekleme/güncelleme/silme yok).

### Karar: academician + manager şeklinde ayır

3 yönetici grubu (dean, department head, discipline head) için ayrı service/route oluşturulmaz. Bunun yerine `academician` ve `manager` şeklinde ayrılır.

Gerekçe:

1. V2 authorization sistemi zaten `requireScopedPermission` middleware'i ile scope farkını otomatik çözer. Dean'in `scopeType = ACADEMIC_UNIT`, department head'in `scopeType = DEPARTMENT`, discipline head'in `scopeType = DISCIPLINE` olması yeterli — kodda 3 ayrı servis yazmaya gerek yok.
2. Veri aynı, sadece görünürlük kapsamı farklı. Articles list endpoint'i tek bir servis olacak; middleware, kullanıcının scope path'ini çözüp service'e `academicUnitId`/`departmentId`/`disciplineId` filter olarak geçirecek.
3. `academician` ayrı çünkü academician kendi makalelerini görür, manager ise birimindeki tüm akademisyenlerin makalelerini görür.
4. Admin için ayrı yazma endpoint'leri gerekir.

### Yeni permission'lar

`authorization.types.ts`'ye eklenecek:

```typescript
PERMISSIONS = {
  // ... existing
  ARTICLE_READ: 'article:read',     // Tüm authenticated kullanıcılar
  ARTICLE_WRITE: 'article:write',   // Sadece admin
  ARTICLE_REPORT: 'article:report', // Manager + admin (scoped)
}
```

### Rol-permission eşlemesi

| Rol | scopeType | Permissions |
|-----|-----------|-------------|
| ACADEMICIAN | ACADEMIC_UNIT | `ARTICLE_READ` (kendi makaleleri) |
| DEAN | ACADEMIC_UNIT | `ARTICLE_READ`, `ARTICLE_REPORT` (fakülte geneli) |
| DEPARTMENT_HEAD | DEPARTMENT | `ARTICLE_READ`, `ARTICLE_REPORT` (bölüm geneli) |
| DISCIPLINE_HEAD | DISCIPLINE | `ARTICLE_READ`, `ARTICLE_REPORT` (ABD geneli) |
| ADMIN | GLOBAL | `ARTICLE_READ`, `ARTICLE_WRITE`, `ARTICLE_REPORT` |

Bu yapıda:

- **Academician** `GET /api/me/articles` ile kendi makalelerini görür — `requireAuth()` yeterli, service `userId` ile filterlar.
- **Dean/DepartmentHead/DisciplineHead** `GET /api/articles` veya `GET /api/article-reports/by-*` ile birimlerindeki makaleleri görür — `requireScopedPermission` ile scope filter otomatik çözülür.
- **Admin** `POST/PATCH/DELETE /api/articles` ile CRUD yapar — `requirePermission(ARTICLE_WRITE)` ile GLOBAL kontrol.

## Proposed Tables

### journals

```sql
create table journals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text null,
  abbreviation text null,
  issn varchar(32) null,
  eissn varchar(32) null,
  type varchar(32) not null default 'REGULAR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);
```

Recommended indexes:

```sql
create index journals_name_fts_idx
on journals using gin (to_tsvector('simple', coalesce(name, '')));

create unique index journals_issn_active_unique
on journals(issn)
where issn is not null and deleted_at is null;

create unique index journals_eissn_active_unique
on journals(eissn)
where eissn is not null and deleted_at is null;
```

### journal_source_data

Kaynak bazlı dergi adı, kısaltma ve kaynak içi dergi ID'si. Aynı dergi WoS ve Scopus'ta farklı isim/kısaltma ile gelebilir. Gelecekte yeni kaynak eklendiğinde yeni `source` değeri ile kayıt eklenir.

```sql
create table journal_source_data (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references journals(id) on delete cascade,
  source varchar(32) not null,
  source_name text null,
  source_abbreviation text null,
  source_journal_id varchar(255) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,

  constraint journal_source_data_source_check
    check (source in ('WOS', 'SCOPUS', 'MANUAL'))
);
```

Recommended indexes:

```sql
create unique index journal_source_data_journal_source_active_unique
on journal_source_data(journal_id, source)
where deleted_at is null;

create unique index journal_source_data_source_journal_id_active_unique
on journal_source_data(source, source_journal_id)
where source_journal_id is not null and deleted_at is null;
```

### journal_metrics

```sql
create table journal_metrics (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references journals(id),

  metric_year integer not null,
  source varchar(64) not null default 'WOS',
  announced_year integer null,
  announced_month smallint null,

  status varchar(32) not null default 'PROVISIONAL',
  source_metric_year integer null,

  q_value varchar(2) null,
  impact_factor numeric(10,4) null,
  percentile numeric(6,3) null,
  is_top_ten_percent boolean not null default false,
  is_penalized boolean not null default false,

  raw_data jsonb null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,

  constraint journal_metrics_status_check
    check (status in ('PROVISIONAL', 'FINAL')),

  constraint journal_metrics_announced_month_check
    check (announced_month is null or announced_month between 1 and 12),

  constraint journal_metrics_source_check
    check (source in ('WOS', 'SCOPUS', 'MANUAL', 'JCR', 'SJR'))
);
```

Recommended indexes:

```sql
create unique index journal_metrics_journal_year_source_active_unique
on journal_metrics(journal_id, metric_year, source)
where deleted_at is null;

create index journal_metrics_year_status_idx
on journal_metrics(metric_year, status)
where deleted_at is null;
```

Not: `source` check constraint'inde 'JCR' ve 'SJR' de bulunur çünkü WoS metrikleri JCR, Scopus metrikleri SJR olarak da adlandırılabilir. İlk fazda 'WOS' ve 'SCOPUS' kullanılması yeterlidir.

### articles

```sql
create table articles (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  normalized_title text null,
  doi varchar(255) null,

  publication_date_raw text null,
  publication_year integer not null,
  publication_month smallint null,

  early_access_date_raw text null,
  early_access_year integer null,
  early_access_month smallint null,
  is_early_access boolean not null default false,

  journal_id uuid not null references journals(id),
  journal_metric_id uuid null references journal_metrics(id),

  citation_count integer not null default 0,

  is_open_access boolean not null default false,
  has_international_collaboration boolean not null default false,
  has_industry_collaboration boolean not null default false,
  has_national_collaboration boolean not null default false,

  primary_source varchar(32) not null default 'WOS',

  author_count integer not null default 0,
  internal_author_count integer not null default 0,

  abstract_text text null,
  volume varchar(32) null,
  issue varchar(32) null,
  page_range varchar(64) null,

  raw_data jsonb null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,

  constraint articles_publication_month_check
    check (publication_month is null or publication_month between 1 and 12),

  constraint articles_early_access_month_check
    check (early_access_month is null or early_access_month between 1 and 12),

  constraint articles_primary_source_check
    check (primary_source in ('WOS', 'SCOPUS', 'MANUAL'))
);
```

Recommended indexes:

```sql
create unique index articles_doi_active_unique
on articles(lower(doi))
where doi is not null and deleted_at is null;

create index articles_publication_year_idx
on articles(publication_year)
where deleted_at is null;

create index articles_journal_year_idx
on articles(journal_id, publication_year)
where deleted_at is null;

create index articles_metric_idx
on articles(journal_metric_id)
where deleted_at is null;

create index articles_flags_reporting_idx
on articles(publication_year, is_open_access, has_international_collaboration, has_industry_collaboration, has_national_collaboration)
where deleted_at is null;

create index articles_title_fts_idx
on articles using gin (to_tsvector('simple', coalesce(title, '')));
```

### article_external_ids

Sadece kaynak bazlı ID'ler tutar (WOS:000123, SCOPUS:85123). DOI burada tutulmaz — DOI `articles.doi` alanındadır.

```sql
create table article_external_ids (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  source varchar(32) not null,
  external_id varchar(255) not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null,

  constraint article_external_ids_source_check
    check (source in ('WOS', 'SCOPUS', 'MANUAL'))
);
```

Recommended indexes:

```sql
create unique index article_external_ids_source_external_active_unique
on article_external_ids(source, external_id)
where deleted_at is null;

create index article_external_ids_article_idx
on article_external_ids(article_id)
where deleted_at is null;
```

Duplicate detection order:

```text
1. DOI match (articles.doi)
2. source + external_id match (article_external_ids)
3. normalized_title + publication_year + journal_id possible match
```

The third step should not auto-merge without review unless confidence rules are defined.

### article_authors

Makaledeki tüm yazarlar — kurum içi ve kurum dışı. Kurum içi yazarlar `user_id` ile users tablosuna bağlanır. Kurum dışı yazarlarda `user_id = null` kalır.

```sql
create table article_authors (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,

  full_name text not null,
  normalized_name text null,
  institution_name text null,
  country text null,
  author_email varchar(255) null,
  orcid varchar(32) null,

  is_internal boolean not null default false,
  user_id uuid null references users(id),

  author_order integer not null,
  is_first_author boolean null,
  is_corresponding_author boolean null,

  source varchar(32) not null,
  raw_data jsonb null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,

  constraint article_authors_source_check
    check (source in ('WOS', 'SCOPUS', 'MANUAL'))
);
```

Recommended indexes:

```sql
-- SICAK YOL: Kurum içi yazar arama (raporlama, user-article atama)
-- Partial index: sadece user_id dolu satırları içerir
-- Mega-collab'lerin 5000 dış yazarı BU indekste yer almaz
create index article_authors_user_idx
on article_authors(user_id)
where user_id is not null and deleted_at is null;

-- SICAK YOL: Makale bazlı yazar listesi (pagination ile)
create index article_authors_article_idx
on article_authors(article_id, author_order)
where deleted_at is null;

-- SOĞUK YOL: Kurum adına göre dış yazar arama (nadiren)
create index article_authors_institution_idx
on article_authors(normalized_name)
where is_internal = false and deleted_at is null;
```

Notes:

- Kurum dışı yazarlar `users` tablosuna eklenmez.
- Kurum içi yazar eşleşirse `user_id` doldurulur.
- `author_order` zorunludur — yazar sırası raporlama ve teşvik hesaplaması için kritik.
- `is_first_author`, `is_corresponding_author` kaynak veri sağlıyorsa saklanır.
- `raw_data` kurum içi yazarlarda ve first/corresponding author'da dolu, diğer dış yazarlarda null — storage optimizasyonu.
- Mega-collaboration makalelerinde (5000+ yazar) tüm yazarlar bu tabloda saklanır. Partitioning veya JSONB hibrit bu ölçekte gerekmez. Detaylar yukarıda "Mega-collaboration senaryosu" bölümünde.

### keywords

```sql
create table keywords (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  language varchar(8) null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);
```

Recommended indexes:

```sql
create unique index keywords_normalized_name_active_unique
on keywords(normalized_name)
where deleted_at is null;
```

`language` alanı WoS/Scopus anahtar kelimelerinin dil bilgisini tutar. Kaynak veri sağlamıyorsa null kalır.

### article_keywords

```sql
create table article_keywords (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  keyword_id uuid not null references keywords(id),
  source varchar(32) not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null,

  constraint article_keywords_source_check
    check (source in ('WOS', 'SCOPUS', 'MANUAL'))
);
```

Recommended indexes:

```sql
create unique index article_keywords_article_keyword_source_active_unique
on article_keywords(article_id, keyword_id, source)
where deleted_at is null;

create index article_keywords_keyword_idx
on article_keywords(keyword_id)
where deleted_at is null;
```

### article_citation_counts

```sql
create table article_citation_counts (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  year integer not null,
  count integer not null default 0,
  source varchar(32) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);
```

Recommended indexes:

```sql
create unique index article_citation_counts_article_year_active_unique
on article_citation_counts(article_id, year)
where deleted_at is null;

create index article_citation_counts_year_idx
on article_citation_counts(year)
where deleted_at is null;
```

`articles.citation_count` current/latest total count cache gibi kullanılabilir. Yıllık trend için `article_citation_counts` kullanılır.

### user_articles

```sql
create table user_articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  article_id uuid not null references articles(id),
  article_author_id uuid null references article_authors(id),

  user_academic_affiliation_id uuid null references user_academic_affiliations(id),

  source varchar(32) not null default 'MANUAL',
  verified_at timestamptz null,
  verified_by uuid null references users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,

  constraint user_articles_source_check
    check (source in ('WOS', 'SCOPUS', 'MANUAL'))
);
```

Recommended indexes:

```sql
create unique index user_articles_user_article_active_unique
on user_articles(user_id, article_id)
where deleted_at is null;

create index user_articles_user_idx
on user_articles(user_id)
where deleted_at is null;

create index user_articles_article_idx
on user_articles(article_id)
where deleted_at is null;

create index user_articles_affiliation_idx
on user_articles(user_academic_affiliation_id)
where user_academic_affiliation_id is not null and deleted_at is null;
```

Notes:

- İlk fazda `user_id + article_id` bir aktif kayıt olarak tutulur.
- Aynı makalenin aynı user için birden fazla affiliation'a dağıtılması gerekirse ileride `article_affiliation_allocations` tablosu eklenmelidir.

Optional future table:

```sql
create table article_affiliation_allocations (
  id uuid primary key default gen_random_uuid(),
  user_article_id uuid not null references user_articles(id) on delete cascade,
  user_academic_affiliation_id uuid not null references user_academic_affiliations(id),
  allocation_rate numeric(5,2) null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);
```

## Required Change To Academic Affiliations

`user_academic_affiliations` tablosu article raporlama için tarihsel hale getirilmelidir.

Önerilen alanlar:

```sql
alter table user_academic_affiliations
  add column start_date date null,
  add column end_date date null,
  add column affiliation_type varchar(32) not null default 'MAIN',
  add column is_primary boolean not null default false;
```

Recommended constraint:

```sql
alter table user_academic_affiliations
  add constraint user_academic_affiliations_date_range_check
  check (end_date is null or start_date is null or end_date >= start_date);
```

Recommended semantics:

```text
MAIN       -> kullanıcının ana görevi/birimi
ADDITIONAL -> ek görev/ek birim
```

Raporlama kuralı:

1. `user_articles.user_academic_affiliation_id` varsa bunu kullan.
2. Yoksa `publication_year` ile çakışan affiliation kaydını bul.
3. Birden fazla varsa `is_primary = true` olan kaydı kullan.
4. Hala birden fazla veya hiç kayıt yoksa review listesine düş.

## Recommended Migration Order

Mevcut `docs/4_MIGRATION_ORDER_V2_PLAN.md` içindeki article bölümü şu şekilde güncellenmelidir:

```text
12 create_journals_table
13 create_journal_source_data_table
14 create_journal_metrics_table
15 create_articles_table
16 create_article_external_ids_table
17 create_article_authors_table
18 create_keywords_table
19 create_article_keywords_table
20 create_article_citation_counts_table
21 create_user_articles_table
```

Ayrıca academic affiliation migration'ı article modülü öncesinde güncellenmelidir:

```text
update_user_academic_affiliations_add_date_range_and_primary_fields
```

## Module Structure

Article domain tek modül altında toplanmalıdır:

```text
src/modules/articles/
  articles.routes.ts          Admin CRUD routes (requirePermission + ARTICLE_WRITE)
  articles.handlers.ts        Express handlers
  articles.schemas.ts         Zod validation
  articles.types.ts           DTO types

  articles.service.ts         Business logic (create/update/delete)
  articles.repository.ts      Kysely CRUD queries

  article-query.routes.ts     Read-only query routes (academician + manager)
  article-query.service.ts    Read/list logic
  article-query.repository.ts Kysely read queries

  journals.repository.ts
  journal-source-data.repository.ts
  journal-metrics.repository.ts

  article-authors.repository.ts
  article-keywords.repository.ts
  user-articles.repository.ts

  article-import.service.ts   WoS/Scopus import, duplicate detection, provisional metric creation
  article-report.service.ts   Aggregate/report logic
  article-report.repository.ts Aggregate/report queries
```

Sorumluluklar:

```text
routes/handlers
  Express route binding, request validation, response mapping

service
  workflow, transaction orchestration, policy decisions

repository
  Kysely SQL queries only

article-import.service
  WoS/Scopus import, duplicate detection, provisional metric creation

article-report.repository
  aggregate/report queries
```

Kural:

- Kysely sadece repository katmanında doğrudan kullanılmalıdır.
- Rapor sorguları CRUD repository'sine doldurulmamalıdır.
- Import workflow transaction kullanmalıdır.

## Import Workflow

### WoS / Scopus article import

High-level flow:

```text
1. Raw record parse edilir.
2. DOI, source external id ve title normalize edilir.
3. Existing article aranır:
   a. DOI match (articles.doi)
   b. source + external_id match (article_external_ids)
   c. normalized_title + publication_year + journal_id possible match
4. Journal bulunur veya oluşturulur.
5. Journal source data kaydedilir (kaynak bazlı isim/kısaltma).
6. Metric year = publication_year, source = primary_source için journal metric bulunur.
7. Yoksa önceki yıldan PROVISIONAL metric kaydı kopyalanır.
8. Article create/update edilir.
9. article_external_ids upsert edilir.
10. article_authors upsert edilir (tüm yazarlar — batch insert).
11. Internal authors user ile eşleştirilir (isim/e-posta matching).
12. Match edilen internal authors için user_articles create/update edilir.
13. keywords normalize edilip article_keywords yazılır.
14. citation counts yazılır.
15. articles.author_count ve articles.internal_author_count cache'leri güncellenir.
```

### Provisional journal metric creation

```text
Input: journal_id, metric_year, source

1. journal_metrics(journal_id, metric_year, source) varsa onu kullan.
2. Yoksa journal_metrics(journal_id, metric_year - 1, source, status in FINAL/PROVISIONAL) bul.
3. Bulunursa yeni metric_year için kopya oluştur:
   status = PROVISIONAL
   source_metric_year = metric_year - 1
4. Önceki yıl metric yoksa minimal boş PROVISIONAL kayıt oluştur veya article.journal_metric_id null bırak.
```

Tercih:

- Mümkünse boş metric yerine önceki yıl metric kopyası oluşturulur.
- Önceki yıl metric de yoksa null kabul edilebilir, fakat raporlar bunu `metric_missing` olarak göstermelidir.

### Final metric update

```text
Input: metric_year, source, imported metric rows

1. journal bulunur/eşleştirilir.
2. journal_metrics(journal_id, metric_year, source) bulunur.
3. Varsa aynı kayıt güncellenir:
   status = FINAL
   source_metric_year = metric_year
   announced_year = current year
   announced_month = 7
4. Yoksa FINAL kayıt oluşturulur.
5. Article records zaten journal_metric_id ile bu kayda bağlıysa ek update gerekmez.
6. Null kalan article metricleri için sync job çalışır.
```

## Reporting Strategy

İlk fazda normalized tablolar üzerinden Kysely aggregate sorguları yeterlidir. Tekrarlanan ağır join'ler artarsa SQL view veya materialized view eklenmelidir.

Sık kullanılacak raporlar:

```text
article count by year
article count by academic unit / department / discipline
article count by user
open access stats by year/unit
Q distribution by year/unit
citation count summary
keyword frequency
WoS vs Scopus source distribution
internal/external collaboration stats
articles missing final metric
articles missing affiliation resolution
mega-collaboration stats (author_count > 100)
```

Önerilen view:

```sql
create view article_report_rows as
select
  a.id as article_id,
  a.title,
  a.publication_year,
  a.publication_month,
  a.is_open_access,
  a.has_international_collaboration,
  a.has_industry_collaboration,
  a.has_national_collaboration,
  a.citation_count,
  a.author_count,
  a.internal_author_count,

  j.id as journal_id,
  j.name as journal_name,

  jm.metric_year,
  jm.source as metric_source,
  jm.status as metric_status,
  jm.q_value,
  jm.impact_factor,
  jm.percentile,
  jm.is_top_ten_percent,

  ua.user_id,
  ua.user_academic_affiliation_id
from articles a
join journals j on j.id = a.journal_id
left join journal_metrics jm on jm.id = a.journal_metric_id
left join user_articles ua on ua.article_id = a.id and ua.deleted_at is null
where a.deleted_at is null;
```

Bu view ilk fazda normal view olabilir. Veri büyüyünce materialized view'e geçilebilir.

## API Endpoints

### Admin endpoints (yazma — sadece ADMIN)

```text
POST   /api/articles                      requirePermission(ARTICLE_WRITE)
GET    /api/articles                      requirePermission(ARTICLE_WRITE) veya requireScopedPermission(ARTICLE_REPORT)
GET    /api/articles/:id                  requirePermission(ARTICLE_READ)
PATCH  /api/articles/:id                  requirePermission(ARTICLE_WRITE)
DELETE /api/articles/:id                  requirePermission(ARTICLE_WRITE)

GET    /api/articles/:id/authors          requirePermission(ARTICLE_READ)
POST   /api/articles/:id/authors          requirePermission(ARTICLE_WRITE)
PATCH  /api/articles/:id/authors/:authorId requirePermission(ARTICLE_WRITE)
DELETE /api/articles/:id/authors/:authorId requirePermission(ARTICLE_WRITE)

GET    /api/articles/:id/keywords         requirePermission(ARTICLE_READ)
POST   /api/articles/:id/keywords         requirePermission(ARTICLE_WRITE)
DELETE /api/articles/:id/keywords/:keywordId requirePermission(ARTICLE_WRITE)
```

### Academician endpoints (kendi makaleleri — okuma)

```text
GET    /api/me/articles                   requireAuth()
GET    /api/me/articles/:id               requireAuth()
GET    /api/me/articles/export            requireAuth()
```

### Manager endpoints (birim raporları — scoped okuma)

```text
GET    /api/article-reports/summary              requirePermission(ARTICLE_REPORT)
GET    /api/article-reports/by-year               requirePermission(ARTICLE_REPORT)
GET    /api/article-reports/by-academic-unit      requireScopedPermission(ARTICLE_REPORT, ACADEMIC_UNIT)
GET    /api/article-reports/by-department         requireScopedPermission(ARTICLE_REPORT, DEPARTMENT)
GET    /api/article-reports/by-discipline         requireScopedPermission(ARTICLE_REPORT, DISCIPLINE)
GET    /api/article-reports/q-distribution        requirePermission(ARTICLE_REPORT)
GET    /api/article-reports/open-access           requirePermission(ARTICLE_REPORT)
GET    /api/article-reports/collaboration         requirePermission(ARTICLE_REPORT)
GET    /api/article-reports/keywords              requirePermission(ARTICLE_REPORT)
GET    /api/article-reports/missing-affiliations  requirePermission(ARTICLE_REPORT)
GET    /api/article-reports/missing-final-metrics requirePermission(ARTICLE_REPORT)
```

### List response shape for tables

```ts
type PaginatedTableResponse<T> = {
  rows: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}
```

### Author list response shape (mega-collaboration aware)

```ts
type ArticleAuthorsResponse = {
  authors: ArticleAuthor[]    // ilk N yazar (pagination)
  pagination: {
    page: number
    limit: number
    total: number             // articles.author_count'ten okunur
    totalPages: number
  }
}
```

Error response shape should follow project standard:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "publication_year is required",
    "details": {}
  }
}
```

## Kysely Repository Guidelines

Avoid generic all-purpose Prisma-like include/select builders for this domain. Kysely should be used with explicit query functions.

Recommended repository functions:

```ts
findArticleById(id)
findArticleByExternalId(source, externalId)
findArticleByDoi(doi)
findPossibleDuplicateArticle(input)
listArticles(query)
createArticle(input)
updateArticle(id, input)
softDeleteArticle(id)

findOrCreateJournal(input)
upsertJournalSourceData(input)
findJournalMetric(journalId, metricYear, source)
findOrCreateProvisionalJournalMetric(journalId, metricYear, source)
finalizeJournalMetric(input)

upsertArticleExternalId(input)
bulkInsertArticleAuthors(articleId, authors)  // batch insert for mega-collabs
upsertArticleAuthor(input)
findInternalAuthorsByArticleId(articleId)      // partial index kullanır
upsertKeyword(input)
attachKeywordToArticle(input)
upsertArticleCitationCount(input)
assignArticleToUser(input)
updateArticleAuthorCounts(articleId)           // author_count + internal_author_count cache
```

Report repository functions:

```ts
getArticleSummary(filters)
getArticleCountsByYear(filters)
getArticleCountsByAcademicUnit(filters)
getQDistribution(filters)
getOpenAccessStats(filters)
getKeywordFrequency(filters)
getMissingAffiliationRows(filters)
getMissingFinalMetricRows(filters)
getCollaborationStats(filters)
```

## Validation Rules

Article create/import validation:

- `title` required.
- `publication_year` required and reasonable range should be enforced.
- `publication_month` nullable but if present must be 1..12.
- `journal_id` required after journal resolution.
- `primary_source` must be WOS, SCOPUS or MANUAL.
- At least one external id or DOI is preferred for imported records.
- `author_order` required for each author in `article_authors`.

External id validation:

- `source + external_id` unique among active records.
- DOI should be normalized to lowercase for matching.

User article validation:

- `user_id + article_id` active pair should be unique.
- If `user_academic_affiliation_id` is provided, it must belong to the same user.
- If affiliation date range does not overlap article publication year, service should warn or reject depending on import mode.

Journal metric validation:

- `journal_id + metric_year + source` active pair unique.
- `status` must be PROVISIONAL or FINAL.
- `source_metric_year` should be set for provisional copied metrics.

## V1 to V2 Code Migration

### Service layer transformation

V1 (Prisma, class-based):

```typescript
class ArticleManagerService {
  async createArticle(articleData: CreateArticleRequest) {
    const existingArticle = await prisma.articles.findUnique({
      where: { wosId: articleData.wosId }
    })
    return prisma.$transaction(async (tx) => { ... })
  }
}
```

V2 (Kysely, factory pattern):

```typescript
export const createArticleService = (deps: ArticleServiceDeps): ArticleService => ({
  async createArticle(input: CreateArticleInput) {
    // 1. DOI veya external_id ile duplicate kontrolü
    const existing = await deps.repository.findArticleByDoi(input.doi)
      ?? await deps.repository.findArticleByExternalId(input.source, input.externalId)
    if (existing) throw new AppError('CONFLICT', 'Article already exists')

    // 2. Journal resolve + provisional metric
    const journal = await deps.repository.findOrCreateJournal(input.journal)
    const metric = await deps.repository.findOrCreateProvisionalJournalMetric(
      journal.id, input.publicationYear, input.primarySource
    )

    // 3. Transaction ile article + external_ids + authors + keywords yaz
    return deps.db.transaction().execute(async (trx) => {
      const article = await deps.repository(trx).createArticle({
        ...input, journalId: journal.id, journalMetricId: metric.id
      })
      await deps.repository(trx).upsertArticleExternalIds(article.id, input.externalIds)
      await deps.repository(trx).bulkInsertArticleAuthors(article.id, input.authors)
      await deps.repository(trx).upsertKeywords(article.id, input.keywords)
      await deps.repository(trx).updateArticleAuthorCounts(article.id)
      return article
    })
  }
})
```

### Route layer transformation

V1:

```typescript
router.route('/').post(validateBody(CreateArticleRequestSchema), asyncHandler(controller.createArticle))
// Mount: /manager/articles
```

V2:

```typescript
export const createArticleRoutes = (deps: ArticleRoutesDeps) => {
  const router = Router()
  const controller = createArticleController(deps.service)

  router.post('/',
    requireAuth(),
    requirePermission({ service: deps.authService }, 'ARTICLE_WRITE'),
    validateBody(createArticleBodySchema),
    controller.createArticle
  )
  return router
}
// Mount: /api/articles (routes/index.ts factory'sinde)
```

### Query builder transformation

V1'deki `QueryBuilderHelper` (generic Prisma query builder) V2'de kullanılmayacak. Bunun yerine her repository fonksiyonu açık Kysely query yazacak:

```typescript
// article-query.repository.ts
export const createArticleQueryRepository = (db: Kysely<DB>) => ({
  async listArticles(params: ListArticlesParams) {
    let query = db.selectFrom('articles')
      .where('articles.deleted_at', 'is', null)

    if (params.search)
      query = query.where('articles.title', 'ilike', `%${params.search}%`)
    if (params.publicationYear)
      query = query.where('articles.publication_year', '=', params.publicationYear)
    if (params.academicUnitId)
      query = query
        .leftJoin('user_articles', 'user_articles.article_id', 'articles.id')
        .leftJoin('user_academic_affiliations',
          'user_academic_affiliations.id',
          'user_articles.user_academic_affiliation_id')
        .where('user_academic_affiliations.academic_unit_id', '=', params.academicUnitId)

    const [rows, countResult] = await Promise.all([
      query.orderBy('articles.created_at desc, articles.id desc')
        .limit(params.limit).offset((params.page - 1) * params.limit).execute(),
      db.selectFrom('articles').where('articles.deleted_at', 'is', null)
        .select(db.fn.countAll().as('count')).executeTakeFirst()
    ])

    return {
      rows,
      pagination: {
        page: params.page,
        limit: params.limit,
        total: Number(countResult?.count ?? 0)
      }
    }
  }
})
```

## Phase Plan

### Phase 1: Schema foundation

- Add affiliation date range fields.
- Create journals.
- Create journal_source_data.
- Create journal_metrics with PROVISIONAL/FINAL + source support.
- Create articles with raw date + parsed year/month + author_count cache + bibliographic fields.
- Create article_external_ids.
- Create article_authors with email, orcid, institution_name, mandatory author_order.
- Create keywords and article_keywords.
- Create article_citation_counts.
- Create user_articles with affiliation reference.

### Phase 2: Repository and import foundation

- Implement journal repository.
- Implement journal source data repository.
- Implement journal metric provisional creation logic (source-aware).
- Implement article external id duplicate lookup.
- Implement article create/update import transaction.
- Implement bulk article authors insert (mega-collab aware).
- Implement author/user matching placeholders.
- Implement keyword normalization/upsert.
- Implement article author count cache update.

### Phase 3: Admin listing and detail APIs

- Article list with page/limit.
- Article detail with journal, metric, authors (paginated), keywords, external ids.
- User article assignment management.
- Missing affiliation review endpoint.
- Missing final metric review endpoint.

### Phase 4: Reports

- Summary report.
- Year/unit/department/discipline breakdowns.
- Q distribution.
- Open access stats.
- Keyword frequency.
- Collaboration stats (including mega-collab stats).
- Export endpoints.

### Phase 5: Optimization

- Add SQL views for repeated report joins.
- Add materialized views if report performance requires it.
- Add batch refresh strategy.
- Add import audit tables if needed.

## Open Questions

These decisions should be confirmed before implementation:

1. Will Scopus and WoS records be auto-merged by DOI when DOI exists?
2. If DOI is missing, should possible duplicates be auto-merged or sent to review?
3. Can one `user_article` be counted under multiple affiliations, or exactly one affiliation?
4. Should external authors be imported fully from both WoS and Scopus in phase 1, or stored only when provided easily?
5. Should keyword source duplicates be preserved per source, or should article-keyword be unique regardless of source?
6. Should `journal_metrics.status = FINAL` prevent future updates at service level, or allow admin override?
7. Should `article_authors.raw_data` be populated for all authors or only internal + first/corresponding? (Current recommendation: only internal + first/corresponding for storage optimization.)
8. Should journal metric `source` use 'WOS'/'SCOPUS' or 'JCR'/'SJR'? (Check constraint allows both; first phase should pick one convention.)

## Final Recommendation

V2 should not copy v1 article schema one-to-one. The correct direction is:

```text
articles = publication source of truth (DOI, parsed dates, author_count cache, bibliographic fields)
article_external_ids = WoS/Scopus source identity mapping (DOI excluded)
journal_source_data = source-specific journal names/abbreviations/IDs
journal_metrics = year + source based metric records with provisional/final lifecycle
article_authors = all authors, internal and external (email, orcid, institution_name)
user_articles = internal user reporting relation, linked to affiliation
keywords/article_keywords = normalized keyword reporting
article_citation_counts = yearly citation trend
```

This design keeps v1's working journal metric behavior, but makes it explicit and reportable. It supports WoS + Scopus with source-specific journal data and metrics. It handles mega-collaboration articles with 5000+ authors through partial indexes and cached counts. It prepares the system for external authors with institution/email/orcid, keyword reports, bibliographic data, and Kysely-based aggregate queries. The system is extensible for future data sources beyond WoS and Scopus.
