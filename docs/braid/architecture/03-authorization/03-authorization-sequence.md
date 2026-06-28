# Authorization Sequence Diagrams

## Sequence 1: Global permission

```mermaid
sequenceDiagram
  participant Client
  participant Router as Express Router
  participant Auth as requireAuth
  participant Permission as requirePermission
  participant Service as AuthorizationService
  participant Repo as AuthorizationRepository
  participant DB as PostgreSQL
  participant Handler
  participant ErrorHandler as Error Handler

  Client->>Router: HTTP request
  Router->>Auth: run requireAuth()

  alt Unauthenticated
    Auth->>ErrorHandler: next(AppError UNAUTHENTICATED)
    ErrorHandler-->>Client: 401 nested error
  else Authenticated
    Auth->>Permission: next()
    Permission->>Service: authorizePermission(userId, permission)
    Service->>Repo: findActiveGrants(userId, now)
    Repo->>DB: select role_permissions where active
    DB-->>Repo: active grants
    Repo-->>Service: grants

    alt Permission found in union
      Service-->>Permission: allow
      Permission->>Handler: next()
      Handler-->>Client: success response
    else Permission missing
      Service-->>Permission: deny
      Permission->>ErrorHandler: next(AppError FORBIDDEN)
      ErrorHandler-->>Client: 403 nested error
    end
  end
```

### Notlar

- `requireAuth` authentication kararini verir; permission sorgusu yapmaz.
- `requirePermission` scope gerektirmeyen permission kontrolu icindir.
- `rolePermissions.permissions` array'leri union olarak degerlendirilir.
- Repository `deletedAt`, `startDate`, `endDate` filtrelerini uygular.

## Sequence 2: Department scoped permission

```mermaid
sequenceDiagram
  participant Client
  participant Router as Express Router
  participant Scoped as requireScopedPermission
  participant Service as AuthorizationService
  participant Repo as AuthorizationRepository
  participant AcademicRepo as AcademicOrganizationRepository veya repository methodlari
  participant Policy
  participant DB as PostgreSQL
  participant Handler
  participant ErrorHandler as Error Handler

  Client->>Router: HTTP request with department id
  Router->>Scoped: run requireScopedPermission()

  alt Session user id yok
    Scoped->>ErrorHandler: next(AppError UNAUTHENTICATED)
    ErrorHandler-->>Client: 401 nested error
  else Session user id var
    Scoped->>Scoped: resolveTargetId(req)
    Scoped->>Service: authorizeScoped(userId, permission, DEPARTMENT, departmentId)
    Service->>AcademicRepo: resolveDepartmentScopePath(departmentId)
    AcademicRepo->>DB: select departments where id and deleted_at is null
    DB-->>AcademicRepo: department with academic_unit_id
    AcademicRepo-->>Service: { academicUnitId, departmentId }
    Service->>Repo: findActiveGrants(userId, now)
    Repo->>DB: select role_permissions where active
    DB-->>Repo: active grants
    Repo-->>Service: grants
    Service->>Policy: evaluate grants against DEPARTMENT target

    alt GLOBAL, parent ACADEMIC_UNIT veya ayni DEPARTMENT grant var
      Policy-->>Service: allow
      Service-->>Scoped: allow
      Scoped->>Handler: next()
      Handler-->>Client: success response
    else Grant yok
      Policy-->>Service: deny
      Service-->>Scoped: deny
      Scoped->>ErrorHandler: next(AppError FORBIDDEN)
      ErrorHandler-->>Client: 403 nested error
    end
  end
```

### Akış

1. Session user id alinir.
2. Department target id `resolveTargetId(req)` ile cozulur.
3. Parent academic unit id repository uzerinden `departments.academicUnitId` kolonundan bulunur.
4. Aktif grant'ler okunur.
5. Policy `GLOBAL`, parent `ACADEMIC_UNIT` veya ayni `DEPARTMENT` grant kontrolu yapar.
6. Allow ise handler calisir.
7. Deny ise 403 doner.

### Target bulunamama notu (Resolved)

Target bulunamaz veya soft-deleted ise authorization middleware handler'i calistirmadan `FORBIDDEN` 403 doner. "Yok" ve "var ama yetkisiz" ayni 403 ile donerek varlik bilgisini sizdirmaz (enumeration oracle engellenir). Resource existence contract'i gerekiyorsa authz gectikten sonra domain handler/service seviyesinde ele alinir.
