# Articles / Publications V2 Plan

## Summary

Bu dokuman, v1 `ardek-api` icindeki article/journal/user-article yapisi incelendikten sonra `idas-api` v2 icin onerilen makale/yayin domain tasarimini tanimlar.

V1'de makaleler sadece Web of Science kaynagi ile sisteme alinmis, Prisma oncesinde Sequelize gecmisi olan mevcut PostgreSQL semasi uzerinden devam edilmistir. V2'de ise Kysely kullanilacak, Web of Science ve Scopus kaynaklari birlikte desteklenecek, sistem raporlama agirlikli calisacaktir.

Ana hedefler:

- WoS ve Scopus makalelerini duplicate uretmeden ayni article kaydinda birlestirebilmek.
- WoS'tan gelen eksik/tam olmayan tarih metinlerini kaybetmeden yil/ay bazli raporlayabilmek.
- Journal metric gecici kopyalama modelini desteklemek.
- Kurum ici ve kurum disi yazar bilgilerini ayri ama iliskili sekilde saklamak.
- Makaleleri kullanicinin akademik affiliation kaydi ile raporlayabilmek.
- Anahtar kelimeleri normalize ederek raporlanabilir hale getirmek.
- Kysely ile CRUD ve raporlama sorgularini ayri repository/service katmanlarinda tutmak.

## V1 Snapshot

V1'de article domain su ana tablolardan olusur:

```text
Articles
JournalMetrics
Journals
UserArticles
ArticleCitationCounts
```

V1 `Articles` tablosunda dikkat ceken alanlar:

```text
wosId
publicationDate      varchar/string
year                 integer
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

V1 `UserArticles` tablosu sadece kurum ici kullanici ile article arasinda link table gibi calisir:

```text
userId
articleId
createdAt
updatedAt
deletedAt
```

V1'den alinacak iyi kararlar:

- Article, journal, journal metric, user article ve citation counts ayrimi genel olarak dogru.
- `wosId` tekilligi veri tekrarini engellemek icin faydali.
- `ArticleCitationCounts(articleId, year)` modeli yillik atif trendi icin dogru.
- `journalMetricId` ile article'in ilgili yilin metric kaydina baglanmasi pratik.

V1'den aynen tasinmamasi gerekenler:

- Sadece `wosId` uzerinden dis kaynak takibi v2 icin yetersizdir; Scopus da desteklenecek.
- `UserArticles` sadece link table olarak kalirsa kurum disi yazar ve affiliation raporlari zayif kalir.
- Duplicate kontrol sadece service katmaninda kalmamali; partial unique index ile DB seviyesinde garanti verilmelidir.
- CamelCase tablo/kolon isimleri v2'ye tasinmamalidir; snake_case kullanilmalidir.

## Core Domain Decisions

### 1. Source systems

V2 makale kaynaklari:

```text
WOS
SCOPUS
MANUAL
```

Ilk hedef WoS + Scopus'tur. Manual kayit opsiyonu admin duzeltmeleri icin tutulabilir.

Tek bir article kaydi birden fazla external id'ye sahip olabilir:

```text
WOS: WOS:000123456789
SCOPUS: 85123456789
DOI: 10.xxxx/yyyy
```

Bu nedenle `article_external_ids` tablosu gereklidir.

### 2. Publication date handling

WoS `publicationDate` ve `earlyAccessDate` alanlarini tam tarih olarak vermeyebilir. Ornekler:

```text
2025
JAN 2025
JAN-FEB 2025
MAY 2025
```

Sistem icin asil onemli alan yildir. Ay bilgisi gelirse saklanmalidir. Bu nedenle raw string ve parse edilmis yil/ay birlikte tutulur.

Onerilen article alanlari:

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

- Raw deger kaybedilmemelidir.
- Raporlar `publication_year` uzerinden calismalidir.
- Ay parse edilebiliyorsa `publication_month` veya `early_access_month` doldurulmalidir.
- Ay parse edilemiyorsa null kalmalidir.
- `publication_month` ve `early_access_month` icin `1..12` check constraint eklenmelidir.

### 3. Journal metrics lifecycle

Journal metricleri her yil temmuz ayinda aciklanir ve bir yil geriden gelir.

Ornek:

```text
2026 Temmuz -> 2025 journal metricleri aciklanir.
```

V1'de uygulanan model:

- 2025 makaleleri metriksiz kalmaz.
- 2025 metric kaydi, gecici olarak 2024 metric degerleriyle olusturulur.
- 2025 gercek metricleri aciklaninca ayni `journal_metrics.year = 2025` kaydi guncellenir.
- Article zaten `journal_metric_id` ile bu kayda bagli oldugu icin raporlar otomatik guncel metric degerlerini kullanir.

V2'de bu model korunmalidir, fakat daha acik alanlarla izlenmelidir.

Onerilen alanlar:

```text
metric_year integer not null
announced_year integer null
announced_month smallint null
status varchar not null default 'PROVISIONAL'
source_metric_year integer null
```

Status degerleri:

```text
PROVISIONAL
FINAL
```

Anlamlari:

- `PROVISIONAL`: Bu metric kaydi henuz ilgili yilin gercek JCR/metric verisi degildir; onceki yilin degerlerinden kopyalanmistir.
- `FINAL`: Ilgili yilin gercek metric verisi aciklanmis ve kayit nihai hale gelmistir.

Ornek:

```text
journal_metrics.metric_year = 2025
status = PROVISIONAL
source_metric_year = 2024
q_value = 2024 degeri
impact_factor = 2024 degeri

2026 Temmuz sonrasi:
metric_year = 2025
status = FINAL
source_metric_year = null veya 2025
q_value = 2025 gercek degeri
impact_factor = 2025 gercek degeri
```

### 4. Article to journal metric relation

Article, yayin yilina ait journal metric kaydina baglanmalidir:

```text
articles.publication_year = journal_metrics.metric_year
articles.journal_id = journal_metrics.journal_id
```

Article alanlari:

```text
journal_id uuid not null
journal_metric_id uuid null
```

`journal_metric_id` teknik olarak nullable olabilir, ancak normal workflow'da her article icin provisional veya final metric kaydi bulunmasi hedeflenmelidir.

Create/import workflow:

1. Article'in `journal_id` ve `publication_year` degeri belirlenir.
2. `journal_metrics(journal_id, metric_year = publication_year)` aranir.
3. Varsa article bu metric'e baglanir.
4. Yoksa onceki yil metric kaydi bulunur.
5. Onceki yil metric kaydi varsa yeni yil icin `PROVISIONAL` metric kaydi kopyalanir.
6. Article yeni provisional metric kaydina baglanir.
7. Gercek metric aciklandiginda ayni `journal_metrics` kaydi `FINAL` olarak guncellenir.

Bu model sayesinde makaleler hic metriksiz kalmaz ve article kayitlarini tek tek yeniden baglamak gerekmez.

### 5. Internal and external authors

V1'de sadece kurum ici yazarlar `UserArticles` ile tutulur. V2'de kurum disi yazarlar da saklanabilmelidir, ancak kurum disi yazarlar `users` tablosuna eklenmemelidir.

Bu nedenle iki tablo ayrimi onerilir:

```text
article_authors -> makaledeki tum yazarlar, kurum ici/disi
user_articles   -> sistemdeki user ile article arasindaki raporlama iliskisi
```

`article_authors` dis yazarlar icin de calisir. Kurum ici yazar tespit edilirse `user_id` ile users tablosuna baglanabilir.

Su an icin first author, corresponding author ve author order kritik degildir; fakat kaynaklardan gelirse saklanacak alanlar hazir olmalidir.

### 6. Academic affiliations

Bazi akademisyenlerin birden fazla academic unit, department ve discipline kaydi olabilir. Makaleler bu affiliation kayitlarina gore raporlanabilmelidir.

Bu nedenle `user_academic_affiliations` tablosunda tarih araligi olmalidir:

```text
start_date date null
end_date date null
affiliation_type varchar not null default 'MAIN'
is_primary boolean not null default false
```

`user_articles` kaydi ilgili affiliation'a baglanabilmelidir:

```text
user_academic_affiliation_id uuid null
```

Bu alan sayesinde bir makalenin hangi akademik birim/bolum/discipline altinda raporlanacagi netlesir.

Varsayilan raporlama yaklasimi:

- Eger `user_articles.user_academic_affiliation_id` doluysa raporda bu affiliation kullanilir.
- Bos ise article yayin yili ile kullanicinin aktif affiliation tarih araligi eslestirilir.
- Birden fazla uygun affiliation varsa `is_primary = true` olan tercih edilir.
- Hala belirsizse kayit rapor oncesi manuel review gerektirir.

### 7. Keywords

WoS ve Scopus anahtar kelimeleri saklanmalidir. Keywordler normalize edilerek tekrarlar azaltilmalidir.

Onerilen ayrim:

```text
keywords
article_keywords
```

`keywords.normalized_name` unique olmalidir. `article_keywords` source bilgisini saklamalidir.

Normalize kurali ilk fazda basit tutulabilir:

```text
trim
lowercase
multiple whitespace -> single whitespace
```

### 8. Pagination

Front-end klasik sayfalamali tablo kullandigi icin admin/list endpointlerinde cursor pagination zorunlu degildir.

Liste endpointleri icin `page/limit` kullanilabilir:

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

- Admin tablolarinda `page/limit` kullanilir.
- Buyuk export, background sync veya internal batch islerinde gerekirse cursor/keyset kullanilabilir.
- Offset pagination kullanilirken siralama stabil olmalidir: `order by created_at desc, id desc`.

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

### journal_metrics

```sql
create table journal_metrics (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references journals(id),

  metric_year integer not null,
  announced_year integer null,
  announced_month smallint null,

  status varchar(32) not null default 'PROVISIONAL',
  source_metric_year integer null,

  q_value varchar(2) null,
  impact_factor numeric(10,4) null,
  percentile numeric(6,3) null,
  is_top_ten_percent boolean not null default false,
  is_penalized boolean not null default false,

  source varchar(64) not null default 'JCR',
  raw_data jsonb null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,

  constraint journal_metrics_status_check
    check (status in ('PROVISIONAL', 'FINAL')),

  constraint journal_metrics_announced_month_check
    check (announced_month is null or announced_month between 1 and 12)
);
```

Recommended indexes:

```sql
create unique index journal_metrics_journal_year_active_unique
on journal_metrics(journal_id, metric_year)
where deleted_at is null;

create index journal_metrics_year_status_idx
on journal_metrics(metric_year, status)
where deleted_at is null;
```

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

```sql
create table article_external_ids (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  source varchar(32) not null,
  external_id varchar(255) not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null,

  constraint article_external_ids_source_check
    check (source in ('WOS', 'SCOPUS', 'DOI', 'MANUAL'))
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
1. DOI match
2. source + external_id match
3. normalized_title + publication_year + journal_id possible match
```

The third step should not auto-merge without review unless confidence rules are defined.

### article_authors

```sql
create table article_authors (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,

  full_name text not null,
  normalized_name text null,
  institution_name text null,
  country text null,

  is_internal boolean not null default false,
  user_id uuid null references users(id),

  author_order integer null,
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
create index article_authors_article_idx
on article_authors(article_id)
where deleted_at is null;

create index article_authors_user_idx
on article_authors(user_id)
where user_id is not null and deleted_at is null;

create index article_authors_normalized_name_idx
on article_authors(normalized_name)
where deleted_at is null;
```

Notes:

- Kurum disi yazarlar `users` tablosuna eklenmez.
- Kurum ici yazar eslesirse `user_id` doldurulur.
- `author_order`, `is_first_author`, `is_corresponding_author` su an kritik degildir ama kaynak veri saglarsa saklanir.

### keywords

```sql
create table keywords (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
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

`articles.citation_count` current/latest total count cache gibi kullanilabilir. Yillik trend icin `article_citation_counts` kullanilir.

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

- Ilk fazda `user_id + article_id` bir aktif kayit olarak tutulur.
- Ayni makalenin ayni user icin birden fazla affiliation'a dagitilmasi gerekirse ileride `article_affiliation_allocations` tablosu eklenmelidir.

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

`user_academic_affiliations` tablosu article raporlama icin tarihsel hale getirilmelidir.

Onerilen alanlar:

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
MAIN       -> kullanicinin ana gorevi/birimi
ADDITIONAL -> ek gorev/ek birim
```

Raporlama kurali:

1. `user_articles.user_academic_affiliation_id` varsa bunu kullan.
2. Yoksa `publication_year` ile cakisan affiliation kaydini bul.
3. Birden fazla varsa `is_primary = true` olan kaydi kullan.
4. Hala birden fazla veya hic kayit yoksa review listesine dusur.

## Recommended Migration Order

Mevcut `docs/4_MIGRATION_ORDER_V2_PLAN.md` icindeki article bolumu su sekilde genisletilmelidir:

```text
12 create_journals_table
13 create_journal_metrics_table
14 create_articles_table
15 create_article_external_ids_table
16 create_article_authors_table
17 create_keywords_table
18 create_article_keywords_table
19 create_article_citation_counts_table
20 create_user_articles_table
```

Ayrica academic affiliation migration'i article modulu oncesinde guncellenmelidir:

```text
update_user_academic_affiliations_add_date_range_and_primary_fields
```

## Module Structure

Article domain tek modul altinda toplanmalidir:

```text
src/modules/articles/
  articles.routes.ts
  articles.handlers.ts
  articles.schemas.ts
  articles.types.ts

  articles.service.ts
  articles.repository.ts

  journals.repository.ts
  journal-metrics.repository.ts

  article-authors.repository.ts
  article-keywords.repository.ts
  user-articles.repository.ts

  article-import.service.ts
  article-report.service.ts
  article-report.repository.ts
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

- Kysely sadece repository katmaninda dogrudan kullanilmalidir.
- Rapor sorgulari CRUD repository'sine doldurulmamalidir.
- Import workflow transaction kullanmalidir.

## Import Workflow

### WoS / Scopus article import

High-level flow:

```text
1. Raw record parse edilir.
2. DOI, source external id ve title normalize edilir.
3. Existing article aranir:
   a. DOI match
   b. source + external_id match
   c. normalized_title + publication_year + journal possible match
4. Journal bulunur veya olusturulur.
5. Metric year = publication_year icin journal metric bulunur.
6. Yoksa onceki yildan PROVISIONAL metric kaydi kopyalanir.
7. Article create/update edilir.
8. article_external_ids upsert edilir.
9. article_authors upsert edilir.
10. Internal authors user ile eslestirilir.
11. user_articles create/update edilir.
12. keywords normalize edilip article_keywords yazilir.
13. citation counts yazilir.
```

### Provisional journal metric creation

```text
Input: journal_id, metric_year

1. journal_metrics(journal_id, metric_year) varsa onu kullan.
2. Yoksa journal_metrics(journal_id, metric_year - 1, status in FINAL/PROVISIONAL) bul.
3. Bulunursa yeni metric_year icin kopya olustur:
   status = PROVISIONAL
   source_metric_year = metric_year - 1
4. Onceki yil metric yoksa minimal bos PROVISIONAL kayit olustur veya article.journal_metric_id null birak.
```

Tercih:

- Mumkunse bos metric yerine onceki yil metric kopyasi olustur.
- Onceki yil metric de yoksa null kabul edilebilir, fakat raporlar bunu `metric_missing` olarak gostermelidir.

### Final metric update

```text
Input: metric_year, imported metric rows

1. journal bulunur/eslestirilir.
2. journal_metrics(journal_id, metric_year) bulunur.
3. Varsa ayni kayit guncellenir:
   status = FINAL
   source_metric_year = metric_year
   announced_year = current year
   announced_month = 7
4. Yoksa FINAL kayit olusturulur.
5. Article records zaten journal_metric_id ile bu kayda bagliysa ek update gerekmez.
6. Null kalan article metricleri icin sync job calisir.
```

## Reporting Strategy

Ilk fazda normalized tablolar uzerinden Kysely aggregate sorgulari yeterlidir. Tekrarlanan agir join'ler artarsa SQL view veya materialized view eklenmelidir.

Sik kullanilacak raporlar:

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
```

Onerilen view:

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

  j.id as journal_id,
  j.name as journal_name,

  jm.metric_year,
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

Bu view ilk fazda normal view olabilir. Veri buyuyunce materialized view'e gecilebilir.

## API Endpoints

Recommended admin endpoints:

```text
GET    /v1/articles
POST   /v1/articles
GET    /v1/articles/:id
PATCH  /v1/articles/:id
DELETE /v1/articles/:id

GET    /v1/articles/:id/authors
POST   /v1/articles/:id/authors
PATCH  /v1/articles/:id/authors/:authorId
DELETE /v1/articles/:id/authors/:authorId

GET    /v1/articles/:id/keywords
POST   /v1/articles/:id/keywords
DELETE /v1/articles/:id/keywords/:keywordId

GET    /v1/me/articles
GET    /v1/me/articles/export
```

Recommended report endpoints:

```text
GET /v1/article-reports/summary
GET /v1/article-reports/by-year
GET /v1/article-reports/by-academic-unit
GET /v1/article-reports/by-department
GET /v1/article-reports/by-discipline
GET /v1/article-reports/q-distribution
GET /v1/article-reports/open-access
GET /v1/article-reports/collaboration
GET /v1/article-reports/keywords
GET /v1/article-reports/missing-affiliations
GET /v1/article-reports/missing-final-metrics
```

List response shape for tables:

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
findJournalMetric(journalId, metricYear)
findOrCreateProvisionalJournalMetric(journalId, metricYear)
finalizeJournalMetric(input)

upsertArticleExternalId(input)
upsertArticleAuthor(input)
upsertKeyword(input)
attachKeywordToArticle(input)
upsertArticleCitationCount(input)
assignArticleToUser(input)
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
```

## Validation Rules

Article create/import validation:

- `title` required.
- `publication_year` required and reasonable range should be enforced.
- `publication_month` nullable but if present must be 1..12.
- `journal_id` required after journal resolution.
- `primary_source` must be WOS, SCOPUS or MANUAL.
- At least one external id or DOI is preferred for imported records.

External id validation:

- `source + external_id` unique among active records.
- DOI should be normalized to lowercase for matching.

User article validation:

- `user_id + article_id` active pair should be unique.
- If `user_academic_affiliation_id` is provided, it must belong to the same user.
- If affiliation date range does not overlap article publication year, service should warn or reject depending on import mode.

Journal metric validation:

- `journal_id + metric_year` active pair unique.
- `status` must be PROVISIONAL or FINAL.
- `source_metric_year` should be set for provisional copied metrics.

## Open Questions

These decisions should be confirmed before implementation:

1. Will Scopus and WoS records be auto-merged by DOI when DOI exists?
2. If DOI is missing, should possible duplicates be auto-merged or sent to review?
3. Can one `user_article` be counted under multiple affiliations, or exactly one affiliation?
4. Should external authors be imported fully from both WoS and Scopus in phase 1, or stored only when provided easily?
5. Should keyword source duplicates be preserved per source, or should article-keyword be unique regardless of source?
6. Should `journal_metrics.status = FINAL` prevent future updates at service level, or allow admin override?

## Phase Plan

### Phase 1: Schema foundation

- Add affiliation date range fields.
- Create journals.
- Create journal_metrics with PROVISIONAL/FINAL support.
- Create articles with raw date + parsed year/month fields.
- Create article_external_ids.
- Create article_authors.
- Create keywords and article_keywords.
- Create article_citation_counts.
- Create user_articles with affiliation reference.

### Phase 2: Repository and import foundation

- Implement journal repository.
- Implement journal metric provisional creation logic.
- Implement article external id duplicate lookup.
- Implement article create/update import transaction.
- Implement author/user matching placeholders.
- Implement keyword normalization/upsert.

### Phase 3: Admin listing and detail APIs

- Article list with page/limit.
- Article detail with journal, metric, authors, keywords, external ids.
- User article assignment management.
- Missing affiliation review endpoint.
- Missing final metric review endpoint.

### Phase 4: Reports

- Summary report.
- Year/unit/department/discipline breakdowns.
- Q distribution.
- Open access stats.
- Keyword frequency.
- Collaboration stats.
- Export endpoints.

### Phase 5: Optimization

- Add SQL views for repeated report joins.
- Add materialized views if report performance requires it.
- Add batch refresh strategy.
- Add import audit tables if needed.

## Final Recommendation

V2 should not copy v1 article schema one-to-one. The correct direction is:

```text
articles = publication source of truth
article_external_ids = WoS/Scopus/DOI identity mapping
journal_metrics = year-based metric records with provisional/final lifecycle
article_authors = all authors, internal and external
user_articles = internal user reporting relation, linked to affiliation
keywords/article_keywords = normalized keyword reporting
article_citation_counts = yearly citation trend
```

This design keeps v1's working journal metric behavior, but makes it explicit and reportable. It also prepares the system for WoS + Scopus merge, external authors, multiple academic affiliations, keyword reports and Kysely-based aggregate queries.
