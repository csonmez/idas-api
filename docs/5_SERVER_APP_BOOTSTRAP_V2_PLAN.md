# Server & App Bootstrap V2 Plani

## Summary

V2'de HTTP uygulamasi iki dosyaya ayrilacak:

- `src/server.ts`: config okuma, DB/Redis baglama, server baslatma ve shutdown.
- `src/app.ts`: Express app ve middleware sirasi.

Bu planin hedefi V1'deki sade bootstrap hissini koruyup sadece gerekli V2 ayrimlarini eklemektir. Gereksiz env yuzeyi, generic timeout helper'lari, configurable API prefix, pre-drain delay ve `main()` wrapper ilk fazda olmayacak.

Auth domain davranislari bu planin kapsami degildir. Login/logout akisi, Passport strategy detaylari, session invalidation, password policy ve endpoint bazli auth rate limit sonraki auth/account planinda ele alinacak. Bu dokuman sadece bootstrap pipeline'da auth/session/CSRF middleware'lerinin nerede baglanacagini tarif eder.

## Target Structure

```text
src/
  app.ts
  server.ts
  config/
    env.ts
  database/
    client.ts
    db.generated.ts
    index.ts
  cache/
    redis.ts
  auth/
    passport.ts
    session.ts
    csrf.ts
  logger/
    index.ts
    http-logger.ts
  security/
    cors.ts
    helmet.ts
    rate-limit.ts
  routes/
    index.ts
  middlewares/
    error.middleware.ts
    not-found.middleware.ts
    request-id.middleware.ts
```

Notlar:

- Ilk fazda path alias kullanilmayacak; relative `.ts` import kullanilacak.
- API route prefix'i sabit `/api` olacak.
- DB pool ayarlari env'den gelmeyecek; `database/client.ts` icinde sabit kalacak.
- Request id header adi, shutdown sureleri, JSON body limitleri ve CORS allowlist kod sabiti olacak.
- Generic promise timeout helper'i `server.ts` veya `app.ts` icine eklenmeyecek.

## Config / Env Validation

`src/config/env.ts` uygulamadaki tek `process.env` okuma ve parse noktasi olacak.

Env'den sadece ortama gore gercekten degisen veya secret olan degerler okunacak.

Ilk faz env'leri:

```text
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://...
REDIS_URL=redis://localhost:6379
SESSION_SECRET=change-me
```

Kararlar:

- Env validation icin mevcut `zod` v4 kullanilacak.
- `AppConfig` tipi Zod schema'sindan `z.infer` ile uretilecek.
- `process.env` feature, middleware, route, DB veya Redis dosyalarinda dogrudan okunmayacak.
- `NODE_ENV` explicit okunacak; `isProduction` kaynagi `NODE_ENV === 'production'` olacak.
- `PORT` numeric parse edilecek.
- Production'da `SESSION_SECRET` guclu ve bos olmayan bir deger olmak zorunda.
- Production secret'lari `.env` dosyasindan degil, runtime env injection / secret manager / orchestrator uzerinden gelecek.
- Local development icin `.env` kullanilabilir.

Kod sabiti olacaklar:

- DB pool degerleri.
- API prefix: `/api`.
- Request id header: `x-request-id`.
- Shutdown hard timeout degerleri.
- CORS allowlist.
- JSON/urlencoded body limitleri.
- `trust proxy` davranisi.

## `server.ts`

`server.ts` uygulamanin process/runtime giris noktasi olacak.

Sorumluluklar:

- Env/config validation'i calistirmak.
- DB client'i config ile olusturmak.
- Redis client'i config ile olusturup connect etmek.
- Startup sirasinda Redis `ping` ve DB `select 1` smoke check yapmak.
- Passport bootstrap hook'unu calistirmak.
- `createApp(...)` ile Express app'i olusturmak.
- `app.listen(...)` ile HTTP server'i baslatmak.
- `SIGINT`, `SIGTERM`, `unhandledRejection`, `uncaughtException` event'lerini ele almak.
- Startup, shutdown ve server error'larini structured logger ile loglamak.

Yapmamasi gerekenler:

- Route tanimlamak.
- Middleware pipeline'i kurmak.
- Auth strategy veya login/logout davranisi yazmak.
- DB/Redis config'i `process.env` icinden okumak.
- Generic promise timeout helper'lari tasimak.
- Gereksiz `main()` wrapper kullanmak.

Onerilen skeleton:

```ts
import { sql } from 'kysely'
import { createApp } from './app.ts'
import { configurePassport } from './auth/passport.ts'
import { createRedisClient } from './cache/redis.ts'
import { readEnv } from './config/env.ts'
import { createDb } from './database/index.ts'
import { flushLogger, logger } from './logger/index.ts'

const FORCE_CLOSE_CONNECTIONS_AFTER_MS = 10_000
const FORCE_EXIT_AFTER_MS = 15_000

const config = readEnv()
const db = createDb(config.databaseUrl)
const redisClient = createRedisClient(config.redisUrl)
let isReady = false
let isShuttingDown = false

try {
	await redisClient.connect()
	await redisClient.ping()
	await sql`select 1`.execute(db)
	configurePassport({ db })
} catch (error) {
	logger.fatal({ error }, 'Server startup failed')
	await Promise.allSettled([redisClient.disconnect(), db.destroy()])
	await flushLogger()
	process.exit(1)
}

const app = createApp({
	config,
	db,
	redisClient,
	isReady: () => isReady
})

const server = app.listen(config.port, () => {
	isReady = true
	logger.info({ port: config.port }, 'Server is running')
})

const shutdown = (reason: string, exitCode = 0) => {
	if (isShuttingDown) {
		logger.warn({ reason }, 'Shutdown already in progress')
		return
	}

	isShuttingDown = true
	isReady = false
	logger.info({ reason }, 'Shutting down')

	const forceCloseTimer = setTimeout(() => {
		logger.warn('Forcing open HTTP connections to close')
		server.closeAllConnections()
	}, FORCE_CLOSE_CONNECTIONS_AFTER_MS)

	forceCloseTimer.unref()

	const forceExitTimer = setTimeout(async () => {
		logger.error('Graceful shutdown timed out')
		await flushLogger()
		process.exit(1)
	}, FORCE_EXIT_AFTER_MS)

	forceExitTimer.unref()

	server.close(async (error) => {
		if (error) {
			logger.error({ error }, 'HTTP server close failed')
			exitCode = 1
		}

		const results = await Promise.allSettled([redisClient.disconnect(), db.destroy()])

		for (const result of results) {
			if (result.status === 'rejected') {
				logger.error({ error: result.reason }, 'Shutdown cleanup failed')
				exitCode = 1
			}
		}

		clearTimeout(forceCloseTimer)
		clearTimeout(forceExitTimer)
		await flushLogger()
		process.exit(exitCode)
	})
}

server.on('error', (error) => {
	logger.fatal({ error }, 'HTTP server error')
	shutdown('serverError', 1)
})

process.on('SIGINT', () => shutdown('SIGINT', 0))
process.on('SIGTERM', () => shutdown('SIGTERM', 0))
process.on('unhandledRejection', (error) => {
	logger.fatal({ error }, 'Unhandled rejection')
	shutdown('unhandledRejection', 1)
})
process.on('uncaughtException', (error) => {
	logger.fatal({ error }, 'Uncaught exception')
	shutdown('uncaughtException', 1)
})
```

Notlar:

- `app.listen(...)` uygundur; Express bu cagriyla bir `http.Server` dondurur.
- `createServer(app)` sadece ekstra server customization gerekiyorsa tercih edilir. Ilk fazda gerek yoktur.
- Top-level `await` Node ESM akisi icin uygundur; `main()` wrapper TypeScript zorunlulugu degildir.
- `delay` / pre-drain ilk fazda yoktur. Shutdown basladiginda `server.close()` hemen yeni connection kabulunu durdurur.
- Hard timeout degerleri kod sabitidir. Degistirmek gerekirse koddan bilincli degistirilir.

## `app.ts`

`app.ts` Express uygulamasini olusturan factory olacak.

Factory kalmasinin nedeni TypeScript degil; DB ve Redis dependency'lerini `server.ts` tarafinda olusturup app'e vermektir. Bu, testlerde fake DB/Redis vermeyi kolaylastirir.

Sorumluluklar:

- Express instance olusturmak.
- Request id, logger, helmet, CORS middleware'lerini eklemek.
- Health endpointlerini eklemek.
- Genel API rate limit'i body parser ve session'dan once eklemek.
- Body parser, cookie parser, session, Passport ve CSRF middleware'lerini siralamak.
- API route'larini sabit `/api` altina mount etmek.
- 404 ve global error handler eklemek.

Yapmamasi gerekenler:

- `app.listen(...)` cagirmak.
- Redis'e connect olmak.
- DB pool olusturmak.
- Process signal handler tanimlamak.
- Auth strategy, login/logout veya token davranisi yazmak.

Onerilen skeleton:

```ts
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { sql, type Kysely } from 'kysely'
import passport from 'passport'
import type { RedisClientType } from 'redis'
import { createCsrfMiddleware } from './auth/csrf.ts'
import { createSessionMiddleware } from './auth/session.ts'
import type { AppConfig } from './config/env.ts'
import type { DB } from './database/index.ts'
import { httpLogger } from './logger/http-logger.ts'
import { errorHandler } from './middlewares/error.middleware.ts'
import { notFoundHandler } from './middlewares/not-found.middleware.ts'
import { requestIdMiddleware } from './middlewares/request-id.middleware.ts'
import { createRoutes } from './routes/index.ts'
import { createCorsMiddleware } from './security/cors.ts'
import { apiRateLimit } from './security/rate-limit.ts'

const JSON_BODY_LIMIT = '1mb'
const URLENCODED_BODY_LIMIT = '100kb'

export type AppDependencies = {
	config: AppConfig
	db: Kysely<DB>
	redisClient: RedisClientType
	isReady: () => boolean
}

const createReadinessHandler = (deps: AppDependencies) => {
	return async (_req: express.Request, res: express.Response) => {
		if (!deps.isReady()) {
			res.status(503).end()
			return
		}

		try {
			await Promise.all([sql`select 1`.execute(deps.db), deps.redisClient.ping()])
			res.status(204).end()
		} catch {
			res.status(503).end()
		}
	}
}

export const createApp = (deps: AppDependencies) => {
	const app = express()

	app.set('trust proxy', deps.config.isProduction ? 1 : false)
	app.disable('x-powered-by')

	app.use(requestIdMiddleware)
	app.use(httpLogger)
	app.use(helmet())
	app.use(createCorsMiddleware())

	app.get('/health/live', (_req, res) => res.status(204).end())
	app.get('/health/ready', createReadinessHandler(deps))

	app.use('/api', apiRateLimit)
	app.use(cookieParser())
	app.use(express.json({ limit: JSON_BODY_LIMIT }))
	app.use(express.urlencoded({ extended: true, limit: URLENCODED_BODY_LIMIT }))
	app.use('/api', createSessionMiddleware(deps))
	app.use('/api', passport.initialize())
	app.use('/api', passport.session())
	app.use('/api', createCsrfMiddleware(deps))
	app.use('/api', createRoutes(deps))

	app.use(notFoundHandler)
	app.use(errorHandler)

	return app
}
```

## Middleware Order

Onerilen siralama:

```text
trust proxy
disable x-powered-by
request id / request context
http request logger
helmet
cors
health routes
api rate limit
cookie parser
json body parser
urlencoded body parser
session
passport.initialize
passport.session
csrf middleware
api routes
not found handler
global error handler
```

Notlar:

- Health endpointleri `/api` disinda kalir ve rate limit/session/Passport/CSRF middleware'lerine girmez.
- Genel API rate limit body parser ve session'dan once calisir.
- Auth-specific rate limit bu bootstrap planinda global middleware degildir; login/forgot-password gibi route'lara auth/account planinda eklenecek.
- `session` Passport session'dan once gelmelidir.
- Error handler en sonda olmalidir.

## CORS

CORS ilk fazda env olmayacak. Allowlist kod icinde duracak.

Onerilen `security/cors.ts` karari:

```ts
import cors from 'cors'

const ALLOWED_ORIGINS = [
	'http://localhost:3000',
	'http://localhost:3001'
]

export const createCorsMiddleware = () => {
	return cors({
		credentials: true,
		origin: (origin, callback) => {
			if (!origin || ALLOWED_ORIGINS.includes(origin)) {
				callback(null, true)
				return
			}

			callback(new Error('Not allowed by CORS'))
		},
		allowedHeaders: ['content-type', 'authorization', 'x-csrf-token', 'x-request-id'],
		exposedHeaders: ['x-request-id']
	})
}
```

Production frontend domain'i belli olunca bu array'e koddan eklenir.

## Database / Kysely

DB client `database/client.ts` icinde factory olarak tutulacak.

Kararlar:

- `database/client.ts` `process.env` okumayacak.
- `server.ts`, `readEnv()` sonrasi `createDb(config.databaseUrl)` cagiracak.
- DB pool degerleri env olmayacak; kod icinde sabit default olarak duracak.
- Feature/service dosyalari kendi pool'unu olusturmayacak.
- Testlerde `createDb(testDatabaseUrl)` kullanilacak.

Onerilen sabitler:

```ts
const DEFAULT_POOL_CONFIG = {
	max: 10,
	idleTimeoutMillis: 30_000,
	connectionTimeoutMillis: 5_000
} satisfies DbPoolConfig
```

## Redis

Redis client `cache/redis.ts` tarafinda factory olarak tutulacak.

Kararlar:

- `cache/redis.ts` `process.env` okumayacak.
- `server.ts`, `createRedisClient(config.redisUrl)` ile client olusturacak.
- `REDIS_URL` tek Redis config olacak.
- Redis startup'ta zorunlu dependency'dir. Connect veya ping basarisizsa app listen etmez.
- Runtime'da Redis sagliksizsa `/health/ready` `503` doner.
- `/health/live` Redis sorununda da process ayaktaysa `204` donebilir.
- Session Redis'e bagli oldugu icin Redis runtime failure durumunda authenticated/session gerektiren endpointler kontrollu `503` donmelidir.
- Rate limit Redis store hata verirse production'da fail-closed davranis tercih edilir; yani request `503` ile reddedilir.

## Session and CSRF

Bu plan cookie tabanli session kullandigi icin CSRF korumasi gerekir.

Kararlar:

- `SESSION_SECRET` env'den gelecek ve production'da zorunlu olacak.
- Cookie/session detaylari `auth/session.ts` icinde merkezi tutulacak.
- Session store Redis-backed olacak.
- `passport.initialize()` ve `passport.session()` route'lardan once baglanacak.
- CSRF middleware'i session ve Passport'tan sonra, API route'larindan once baglanacak.

Bu planda detaylandirilmeyecekler:

- Login/logout route tasarimi.
- CSRF token endpoint'i ve exact token pattern.
- Session fixation korumasi.
- Force logout/session invalidation.
- Password policy ve lockout.

## Health Endpoints

Iki endpoint olacak:

```text
GET /health/live
GET /health/ready
```

`/health/live`:

- Process ayakta mi sorusuna cevap verir.
- DB/Redis kontrolu yapmaz.
- Basariliysa `204 No Content`.

`/health/ready`:

- Trafik almaya hazir mi sorusuna cevap verir.
- `isReady()` false ise `503` doner.
- PostgreSQL `select 1` kontrolu yapar.
- Redis `ping` kontrolu yapar.
- Basariliysa `204 No Content`.
- Basarisizsa `503 Service Unavailable`.

## API Route Prefix

API route'lari ilk fazda sabit `/api` altina mount edilecek.

Kararlar:

- API prefix icin env olmayacak.
- Health endpointleri `/api` disinda kalacak: `/health/live`, `/health/ready`.
- Route aggregator kendi icinde `/api` bilmeyecek; prefix `app.ts` tarafinda uygulanacak.

## Logging

Production'da `console.log` ana logging stratejisi olmayacak.

Kararlar:

- Structured logger kullanilacak.
- Onerilen paketler: `pino` ve `pino-http`.
- Default log level kod sabiti olarak `info` olabilir.
- Her request icin request id uretilecek veya upstream `x-request-id` korunacak.
- Basarili health endpoint access loglari filtrelenecek.
- Hassas alanlar logger seviyesinde redact edilecek.
- Fatal shutdown ve startup failure yollarinda logger flush edilecek.

Redact edilecek alanlar:

```text
req.headers.authorization
req.headers.cookie
req.body.password
req.body.token
req.body.passwordConfirm
req.body.currentPassword
req.body.newPassword
```

## Error Handling

V2 hedefleri:

- Controller'larda try/catch tekrarini azaltmak.
- Express 5'in async route/middleware error forwarding davranisina guvenmek.
- Error response formatini standartlastirmak.
- Bilinmeyen hatalarda detay sizdirmamak.
- Request body icindeki hassas alanlari loglarken maskelemek.

Onerilen response:

```json
{
	"error": "BAD_REQUEST",
	"message": "Validation failed",
	"details": {}
}
```

Notlar:

- Genel amacli `asyncHandler` wrapper ilk fazda yazilmayacak.
- Callback, event emitter, stream veya timer gibi Promise zinciri disindaki hata kaynaklari icin explicit `next(error)` gerekir.
- `uncaughtException` ve `unhandledRejection` HTTP error handler ile cozulmez; `server.ts` fatal shutdown akisini tetikler.

## Rate Limiting

Rate limiting temel bootstrap kapsaminda olacak.

Kararlar:

- `express-rate-limit` kullanilacak.
- Multi-instance production icin Redis store kullanilacak.
- Memory store sadece local development veya tek process test icin kabul edilecek.
- Health endpointleri rate limit disinda kalacak.
- Genel API rate limit body parser ve session'dan once calisacak.
- `OPTIONS` preflight requestleri rate limit sayacina dahil edilmeyecek.
- Auth-specific rate limit bu planin global middleware'i olmayacak; auth/account planinda ilgili endpointlere eklenecek.
- Ilk faz rate limit window/max degerleri kod sabiti olabilir.

## Test Strategy

Bootstrap testleri `createApp(deps)` factory'sinin dis bagimlilik alabilmesi uzerine kurulacak.

Kararlar:

- HTTP davranis testleri icin `node:test` + `supertest` kullanilacak.
- `createApp(deps)` testlerinde DB ve Redis fake dependency olarak verilebilecek.
- Health testleri `isReady`, DB check ve Redis ping basari/basarisizlik davranisini kapsayacak.
- Middleware order smoke testleri health route'larin auth/rate limit disinda kaldigini dogrulayacak.
- Rate limit testleri `OPTIONS` preflight requestlerin sayaca dahil edilmedigini dogrulayacak.
- Error handler testleri Express 5 async handler throw/reject davranisinin global error middleware'e dustugunu dogrulayacak.
- Server lifecycle testleri gerektiginde integration seviyesinde calisacak; `EADDRINUSE`, shutdown idempotency ve readiness false davranisi smoke test olarak tutulacak.

## Explicit Later Scope

Asagidakiler ilk bootstrap kapsaminda zorunlu degildir:

- Auth/account flow detaylari.
- Endpoint-specific auth rate limit.
- Metrics/tracing.
- Compression.
- API versioning.
- Configurable API base path.
- DB pool env override.
- Configurable CORS allowlist.
- Configurable shutdown timing.

## Implementation Order

1. `src/config/env.ts` Zod schema ve `AppConfig` tipiyle eklenecek.
2. `.env.example` sadece `NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` ve local compose ihtiyaclarini icerecek.
3. `compose.dev.yml` icine Redis servisi eklenecek.
4. Gerekli paketler eklenecek:
   - `redis`
   - `connect-redis`
   - `express-session`
   - `cookie-parser`
   - `passport`
   - `pino`
   - `pino-http`
   - `rate-limit-redis`
5. Gerekli type paketleri eklenecek:
   - `@types/express-session`
   - `@types/cookie-parser`
   - `@types/passport`
6. Test paketleri eklenecek:
   - `supertest`
   - `@types/supertest`
7. `database/client.ts` env okumayacak sekilde factory/default pool config yapisina cekilecek.
8. `src/logger/index.ts` ve `src/logger/http-logger.ts` eklenecek.
9. `src/cache/redis.ts` factory olarak eklenecek.
10. `src/security/cors.ts`, `src/security/helmet.ts`, `src/security/rate-limit.ts` eklenecek.
11. `src/auth/session.ts`, `src/auth/csrf.ts`, `src/auth/passport.ts` bootstrap-level factory/hook olarak eklenecek.
12. `src/routes/index.ts` `createRoutes(deps)` factory olarak eklenecek.
13. `src/app.ts` `createApp(deps)` factory olarak eklenecek.
14. `src/server.ts` top-level bootstrap olarak eklenecek.
15. Health endpointleri sade readiness check davranisiyla eklenecek.
16. API route'lari sabit `/api` altina mount edilecek.
17. Error ve not-found middlewareleri eklenecek.
18. Startup Redis connect, Redis `ping` ve DB `select 1` checkleri eklenecek.
19. Graceful shutdown icin idempotency, hard timeout ve `closeAllConnections` akisi eklenecek.
20. `npm run typecheck` ile tipler dogrulanacak.
21. Redis/PostgreSQL ayakta iken local startup test edilecek.
22. Shutdown, EADDRINUSE, readiness, middleware order ve Express 5 async error smoke testleri yapilacak.

## Best Practices

- `app.listen(...)` kullanilabilir; donen server referansi shutdown icin saklanacak.
- `app.ts` test edilebilir ve yan etkisi az bir factory olacak.
- `server.ts` process lifecycle disinda domain davranisi tasimayacak.
- DB pool ayarlari ilk fazda env olmayacak; kod icinde sabit default kalacak.
- Redis connection `app.ts` icinde baslatilmayacak.
- DB pool `app.ts` icinde olusturulmayacak.
- Auth strategy ve route davranislari `app.ts` icinde inline yazilmayacak.
- DB ve Redis shutdown sirasi kontrollu olacak.
- Shutdown idempotent olacak ve hard timeout icerecek.
- Startup Redis connect, Redis ping ve DB connectivity check gecmeden HTTP listen edilmeyecek.
- Env validation Zod ile uygulama basinda fail-fast davranacak.
- Production secret'lari `.env` dosyasindan degil runtime env injection ile gelecektir.
- API route'lari sabit `/api` altina mount edilecek.
- Production CORS wildcard olmayacak.
- Logger structured olacak.
- Health probe basarili access loglari filtrelenecek.
- Genel API rate limit body parser/session'dan once calisacak.
- Feature service dosyalari HTTP server, process signal veya Redis client lifecycle bilmeyecek.
- Express 5 async handler forwarding'e guvenilecek; genel `asyncHandler` wrapper yazilmayacak.

## Resolved Decisions

- Request id middleware'i ilk fazda eklenecek.
- Request id header kod sabiti olarak `x-request-id` olacak.
- `app.listen(...)` kullanilacak; `createServer(app)` ilk fazda gerekli degil.
- `main()` wrapper kullanilmayacak; top-level bootstrap tercih edilecek.
- Shutdown pre-drain/delay olmayacak.
- Shutdown hard timeout degerleri kod sabiti olacak.
- Production rate limit Redis store kullanacak.
- `OPTIONS` preflight requestleri rate limit sayacina dahil edilmeyecek.
- Generic promise timeout helper'i bootstrap planindan cikarildi.
- DB pool env override ilk fazda olmayacak.
- CORS allowlist ilk fazda kod sabiti olacak.
- API base path configurable olmayacak; sabit `/api` kullanilacak.
- Startup Redis connect, Redis ping ve DB check listen oncesi calisacak.
- Graceful shutdown hard timeout ve idempotency guard icerecek.
- Env validation Zod v4 ile yapilacak.
- Production secret'lari `.env` dosyasindan degil env injection uzerinden gelecek.
- Path alias ilk fazda kullanilmayacak; relative `.ts` import tercih edilecek.
- Express 5 async error forwarding'e guvenilecek.
- Cookie session kullanildigi icin CSRF middleware'i bootstrap pipeline'da yer alacak.

## Verification Checklist

- Env parse hatalari Zod validation ile uygulama basinda yakalanir.
- Production `SESSION_SECRET` eksik veya zayifsa startup fail eder.
- Production start akisi secret'lari `.env` varsayimi olmadan env injection ile okuyabilir.
- `DATABASE_URL` yanlisken app listen etmeden `exit(1)` ile kapanir.
- Redis kapaliyken app listen etmeden `exit(1)` ile kapanir.
- Port doluyken `EADDRINUSE` structured loglanir ve process `exit(1)` yapar.
- `SIGTERM` geldiginde readiness hemen `503` doner.
- `SIGTERM` sonrasi HTTP server yeni connection kabul etmez.
- Keep-alive connection acikken shutdown hard timeout calisir.
- Iki kez `SIGINT` geldiginde cleanup ikinci kez calismaz.
- Fatal exit yollarinda logger flush cagrilir.
- `unhandledRejection` ve `uncaughtException` fatal shutdown tetikler.
- `/health/live` DB/Redis kapali olsa bile process ayaktaysa cevap verebilir.
- `/health/ready` DB veya Redis sorununda `503` doner.
- Basarili `/health/*` probe'lari HTTP access log noise uretmez.
- HTTP loglarinda request id `x-request-id` ile iliskilidir.
- API route'lari `/api` altinda calisir.
- Health endpointleri rate limit'e takilmaz.
- `OPTIONS` preflight requestleri rate limit sayacina dahil edilmez.
- Express 5 async route handler icinde throw/reject edilen hata global error handler'a duser.
- Structured loglarda `authorization`, `cookie`, `password` ve `token` alanlari maskelenir.

## References

- Node.js HTTP server lifecycle ve `server.closeAllConnections()`.
- Express 5 async error forwarding ve error handling davranisi.
- Zod env validation ve transform davranisi.
- Express session middleware pipeline.
- connect-redis guncel RedisStore API'si.
- express-rate-limit v8 store API'si ve rate-limit-redis uyumu.
- pino-http request id ve autoLogging configuration.
