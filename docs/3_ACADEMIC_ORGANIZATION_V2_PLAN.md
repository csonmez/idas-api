# Academic Organization V2 Migration Plani

## Summary

Users/auth migrationlari tamamlandiktan sonra siradaki temel blok akademik organizasyon ve yetki baglamidir.

Bu blok iki sorumluluga ayrilacak:

- Akademik organizasyon master datasi:
  - `academic_units`
  - `departments`
  - `disciplines`
- Kullanici akademik bagliligi ve yetki baglami:
  - `user_academic_affiliations`
  - `role_permissions`

Eski projedeki `UserAcademicUnits` tablosu V2'de `user_academic_affiliations` olarak adlandirilacak. Bu isim tabloyu daha net anlatir: kayit bir akademik birimin kendisi degil, kullanicinin ust akademik birim/bolum/anabilim dali bagliligidir.

`universities` tablosu V2'nin bu asamasinda olusturulmayacak. Proje tek universite kurulumu olarak tasarlandigi icin universiteyi tabloya almak bugun ek FK ve migration yuku getirir. Ileride gercek multi-university/tenant ihtiyaci dogarsa bu sadece `universities` eklemek degil, daha genis bir kurum/tenant modellemesi olarak ele alinmalidir.

## Recommended Migration Order

1. `academic_units`
2. `departments`
3. `disciplines`
4. `user_academic_affiliations`
5. `role_permissions`

Bu sira FK bagimliliklarini dogal sekilde takip eder:

- `departments.academic_unit_id -> academic_units.id`
- `disciplines.department_id -> departments.id`
- `disciplines.academic_unit_id -> academic_units.id`
- `user_academic_affiliations.user_id -> users.id`
- `user_academic_affiliations.academic_unit_id -> academic_units.id`
- `user_academic_affiliations.department_id -> departments.id`
- `user_academic_affiliations.discipline_id -> disciplines.id`
- `role_permissions.user_id -> users.id`
- `role_permissions.academic_unit_id -> academic_units.id`
- `role_permissions.department_id -> departments.id`
- `role_permissions.discipline_id -> disciplines.id`

## Naming Decisions

### Table Names

Eski tablo adlari PascalCase/plural karisikligi tasiyordu. V2'de snake_case plural tablo isimleri kullanilacak.

```text
Faculties           -> academic_units
Departments         -> departments
Disciplines         -> disciplines
UserAcademicUnits   -> user_academic_affiliations
RolePermissions     -> role_permissions
```

### Column Names

V2 genel kural:

- Primary key: `id`
- Foreign key: `{table_singular}_id`
- Timestamp kolonlari: `created_at`, `updated_at`, `deleted_at`
- Boolean kolonlari gercek true/false domain kurallari icin `is_*`, `has_*`, `enable_*` formunda tutulacak.
- Iki durumlu gibi gorunen ama aslinda bir "mod/seviye" secen alanlarda enum tercih edilecek.

## Schema

### `academic_units`

```text
id uuid primary key
type academic_unit_type not null
academic_field academic_field null
sub_unit_level sub_unit_level not null default 'DEPARTMENT'
is_tracked boolean not null default true
code varchar(64) not null
name varchar(255) not null
short_name varchar(255) null
phone varchar(255) null
email varchar(255) null
address varchar(255) null
website varchar(255) null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz null
```

Enumlar:

```text
academic_unit_type: FACULTY, INSTITUTE, SCHOOL, VOCATIONAL_SCHOOL
academic_field: HEALTH, SOCIAL, SCIENCE_ENGINEERING
sub_unit_level: DEPARTMENT, DISCIPLINE
```

Indexler:

```text
Ilk migrationda standalone enum/boolean/deleted_at index'i eklenmeyecek.
Bu tablo kucuk kalacagi icin `type`, `academic_field`, `sub_unit_level`, `is_tracked`
ve `deleted_at` indexleri ancak gercek sorgu plani ihtiyac gosterirse eklenecek.
```

Partial unique indexler:

```text
unique active academic unit code:
unique (code)
where deleted_at is null
```

Notlar:

- `name` not null olmali. Bos isimli ust akademik birim domain olarak anlamsiz.
- `name` user-facing label olarak kalacak; teknik benzersizlik `code` ile saglanacak.
- `name` icin ilk migrationda DB unique constraint eklenmeyecek. Kayit oncesi `trim` ve fazla bosluk sadelestirme app seviyesinde yapilacak.
- `type` akademik/organizasyonel ust birim turunu anlatir.
- `FACULTY`: fakulte olarak ele alinacak ust birimler. Rektorluk kaydi mevcut domainde bu grupta kalabilir.
- `INSTITUTE`: enstituler.
- `SCHOOL`: yuksekokullar. Ornek: Yabanci Diller Yuksekokulu.
- `VOCATIONAL_SCHOOL`: meslek yuksekokullari.
- Rektorluk icin ozel `RECTORATE` enum degeri eklenmeyecek. Rektorluk hedef/rapor surecine girmeyecekse bu davranis `is_tracked = false` ile yonetilecek.
- `academic_field` akademik/raporlama alanini anlatir. `field` tek basina fazla genel oldugu icin V2'de `academic_field` tercih edilecek.
- `sub_unit_level` eski `enableDisciplineHeadAccess` boolean alaninin yerine kullanilacak.
- `sub_unit_level = DEPARTMENT`: bu ust birimde bolumler ana islem/raporlama seviyesidir.
- `sub_unit_level = DISCIPLINE`: bu ust birimde anabilim dallari ana islem/raporlama seviyesidir.
- `is_tracked`: bu ust birimin hedef, performans ve rapor sureclerinde takip edilip edilmeyecegini belirler.
- Rektorluk gibi personel baglanan ama hedef/performans/rapor sureclerine dahil edilmeyen kayitlarda `is_tracked = false` olacak.
- Diger fakulte, enstitu, yuksekokul veya meslek yuksekokulu kayitlari bu sureclere girecekse `is_tracked = true` kalacak.
- `sub_unit_level` bir ac/kapat alani degil, ust birimin ana alt seviye secimidir.
- `code` stabil teknik anahtardir. Seed, import, veri tasima ve entegrasyonlarda kullanilir.
- `short_name` kullaniciya gosterilecek kisa addir. `code` ile ayni deger olabilir ama sorumlulugu farklidir.
- `academic_field` nullable kalabilir; eski projede de tum kayitlar icin garanti degil.

### `departments`

```text
id uuid primary key
academic_unit_id uuid not null references academic_units(id) on update cascade on delete restrict
code varchar(64) not null
name varchar(255) not null
short_name varchar(255) null
phone varchar(255) null
email varchar(255) null
address varchar(255) null
website varchar(255) null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz null
```

Constraintler:

```text
unique (id, academic_unit_id)
```

Indexler:

```text
index departments_academic_unit_id_idx on departments(academic_unit_id)
```

Partial unique indexler:

```text
unique active department code per academic unit:
unique (academic_unit_id, code)
where deleted_at is null
```

Notlar:

- `academic_unit_id` not null olmali. Bolum ust akademik birim baglami olmadan kullanilmiyor.
- `code` bolum icin stabil teknik anahtardir; `short_name` gosterim kisaltmasidir.
- `name` user-facing label olarak kalacak; ayni ust akademik birim icindeki teknik benzersizlik `code` ile saglanacak.
- `unique (id, academic_unit_id)` ilk bakista redundant gorunur, cunku `id` zaten primary key. Ancak `disciplines(department_id, academic_unit_id)` icin composite FK hedefi olarak gereklidir.
- `on delete restrict` tercih edilmeli. Ust akademik birim silinirken alt bolum/anabilim dali iliskileri fark edilmeden kopmamali.

### `disciplines`

```text
id uuid primary key
academic_unit_id uuid not null
department_id uuid not null
code varchar(64) not null
name varchar(255) not null
short_name varchar(255) null
phone varchar(255) null
email varchar(255) null
address varchar(255) null
website varchar(255) null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz null
```

FK'ler:

```text
foreign key (academic_unit_id) references academic_units(id) on update cascade on delete restrict
foreign key (department_id, academic_unit_id) references departments(id, academic_unit_id) on update cascade on delete restrict
```

Constraintler:

```text
unique (id, department_id, academic_unit_id)
```

Indexler:

```text
index disciplines_academic_unit_id_idx on disciplines(academic_unit_id)
index disciplines_department_id_idx on disciplines(department_id)
```

Partial unique indexler:

```text
unique active discipline code per academic unit:
unique (academic_unit_id, code)
where deleted_at is null
```

Notlar:

- Normal formda `academic_unit_id`, `department_id -> departments.academic_unit_id` uzerinden turetilebilir.
- Buna ragmen V2'de `disciplines.academic_unit_id` tutulabilir; bu bilincli ve kontrollu denormalizasyon olur.
- `academic_unit_id` bu domain icin gerekli kabul edilecek. Tip gibi yapilarda hedef ve raporlama bolumden cok anabilim dali uzerinden ilerler.
- `code` anabilim dali icin stabil teknik anahtardir; `short_name` gosterim kisaltmasidir.
- `name` user-facing label olarak kalacak; ayni ust akademik birim icindeki teknik benzersizlik `code` ile saglanacak.
- Direkt "bir ust akademik birimin anabilim dallari" sorgusu sik kullanilacaksa `academic_unit_id` pratik fayda saglar:

```sql
select *
from disciplines
where academic_unit_id = $1
  and deleted_at is null;
```

- Veri tutarliligi DB seviyesinde composite FK ile garanti edilmeli. Boylece bir discipline kaydi, bagli oldugu department'in academic unit'inden farkli bir `academic_unit_id` alamaz.
- `department_id` degisirken `academic_unit_id` de ayni transaction icinde dogru degerle guncellenmeli.

### `user_academic_affiliations`

```text
id uuid primary key
user_id uuid not null references users(id) on update cascade on delete cascade
academic_unit_id uuid null references academic_units(id) on update cascade on delete restrict
department_id uuid null
discipline_id uuid null
affiliation_type academic_affiliation_type not null default 'PRIMARY'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz null
```

Enum:

```text
academic_affiliation_type: PRIMARY, SECONDARY
```

FK'ler:

```text
foreign key (department_id, academic_unit_id) references departments(id, academic_unit_id) on update cascade on delete restrict
foreign key (discipline_id, department_id, academic_unit_id) references disciplines(id, department_id, academic_unit_id) on update cascade on delete restrict
```

Bu composite FK'lerin calismasi icin `disciplines` tarafinda su unique constraint gerekir:

```text
unique (id, department_id, academic_unit_id)
```

Indexler:

```text
index user_academic_affiliations_user_id_idx on user_academic_affiliations(user_id)
index user_academic_affiliations_academic_unit_id_idx on user_academic_affiliations(academic_unit_id)
index user_academic_affiliations_department_id_idx on user_academic_affiliations(department_id)
index user_academic_affiliations_discipline_id_idx on user_academic_affiliations(discipline_id)
```

Partial unique index:

```text
unique active primary affiliation:
unique (user_id)
where affiliation_type = 'PRIMARY' and deleted_at is null
```

Duplicate engelleme:

```text
unique active same academic-unit-level affiliation:
unique (user_id, academic_unit_id)
where academic_unit_id is not null
  and department_id is null
  and discipline_id is null
  and deleted_at is null

unique active same department-level affiliation:
unique (user_id, department_id)
where department_id is not null
  and discipline_id is null
  and deleted_at is null

unique active same discipline-level affiliation:
unique (user_id, discipline_id)
where discipline_id is not null
  and deleted_at is null
```

Check constraint:

```text
at least one of academic_unit_id, department_id, discipline_id must be present
```

Notlar:

- Eski projede bu tablonun adi `UserAcademicUnits` idi. V2'de `user_academic_affiliations` kullanilacak.
- Eski `MAIN` degeri V2'de `PRIMARY` olacak.
- Eski `ADDITIONAL` degeri V2'de `SECONDARY` olacak.
- Bir kullanicinin aktif tek PRIMARY akademik bagliligi olmali. Bu kural app seviyesine birakilmamali; partial unique index ile DB seviyesinde korunmali.
- SECONDARY bagliliklar birden fazla olabilir.
- SECONDARY sadece gercek akademik/kadro bagliligi varsa kullanilmali. Bir kisinin baska fakulte/enstitude idari gorevi olmasi tek basina secondary affiliation olusturmak icin yeterli sebep degildir.
- Idari/yetki gorevleri `role_permissions` scope kolonlariyla modellenmeli.
- `department_id` doluysa `academic_unit_id` de dolu olmali.
- `discipline_id` doluysa `department_id` ve `academic_unit_id` de dolu olmali.
- Bu hiyerarsi check constraint ile de desteklenmeli:

```text
department_id is null or academic_unit_id is not null
discipline_id is null or (department_id is not null and academic_unit_id is not null)
```

### `role_permissions`

```text
id uuid primary key
user_id uuid not null references users(id) on update cascade on delete cascade
role varchar(255) not null
permissions text[] not null default '{}'
scope_type role_scope_type not null default 'GLOBAL'
academic_unit_id uuid null references academic_units(id) on update cascade on delete restrict
department_id uuid null
discipline_id uuid null
start_date timestamptz null
end_date timestamptz null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz null
```

Enumlar:

```text
role_scope_type: GLOBAL, ACADEMIC_UNIT, DEPARTMENT, DISCIPLINE
```

FK'ler:

```text
foreign key (department_id, academic_unit_id) references departments(id, academic_unit_id) on update cascade on delete restrict
foreign key (discipline_id, department_id, academic_unit_id) references disciplines(id, department_id, academic_unit_id) on update cascade on delete restrict
```

Indexler:

```text
index role_permissions_user_id_idx on role_permissions(user_id)
index role_permissions_academic_unit_id_idx on role_permissions(academic_unit_id)
index role_permissions_department_id_idx on role_permissions(department_id)
index role_permissions_discipline_id_idx on role_permissions(discipline_id)
```

Partial unique indexler:

```text
unique active global role assignment:
unique (user_id, role)
where scope_type = 'GLOBAL' and deleted_at is null

unique active academic unit role assignment:
unique (user_id, role, academic_unit_id)
where scope_type = 'ACADEMIC_UNIT' and deleted_at is null

unique active department role assignment:
unique (user_id, role, department_id)
where scope_type = 'DEPARTMENT' and deleted_at is null

unique active discipline role assignment:
unique (user_id, role, discipline_id)
where scope_type = 'DISCIPLINE' and deleted_at is null
```

Check constraintler:

```text
end_date is null or start_date is null or end_date >= start_date

scope_type = 'GLOBAL' implies academic_unit_id is null and department_id is null and discipline_id is null
scope_type = 'ACADEMIC_UNIT' implies academic_unit_id is not null and department_id is null and discipline_id is null
scope_type = 'DEPARTMENT' implies academic_unit_id is not null and department_id is not null and discipline_id is null
scope_type = 'DISCIPLINE' implies academic_unit_id is not null and department_id is not null and discipline_id is not null
```

Notlar:

- `role` enum yapilmayacak; varchar kalacak. Roller uygulama konfigurasyonu ile genisleyebilir.
- `permissions` icin Postgres `text[]` kullanilabilir. Bu eski modelle uyumludur ve Kysely tarafinda string array olarak kullanimi basittir.
- Permission stringlerinin dogrulugu app/config seviyesinde validate edilmeli.
- `role_permissions` V2'de `user_academic_affiliations` tablosuna baglanmayacak.
- Sebep: affiliation kullanicinin kadro/akademik bagliligidir; role permission ise gorev/yetki atamasidir.
- `position_type` V2'de tutulmayacak. `PRIMARY/SECONDARY` ayrimi akademik affiliation icin anlamli; role permission tarafinda role + scope + tarih araligi yetki baglamini yeterince tanimlar.
- Bir kisinin PRIMARY akademik bagliligi Muhendislik olabilir ama Mimarlik akademik biriminde DEAN rolu olabilir. Bu durumda Mimarlik icin sahte SECONDARY affiliation olusturmak yerine `role_permissions.scope_type = 'ACADEMIC_UNIT'` ve `academic_unit_id = Mimarlik` yazilacak.
- Bir kisi ayni anda RECTOR ve DEAN olabilir; bu iki ayri role permission satiri olarak modellenir.
- Bir kisi ayni anda DEAN ve DEPARTMENT_HEAD olabilir; biri ACADEMIC_UNIT scope, digeri DEPARTMENT scope ile modellenir.

## Index Strategy

- Standalone enum/boolean indexleri ilk migrationda eklenmeyecek.
- Dusuk kardinaliteli kolonlarda (`type`, `academic_field`, `sub_unit_level`, `is_tracked`, `scope_type`) index ancak gercek sorgu plani ihtiyac gosterirse eklenecek.
- `deleted_at` icin standalone index varsayilan olmayacak. Aktif kayit sorgularinda ihtiyac dogarsa ilgili FK veya lookup kolonu ile beraber partial index dusunulecek.
- FK kolonlari icin index tutulacak. Bu hem join/list sorgularini hem de parent hard delete/restrict kontrollerini daha ongorulebilir yapar.
- `role_permissions.role` ve `role_permissions.scope_type` tek basina indexlenmeyecek. Ihtiyac dogarsa aktif kayitlara ozel composite/partial index eklenecek.

## Soft-delete Integrity Policy

- Hard delete icin FK'lerde `on delete restrict` korunacak.
- Soft-delete cascade etmeyecek. Akademik organizasyon master data'sinda otomatik cascade soft-delete riskli kabul edilecek.
- Parent kayit soft-delete edilmeden once aktif child kayit kontrolu yapilacak.
- `academic_units` soft-delete edilirken aktif `departments`, `disciplines`, `user_academic_affiliations` veya `role_permissions` varsa islem engellenecek.
- `departments` soft-delete edilirken aktif `disciplines`, `user_academic_affiliations` veya `role_permissions` varsa islem engellenecek.
- `disciplines` soft-delete edilirken aktif `user_academic_affiliations` veya `role_permissions` varsa islem engellenecek.
- Bu kontroller tek bir servis yolu uzerinden transaction icinde yapilacak. Ileride farkli write path'leri artarsa DB trigger ile de garanti altina alinmasi degerlendirilecek.
- Soft-delete edilmis parent'a yeni aktif child baglanmasi uygulama seviyesinde engellenecek.

## Role Domain Notes

Eski projedeki rol seti:

```text
SUPER_ADMIN
ADMIN
RECTOR
VICE_RECTOR
DEAN
VICE_DEAN
DEPARTMENT_HEAD
VICE_DEPARTMENT
DISCIPLINE_HEAD
VICE_DISCIPLINE
INSTITUTE_HEAD
VICE_INSTITUTE
```

Notlar:

- `ACADEMICIAN` ve `POSTDOC` rol olmayacak. Bunlar `users.user_type` icinde kalacak.
- `DEVELOPER` rol olmayacak. Her seyi yapabilen teknik/yetkili hesap ihtiyaci `SUPER_ADMIN` ve permissionlar ile cozulmeli.
- Impersonation, audit log okuma ve rol yonetimi gibi hassas yetkiler sadece role adina gomulmemeli; permission bazli da kontrol edilebilmeli.
- Onerilen hassas permissionlar:

```text
audit_log:read
impersonation:start
role:manage
permission:manage
```

- Roller migration seviyesinde enum ile kilitlenmemeli. `role` varchar kalmali.

## Query Patterns

### Ust Akademik Birime Gore Bolumler

```sql
select *
from departments
where academic_unit_id = $1
  and deleted_at is null;
```

### Ust Akademik Birime Gore Anabilim Dallari

`disciplines.academic_unit_id` tutuldugu icin join gerekmez:

```sql
select *
from disciplines
where academic_unit_id = $1
  and deleted_at is null;
```

Tutarlilik composite FK ile korundugu icin bu sorgu guvenlidir.

### Kullanici Ana Akademik Bagliligi

```sql
select *
from user_academic_affiliations
where user_id = $1
  and affiliation_type = 'PRIMARY'
  and deleted_at is null;
```

Bu sorgunun en fazla bir kayit donmesi partial unique index ile garanti edilir.

### Kullanici Yetkileri

```sql
select *
from role_permissions
where user_id = $1
  and deleted_at is null
  and (start_date is null or start_date <= now())
  and (end_date is null or end_date >= now());
```

## Data Migration Notes

Eski tablodan V2 tabloya map:

```text
Users.id                         -> users.id
Faculties.id                     -> academic_units.id
Departments.id                   -> departments.id
Disciplines.id                   -> disciplines.id
UserAcademicUnits.id             -> user_academic_affiliations.id
UserAcademicUnits.userId         -> user_academic_affiliations.user_id
UserAcademicUnits.facultyId      -> user_academic_affiliations.academic_unit_id
UserAcademicUnits.departmentId   -> user_academic_affiliations.department_id
UserAcademicUnits.disciplineId   -> user_academic_affiliations.discipline_id
UserAcademicUnits.affiliationType MAIN       -> user_academic_affiliations.affiliation_type PRIMARY
UserAcademicUnits.affiliationType ADDITIONAL -> user_academic_affiliations.affiliation_type SECONDARY
```

Code/name migrationinda:

- Teknik benzersizlik `code` ile saglanacak.
- `academic_units` icin aktif kayitlarda duplicate `code` kontrol edilecek.
- `departments` icin ayni `academic_unit_id` altinda duplicate `code` kontrol edilecek.
- `disciplines` icin ayni `academic_unit_id` altinda duplicate `code` kontrol edilecek.
- Duplicate `code` varsa migration sessizce bir kaydi secmeyecek; rapor uretip duracak veya manuel temizlige yonlendirecek.
- `name` degerleri kullaniciya gosterilecek label olarak tasinacak. Kayit oncesi trim ve fazla bosluk sadelestirme uygulanabilir, ancak `name` icin DB seviyesinde unique kural hedeflenmeyecek.

Discipline migrationinda:

- Eski `Disciplines.departmentId` uzerinden `Departments.facultyId` okunacak.
- V2 `disciplines.academic_unit_id` bu degerle doldurulacak.
- Eski Prisma son durumunda `Disciplines.facultyId` nullable olarak var; veri tasimada esas kaynak yine department'in bagli oldugu ust akademik birim olmali.
- Eger eski `Disciplines.facultyId` ile `Departments.facultyId` celisirse migration raporu hata vermeli; sessizce birini secmemeli.

User affiliation migrationinda:

- `academic_unit_id`, `department_id`, `discipline_id` hiyerarsisi dogrulanmali.
- Bir kullanicida birden fazla aktif PRIMARY kayit varsa migration durmali veya rapora yazilmali.
- Soft-delete edilmis eski affiliation kayitlari V2'ye tasinmayacak.
- Soft-delete edilmis eski kayitlara bagli aktif role/target gibi kayit varsa migration durmali ve rapor uretmeli.

Role permission migrationinda:

- `academicUnitId` dogrudan yeni tabloya tasinmayacak.
- Eski `RolePermissions.academicUnitId` uzerinden ilgili `UserAcademicUnits` kaydi okunacak.
- Role scope kolonlari bu eski affiliation kaydindan doldurulacak:
  - `facultyId -> role_permissions.academic_unit_id`
  - `departmentId -> role_permissions.department_id`
  - `disciplineId -> role_permissions.discipline_id`
- Role scope seviyesi su kurala gore belirlenecek:
  - academic unit dolu, department bos, discipline bos: `ACADEMIC_UNIT`
  - academic unit ve department dolu, discipline bos: `DEPARTMENT`
  - academic unit, department ve discipline dolu: `DISCIPLINE`
  - academicUnitId bos: `GLOBAL`
- `permissions` array aynen korunabilir.
- `role`, `start_date`, `end_date`, timestamp ve soft-delete alanlari korunmali.
- Eski `position_type` V2'ye tasinmayacak.
- Eski `DEVELOPER`, `ACADEMICIAN`, `POSTDOC` role permission kayitlari V2 role setine dogrudan tasinmayacak.

## Implementation Order

1. `npm run db:make create_academic_units_table`
2. `npm run db:make create_departments_table`
3. `npm run db:make create_disciplines_table`
4. `npm run db:make create_user_academic_affiliations_table`
5. `npm run db:make create_role_permissions_table`
6. Migration dosyalarini Kysely schema builder ve gerekli yerlerde `sql` ile tamamla.
7. `npm run db:migrate` ile local DB'ye uygula.
8. `npm run db:codegen` ile `src/database/db.generated.ts` dosyasini yeniden uret.
9. `npm run typecheck` calistir.

## Best Practices

- FK bagimliliklari nedeniyle migration dosyalari yukaridaki sirayla calismali.
- Enumlar sadece domain'i stabil olan alanlarda kullanilmali.
- Rol ve permission degerleri migration enum'una gomulmemeli; uygulama/config seviyesinde yonetilmeli.
- Standalone dusuk-kardinaliteli indexlerden kacinilmali; indexler query pattern ve `EXPLAIN` ihtiyacina gore eklenmeli.
- Soft-delete integrity servis transaction'i ile korunmali; parent soft-delete islemleri aktif child kayit varsa engellenmeli.
- Hiyerarsik tutarlilik sadece servis koduna birakilmamali; FK/check/unique constraintlerle DB seviyesinde korunmali.
- `disciplines.academic_unit_id` denormalizasyonu kullaniliyorsa composite FK zorunlu olmali.
- Partial unique index ile "aktif tek PRIMARY affiliation" kurali DB seviyesinde garanti edilmeli.
- Nullable scope/affiliation kolonlarinda duplicate engeli tek bir composite unique indexe birakilmamali; partial unique indexler tercih edilmeli.
- Akademik organizasyon tablolarinda teknik benzersizlik `code` ile saglanmali; `name` gosterim alani olarak kalmali.
- Migration down fonksiyonlari ters sirayla constraint, index, tablo ve enumlari temizlemeli.
- Codegen sadece migration basariyla calistiktan sonra yapilmali.

## Open Decisions

- `academic_field` deger seti bu proje icin `HEALTH`, `SOCIAL`, `SCIENCE_ENGINEERING` olarak yeterli mi?
