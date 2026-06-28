# Authorization Scope and Policy Flow

## Diyagram 1: Genel authorization kararı

```mermaid
flowchart TD
  REQ[Request]
  AUTH{Session/user var mi?}
  U401["401 UNAUTHENTICATED<br/>Nested Error Contract"]
  PERM[Permission gereksinimi okunur]
  GRANTS["Aktif grant'ler yuklenir<br/>rolePermissions"]
  TARGET{Scoped target gerekli mi?}
  RESOLVE["Target scope ve parent id'ler cozulur<br/>repository"]
  POLICY["Policy degerlendirmesi<br/>permission union + scope matrix"]
  ALLOW{Allow mu?}
  U403["403 FORBIDDEN<br/>Nested Error Contract"]
  HANDLER[Handler'a devam]

  REQ --> AUTH
  AUTH -- "Hayir" --> U401
  AUTH -- "Evet" --> PERM
  PERM --> GRANTS
  GRANTS --> TARGET
  TARGET -- "Evet" --> RESOLVE --> POLICY
  TARGET -- "Hayir" --> POLICY
  POLICY --> ALLOW
  ALLOW -- "Evet" --> HANDLER
  ALLOW -- "Hayir" --> U403
```

### Amaç

Authentication kontrolu ile authorization kararinin ayrildigini ve tum deny akisinin merkezi Error Contract ile dondugunu gosterir.

### Kaynak kararlar

- Session/user yoksa `UNAUTHENTICATED` 401.
- Kullanici var ama grant yoksa `FORBIDDEN` 403.
- Aktif permission kayitlari union olarak degerlendirilir.
- Parent scope id'leri repository uzerinden cozulur.

### Değişmez kurallar

- Middleware dogrudan custom JSON error yazmaz.
- Policy DB bilmez.
- Kysely yalnizca repository katmaninda kullanilir.
- Handler deny durumunda calismaz.

### Acceptance criteria

- AC-1, AC-2, AC-15, AC-16, AC-17.

## Diyagram 2: Scope inheritance

```mermaid
flowchart TD
  TARGET[Target scope]

  AU["Target: ACADEMIC_UNIT"]
  AU_G[Grant: GLOBAL]
  AU_AU["Grant: ayni ACADEMIC_UNIT"]
  AU_ALLOW[Allow]

  DEPT["Target: DEPARTMENT"]
  DEPT_G[Grant: GLOBAL]
  DEPT_AU["Grant: parent ACADEMIC_UNIT"]
  DEPT_DEPT["Grant: ayni DEPARTMENT"]
  DEPT_ALLOW[Allow]

  DISC["Target: DISCIPLINE"]
  DISC_G[Grant: GLOBAL]
  DISC_AU["Grant: parent ACADEMIC_UNIT"]
  DISC_DEPT["Grant: parent DEPARTMENT"]
  DISC_DISC["Grant: ayni DISCIPLINE"]
  DISC_ALLOW[Allow]

  TARGET --> AU
  TARGET --> DEPT
  TARGET --> DISC

  AU --> AU_G --> AU_ALLOW
  AU --> AU_AU --> AU_ALLOW

  DEPT --> DEPT_G --> DEPT_ALLOW
  DEPT --> DEPT_AU --> DEPT_ALLOW
  DEPT --> DEPT_DEPT --> DEPT_ALLOW

  DISC --> DISC_G --> DISC_ALLOW
  DISC --> DISC_AU --> DISC_ALLOW
  DISC --> DISC_DEPT --> DISC_ALLOW
  DISC --> DISC_DISC --> DISC_ALLOW
```

### Amaç

Kesin effective grant matrisini target scope turlerine gore gorsellestirir.

### Kaynak kararlar

- `GLOBAL` grant tum hedeflerde gecerlidir.
- `ACADEMIC_UNIT` grant ayni ust akademik birim ve onun altindaki department/discipline hedeflerinde gecerlidir.
- `DEPARTMENT` grant ayni department ve onun altindaki discipline hedeflerinde gecerlidir.
- `DISCIPLINE` grant yalnizca ayni discipline hedefinde gecerlidir.

### Değişmez kurallar

- Parent scope inheritance bu matris disina cikmaz.
- Deny veya negative permission yoktur.
- Ileride `exactScopeOnly` eklenirse explicit opsiyon olmalidir.

### Acceptance criteria

- AC-4, AC-5, AC-6, AC-7, AC-8, AC-9.

## Diyagram 3: Grant validity

```mermaid
flowchart TD
  GRANT[Grant adayi]
  PERM{Permission string exact match mi?}
  DELETED{deleted_at is null mi?}
  START{start_date yok veya start_date <= now mi?}
  END{end_date yok veya end_date >= now mi?}
  SCOPE{Scope target icin gecerli mi?}
  ACCEPT[Grant kabul edilir]
  REJECT[Grant reddedilir]

  GRANT --> PERM
  PERM -- "Hayir" --> REJECT
  PERM -- "Evet" --> DELETED
  DELETED -- "Hayir" --> REJECT
  DELETED -- "Evet" --> START
  START -- "Hayir" --> REJECT
  START -- "Evet" --> END
  END -- "Hayir" --> REJECT
  END -- "Evet" --> SCOPE
  SCOPE -- "Hayir" --> REJECT
  SCOPE -- "Evet" --> ACCEPT
```

### Amaç

Bir `rolePermissions` satirinin authorization kararinda dikkate alinmasi icin gecmesi gereken filtreleri gosterir.

### Kaynak kararlar

- Permission string exact match kullanilir.
- Silinmis permission kayitlari dikkate alinmaz.
- `start_date` ve `end_date` varsa gecerlilik kontrolu yapilir.
- Scope inheritance kesin matrise gore uygulanir.

### Değişmez kurallar

- Soft-deleted veya tarih disi kayit policy sonucunu allow'a ceviremez.
- Permission wildcard veya role-name hardcode yoktur.
- Aktif grant'ler union olarak degerlendirilir.

### Acceptance criteria

- AC-10, AC-11, AC-12, AC-13, AC-14.
