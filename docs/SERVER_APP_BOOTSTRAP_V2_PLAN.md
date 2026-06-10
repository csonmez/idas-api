# Server & App Bootstrap V2 Plani

## Summary

V2'de HTTP uygulamasi iki ana sorumluluga ayrilacak:

- `src/server.ts`: runtime/process bootstrap.
- `src/app.ts`: saf Express app factory ve middleware pipeline.

Bu planin kapsami uygulamanin nasil baslatilacagi, middleware pipeline'in nasil kurulacagi, dis kaynak lifecycle'inin nasil yonetilecegi ve process shutdown davranisidir.

Auth domain davranislari bu planin kapsami degildir. Login/logout akisi, Passport strategy detaylari, session fixation korumasi, kullanici invalidation, password policy, CSRF token stratejisi ve benzeri auth kararlar sonraki auth/account planinda ele alinacak. Bu dokuman sadece auth middleware'lerinin bootstrap pipeline'da nerede baglanacagini tarif eder.

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

- Dosya adlari ileride feature klasor yapisina gore degisebilir; temel prensip sorumluluk ayrimidir.
- `database` katmani mevcut `docs/DATABASE_STRUCTURE_PLAN.md` kararlarini takip edecek.
- `cache/redis.ts` Redis client lifecycle'inin tek sahibi olacak.
- `auth/*` dosyalari bu bootstrap planinda sadece middleware/config hook'lari olarak ele alinacak.
- `logger` katmani structured logger ve HTTP request logging sorumlulugunu tasiyacak.
- `security` katmani CORS, helmet ve rate limit factory'lerini tutacak.
- Ilk fazda path alias kullanilmayacak; mevcut `rewriteRelativeImportExtensions` kararina uygun olarak relative `.ts` import kullanilacak.

## Config / Env Validation

`src/config/env.ts` uygulamadaki tek env okuma ve parse noktasi olacak.

Kararlar:

- Env validation icin mevcut `zod` v4 kullanilacak.
- `AppConfig` tipi Zod schema'sindan `z.infer` ile uretilecek.
- `process.env` dogrudan feature, middleware veya route dosyalarinda okunmayacak.
- `NODE_ENV` explicit okunacak; `isProduction` kaynagi `NODE_ENV === 'production'` olacak.
- `PORT`, `*_MS`, `RATE_LIMIT_MAX` gibi numerik degerler `z.coerce.number()` ile parse edilecek.
- Boolean env'ler icin `z.coerce.boolean()` kullanilmayacak; `"true"` / `"false"` string transform'u explicit yazilacak.
- `CORS_ORIGINS` gibi comma-separated env'ler `split(',')`, `trim()` ve bos deger filtreleme transform'u ile parse edilecek.
- `TRUST_PROXY=1` string olarak Express'e verilmeyecek; `env.ts` bu degeri number `1` olarak normalize edecek.
- `TRUST_PROXY` icin desteklenen degerler explicit olacak: number hop count, `true`, `false`, `loopback` gibi Express preset'leri.
- Production secret'lari `.env` dosyasindan degil, orchestrator / process env injection uzerinden gelecek. `.env` local development icindir.
- `API_BASE_PATH` default `/api` olacak; ilk fazda URL path uzerinden versioning yapilmayacak.
- Config invariant'lari Zod `.refine()` ile dogrulanacak.

Onerilen invariant'lar:

- `SHUTDOWN_CLOSE_CONNECTIONS_AFTER_MS < SHUTDOWN_TIMEOUT_MS`
- `READINESS_CHECK_TIMEOUT_MS <= STARTUP_CHECK_TIMEOUT_MS`

Onerilen env'ler:

```text
NODE_ENV=development
PORT=3000
API_BASE_PATH=/api
TRUST_PROXY=1
STARTUP_CHECK_TIMEOUT_MS=2000
READINESS_CHECK_TIMEOUT_MS=1000
READINESS_CACHE_TTL_MS=1000
SHUTDOWN_PREDRAIN_MS=3000
SHUTDOWN_CLOSE_CONNECTIONS_AFTER_MS=10000
SHUTDOWN_TIMEOUT_MS=15000
```

## `server.ts`

`server.ts` uygulamanin process/runtime giris noktasi olacak.

Sorumluluklar:

- Zod tabanli env/config validation'i calistirmak.
- PostgreSQL/Kysely singleton client'i import etmek.
- Startup sirasinda DB connectivity check yapmak.
- Redis client'i connect etmek.
- Startup sirasinda Redis connectivity check yapmak.
- Auth/Passport bootstrap hook'unu calistirmak.
- `createApp(...)` ile Express app'i olusturmak.
- HTTP server'i baslatmak.
- Graceful shutdown akisini yonetmek.
- `SIGINT`, `SIGTERM`, `unhandledRejection`, `uncaughtException` gibi process event'lerini ele almak.
- Startup ve runtime server error'larini structured logger ile loglamak.

Yapmamasi gerekenler:

- Route tanimlamak.
- Feature/service importlarini daginik sekilde toplamak.
- Middleware pipeline'i kurmak.
- Auth strategy veya login/logout davranisi yazmak.
- Redis session store detaylarini inline yazmak.

Onerilen skeleton:

```ts
import { createServer } from 'node:http'
import { sql } from 'kysely'
import { createApp } from './app.ts'
import { db, closeDb } from './database/index.ts'
import { connectRedis, disconnectRedis, redisClient } from './cache/redis.ts'
import { configurePassport } from './auth/passport.ts'
import { readEnv } from './config/env.ts'
import { logger, flushLogger } from './logger/index.ts'

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, label: string) =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`${label} timed out`))
		}, timeoutMs)

		promise.then(resolve, reject).finally(() => clearTimeout(timer))
	})

const delay = (durationMs: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, durationMs)
	})

const main = async () => {
	const config = readEnv()
	let isReady = false
	let isShuttingDown = false

	await withTimeout(connectRedis(), config.startupCheckTimeoutMs, 'Redis connect')
	await withTimeout(redisClient.ping(), config.startupCheckTimeoutMs, 'Redis startup check')
	await withTimeout(sql`select 1`.execute(db), config.startupCheckTimeoutMs, 'DB startup check')
	configurePassport({ db })

	const app = createApp({
		config,
		db,
		redisClient,
		isReady: () => isReady
	})

	const server = createServer(app)

	const closeHttpServer = () =>
		new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) {
					reject(error)
					return
				}

				resolve()
			})
		})

	const shutdown = async (reason: string, exitCode = 0) => {
		if (isShuttingDown) {
			logger.warn({ reason }, 'Shutdown already in progress')
			return
		}

		isShuttingDown = true
		isReady = false

		logger.info({ reason }, 'Shutting down')

		if (config.shutdownPredrainMs > 0) {
			await delay(config.shutdownPredrainMs)
		}

		const closeConnectionsTimer = setTimeout(() => {
			logger.warn('Forcing open HTTP connections to close')
			server.closeAllConnections?.()
		}, config.shutdownCloseConnectionsAfterMs)

		closeConnectionsTimer.unref()

		const forceExitTimer = setTimeout(async () => {
			logger.error('Graceful shutdown timed out')
			await flushLogger()
			process.exit(1)
		}, config.shutdownTimeoutMs)

		forceExitTimer.unref()

		try {
			await closeHttpServer()
		} catch (error) {
			logger.error({ error }, 'HTTP server close failed')
			exitCode = 1
		} finally {
			const results = await Promise.allSettled([disconnectRedis(), closeDb()])

			for (const result of results) {
				if (result.status === 'rejected') {
					logger.error({ error: result.reason }, 'Shutdown cleanup failed')
					exitCode = 1
				}
			}

			clearTimeout(closeConnectionsTimer)
			clearTimeout(forceExitTimer)
		}

		await flushLogger()
		process.exit(exitCode)
	}

	process.on('SIGINT', () => void shutdown('SIGINT', 0))
	process.on('SIGTERM', () => void shutdown('SIGTERM', 0))
	process.on('unhandledRejection', (error) => {
		logger.fatal({ error }, 'Unhandled rejection')
		void shutdown('unhandledRejection', 1)
	})
	process.on('uncaughtException', (error) => {
		logger.fatal({ error }, 'Uncaught exception')
		void shutdown('uncaughtException', 1)
	})

	await new Promise<void>((resolve, reject) => {
		const onError = (error: NodeJS.ErrnoException) => {
			reject(error)
		}

		server.once('error', onError)
		server.listen(config.port, () => {
			server.off('error', onError)
			resolve()
		})
	})

	server.on('error', (error) => {
		logger.error({ error }, 'HTTP server error')
	})

	isReady = true
	logger.info({ port: config.port }, 'Server is running')
}

main().catch(async (error) => {
	logger.fatal({ error }, 'Server startup failed')
	await Promise.allSettled([disconnectRedis(), closeDb()])
	await flushLogger()
	process.exit(1)
})
```

Notlar:

- `server.close()` yeni request kabulunu durdurur, mevcut requestlerin bitmesine izin verir.
- Shutdown basladiginda readiness false olacak.
- Kubernetes/load balancer ortaminda readiness false olduktan sonra opsiyonel kisa pre-drain beklemesi uygulanacak.
- Shutdown sirasinda once HTTP server kapatilacak, sonra Redis ve DB connection'lari kapatilacak.
- Shutdown idempotent olacak; iki signal geldiginde cleanup iki kez calismayacak.
- Shutdown icin maksimum bekleme timeout'u olacak.
- `server.closeAllConnections()` hemen degil, once mevcut requestlerin bitmesine izin verecek kisa bir beklemeden sonra cagrilacak.
- `server.closeAllConnections()` Node 18.2+ ile kullanilabilir; optional chaining runtime uyumu icin korunacak.
- Startup Redis connect, Redis ping ve DB checkleri timeout'suz calismayacak; dependency asili kalirsa uygulama listen etmeden fail-fast kapanacak.
- Fatal shutdown ve startup failure yollarinda `process.exit()` oncesi logger flush edilecek.
- `uncaughtException` sonrasinda process sagliksiz kabul edilir. Ilk tercih kisa timeout'lu best-effort shutdown ve process manager restart'idir.
- Startup sirasinda `server.listen` hata verirse uygulama `exit(1)` ile kapanacak.
- `EADDRINUSE` gibi port hatalari sessiz kalmayacak.
- Normal signal shutdown `exit(0)`, fatal hata ve cleanup hatasi `exit(1)` ile bitecek.

## `app.ts`

`app.ts` Express uygulamasini olusturan saf factory olacak.

Sorumluluklar:

- Express instance olusturmak.
- Security middleware'lerini eklemek.
- CORS ayarlarini eklemek.
- Body parser ve cookie parser eklemek.
- Session middleware'ini eklemek.
- Passport initialize/session middleware'lerini eklemek.
- CSRF middleware'ini auth modulunun sagladigi factory uzerinden baglamak.
- Rate limit middleware'lerini eklemek.
- HTTP request logger'i eklemek.
- Health endpointlerini eklemek.
- API route'larini mount etmek.
- 404 ve global error handler eklemek.

Yapmamasi gerekenler:

- `app.listen(...)` cagirmak.
- Redis'e connect olmak.
- DB pool olusturmak.
- Process signal handler tanimlamak.
- Auth strategy, login/logout veya token davranisi yazmak.

Onerilen skeleton:

```ts
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import passport from 'passport'
import { sql, type Kysely } from 'kysely'
import type { RedisClientType } from 'redis'
import routes from './routes/index.ts'
import { createSessionMiddleware } from './auth/session.ts'
import { createCsrfMiddleware } from './auth/csrf.ts'
import { errorHandler } from './middlewares/error.middleware.ts'
import { notFoundHandler } from './middlewares/not-found.middleware.ts'
import { requestIdMiddleware } from './middlewares/request-id.middleware.ts'
import { httpLogger } from './logger/http-logger.ts'
import { apiRateLimit, authRateLimit } from './security/rate-limit.ts'
import type { DB } from './database/index.ts'
import type { AppConfig } from './config/env.ts'

export type AppDependencies = {
	config: AppConfig
	db: Kysely<DB>
	redisClient: RedisClientType
	isReady: () => boolean
}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, label: string) =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`${label} timed out`))
		}, timeoutMs)

		promise.then(resolve, reject).finally(() => clearTimeout(timer))
	})

const createReadinessHandler = (deps: AppDependencies) => {
	let cachedResult: { expiresAt: number; isHealthy: boolean } | null = null

	return async (_req: express.Request, res: express.Response) => {
		if (!deps.isReady()) {
			res.status(503).end()
			return
		}

		const now = Date.now()

		if (cachedResult && cachedResult.expiresAt > now) {
			res.status(cachedResult.isHealthy ? 204 : 503).end()
			return
		}

		const results = await Promise.allSettled([
			withTimeout(sql`select 1`.execute(deps.db), deps.config.readinessCheckTimeoutMs, 'DB readiness check'),
			withTimeout(deps.redisClient.ping(), deps.config.readinessCheckTimeoutMs, 'Redis readiness check')
		])

		const isHealthy = results.every((result) => result.status === 'fulfilled')
		cachedResult = {
			expiresAt: now + deps.config.readinessCacheTtlMs,
			isHealthy
		}

		res.status(isHealthy ? 204 : 503).end()
	}
}

export const createApp = (deps: AppDependencies) => {
	const app = express()
	const apiBasePath = deps.config.apiBasePath

	app.set('trust proxy', deps.config.trustProxy)
	app.disable('x-powered-by')

	app.use(requestIdMiddleware)
	app.use(httpLogger)
	app.use(helmet(deps.config.helmet))
	app.use(cors(deps.config.cors))
	app.use(cookieParser())
	app.use(express.json({ limit: deps.config.jsonLimit }))
	app.use(express.urlencoded({ extended: true }))

	app.get('/health/live', (_req, res) => res.status(204).end())
	app.get('/health/ready', createReadinessHandler(deps))

	app.use(apiBasePath, authRateLimit)
	app.use(apiBasePath, apiRateLimit)
	app.use(apiBasePath, createSessionMiddleware(deps))
	app.use(apiBasePath, passport.initialize())
	app.use(apiBasePath, passport.session())
	app.use(apiBasePath, createCsrfMiddleware(deps))
	app.use(apiBasePath, routes)

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
cookie parser
json body parser
urlencoded body parser
health routes
auth rate limit
api rate limit
session
passport.initialize
passport.session
csrf middleware
api routes
not found handler
global error handler
```

Notlar:

- `session` Passport session'dan once gelmeli.
- `passport.initialize()` ve `passport.session()` route'lardan once gelmeli.
- Error handler en sonda olmali.
- 404 handler API route'lardan sonra, global error handler'dan once gelmeli.
- Health endpointleri rate limit ve auth middleware'lerinin disinda kalmali.
- Rate limit session/Passport'tan once calisarak pahali auth middleware maliyetini azaltmali.
- API route'lari ilk fazda `/api` altina mount edilmeli; URL path uzerinden versioning yapilmayacak.
- Auth-specific route istisnalari bu bootstrap planinda tanimlanmayacak; auth modulunun middleware factory'leri kendi ic kararlarini uygulayacak.

## Redis

Redis lifecycle `cache/redis.ts` tarafindan yonetilecek.

Sorumluluklar:

- Tek bir Redis client singleton veya controlled factory olusturmak.
- `connectRedis()` ve `disconnectRedis()` fonksiyonlari saglamak.
- Redis eventlerini loglamak: `connect`, `ready`, `error`, `end`, `reconnecting`.
- Startup ve readiness checkleri icin `ping` desteklemek.

Onerilen env'ler:

```text
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TLS=false
```

Kararlar:

- Mumkunse `REDIS_URL` birincil config olsun.
- Host/port/password degerleri `REDIS_URL` yoksa fallback olarak kullanilsin.
- `redis` client major versiyonu pinlenecek; `createClient`, `connect`, `disconnect` ve `ping` API davranisi bu major'a gore test edilecek.
- Redis sagliksizsa `/health/ready` `503` donerek load balancer/k8s tarafindan trafikten cikarilmayi saglar.

## PostgreSQL / Kysely

DB client lifecycle `database/client.ts` tarafinda olacak.

`server.ts` DB ile ilgili sadece sunlari bilmeli:

- `db` uygulama singleton'idir.
- `closeDb()` graceful shutdown'da cagirilir.

Notlar:

- Feature/service dosyalari kendi pool'unu olusturmayacak.
- Testlerde singleton yerine `createDb(TEST_DATABASE_URL)` tercih edilecek.
- DB baglanti hatasi uygulama startup'inda erken fark edilmeli.
- `server.ts` icinde timeout'lu `sql\`select 1\`.execute(db)` ile fail-fast check yapilacak.
- DB startup check gecmeden HTTP server listen etmeyecek.
- Production pool ayarlari `database/client.ts` tarafinda env'den okunacak.
- Managed PostgreSQL kullaniminda SSL/sslmode config'i desteklenecek.

Onerilen env'ler:

```text
DATABASE_URL=postgres://...
PG_POOL_MAX=10
PG_IDLE_TIMEOUT_MS=30000
PG_CONNECTION_TIMEOUT_MS=2000
PG_STATEMENT_TIMEOUT_MS=30000
PG_SSL=false
```

## Health Endpoints

Iki endpoint onerilir:

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
- PostgreSQL `select 1` kontrolu yapar.
- Redis `ping` kontrolu yapar.
- Basariliysa `204 No Content`.
- Basarisizsa `503 Service Unavailable`.
- Shutdown basladiginda readiness false doner.
- Health endpointleri session, Passport ve rate limit disinda kalir.
- DB `select 1` ve Redis `ping` checkleri kisa timeout ile calisir.
- Readiness sonucu cok kisa TTL ile cache'lenebilir; probe trafigi DB/Redis'i gereksiz yormaz.

## API Base Path

Ilk fazda URL path uzerinden versioning yapilmayacak.

Kararlar:

- API base path default `/api` olacak.
- `API_BASE_PATH` env'i ile merkezi olarak degistirilebilir.
- Health endpointleri API base path disinda kalacak: `/health/live`, `/health/ready`.
- Route aggregator `src/routes/index.ts` kendi icinde `/api` bilmeyecek; base path `app.ts` tarafinda uygulanacak.

## Logging

Production'da `console.log` ana logging stratejisi olmayacak.

Kararlar:

- Structured logger kullanilacak.
- Onerilen paketler: `pino` ve `pino-http`.
- Tum startup, shutdown, health failure, server error ve unexpected error loglari structured olacak.
- Her request icin request id uretilecek veya upstream request id korunacak.
- HTTP access loglari request id ile iliskilendirilecek.
- `requestIdMiddleware` ve `pino-http` ayni correlation id'yi kullanacak.
- `pino-http` `genReqId` icinde `req.id` degerini kullanacak; ikinci bir request id uretmeyecek.
- `pino-http` `customLogLevel` ile 5xx `error`, 4xx `warn`, digerleri `info` seviyesinde loglayacak.
- Basarili health endpoint access loglari `pino-http` `autoLogging.ignore` ile filtrelenecek.
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

Onerilen env'ler:

```text
LOG_LEVEL=info
LOG_PRETTY=false
REQUEST_ID_HEADER=x-request-id
```

## Error Handling

V2 icin hedef:

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

- Express 5 async handler'lardan donen rejected Promise veya throw edilen hatalari error middleware'e iletir.
- Genel amacli `asyncHandler` wrapper ilk fazda yazilmayacak; Express 4 refleksi olarak boilerplate uretilmeyecek.
- Callback, event emitter, stream veya timer gibi Promise zinciri disindaki hata kaynaklari icin `next(error)` veya explicit error propagation kullanilacak.
- Error handler structured logger kullanacak.
- `res.headersSent` durumunda Express default error akisi dikkate alinacak.
- `uncaughtException` ve `unhandledRejection` HTTP error handler ile cozulmeyecek; `server.ts` fatal shutdown akisini tetikleyecek.

## CORS

Production'da allowlist kullanilacak.

Onerilen env:

```text
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
CORS_ALLOWED_HEADERS=content-type,authorization,x-csrf-token,x-request-id
CORS_EXPOSED_HEADERS=x-request-id
```

Kararlar:

- Development'ta origin esnek olabilir.
- Production'da bilinmeyen origin'e izin verilmeyecek.
- `credentials: true` kullanilacagi icin wildcard origin (`*`) kullanilmayacak.
- Allowed origins config parse edilirken bos stringler filtrelenecek.
- Auth/CSRF modulunun kullandigi custom header'lar CORS allowed headers icinde yer alacak.
- Response uzerinden okunmasi gereken custom header'lar `exposedHeaders` icinde yer alacak.

## Trust Proxy

`trust proxy` cookie security, IP tespiti, audit log ve rate limit icin kritik ayardir.

Kararlar:

- Bu projede standart production topolojisi tek reverse proxy/load balancer arkasi kabul ediliyorsa default deger number `1` olabilir.
- Default development degeri `false` veya `loopback` olabilir.
- Reverse proxy/load balancer arkasinda production degeri bilincli set edilecek.
- `TRUST_PROXY=1` env'den string geldigi icin `env.ts` bunu number `1` olarak parse edecek.
- `app.set('trust proxy', '1')` yapilmayacak; Express string degeri hop count degil IP/subnet/preset listesi gibi yorumlayabilir.
- Yanlis `trust proxy` ayari `secure` cookie, `req.ip` ve rate limit davranisini bozabilir.

Onerilen env:

```text
TRUST_PROXY=1
```

## Security Headers

Helmet kullanilacak; ancak proje saf JSON API oldugu surece V1'deki ozel CSP direktifleri varsayilan olarak tasinmayacak.

Kararlar:

- Ilk fazda sade `helmet()` veya merkezi `createHelmetMiddleware(config)` kullanilacak.
- CSP ancak API HTML/static asset serve etmeye baslarsa ayrica tasarlanacak.
- `crossOriginResourcePolicy` gibi ayarlar frontend ihtiyacina gore bilincli degistirilecek.

## Rate Limiting

Rate limiting temel bootstrap kapsaminda olacak.

Kararlar:

- `express-rate-limit` kullanilacak.
- Multi-instance production icin Redis store kullanilacak.
- Memory store sadece local development veya tek process test icin kabul edilecek.
- `trust proxy` dogru ayarlanmadan IP bazli rate limit production'da guvenilir kabul edilmeyecek.
- Health endpointleri rate limit disinda kalacak.
- Genel API rate limit session/Passport'tan once calisacak.
- Auth-specific veya endpoint-specific rate limit detaylari auth/account planinda ele alinacak.
- `express-rate-limit` v8 store API'si ile uyumlu `rate-limit-redis` major versiyonu pinlenecek.
- Redis store davranisi redis client major versiyonuyla birlikte smoke test edilecek.
- `OPTIONS` preflight requestleri rate limit sayacina dahil edilmeyecek.
- IPv6 icin custom `keyGenerator` yazilirsa `express-rate-limit` v8 `ipKeyGenerator` helper'i kullanilacak.
- `trust proxy` yanlis parse edilirse `express-rate-limit` v8 validation uyarilari/hatalari ciddiye alinacak.

Onerilen paket:

```text
rate-limit-redis
```

Onerilen env'ler:

```text
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=300
```

## Auth Boundary

Bu dokumanda auth sadece bootstrap baglanti noktasi olarak ele alinir.

Bu planda kalacaklar:

- `configurePassport({ db })` gibi auth bootstrap hook'unun `server.ts` icinden cagrilmasi.
- `createSessionMiddleware(deps)`, `passport.initialize()`, `passport.session()` ve `createCsrfMiddleware(deps)` middleware'lerinin `app.ts` icinde siralanmasi.
- Auth middleware'lerinin health endpointlerinden sonra ve API route'larindan once mount edilmesi.

Bu planda ele alinmayacaklar:

- Login/logout route tasarimi.
- Session fixation korumasi.
- Passport LocalStrategy akisi.
- Serialize/deserialize davranisi.
- Session invalidation ve force logout.
- CSRF token pattern ve endpoint istisnalari.
- Password verify, lockout, dummy hash veya user enumeration savunmalari.

## Test Strategy

Bootstrap testleri `createApp(deps)` factory'sinin dis bagimlilik alabilmesi uzerine kurulacak.

Kararlar:

- HTTP davranis testleri icin `node:test` + `supertest` kullanilacak.
- `createApp(deps)` testlerinde DB ve Redis mock/fake dependency olarak verilebilecek.
- Health testleri DB `select 1`, Redis `ping`, timeout ve readiness cache davranisini kapsayacak.
- Middleware order smoke testleri health route'larin auth/rate limit disinda kaldigini dogrulayacak.
- Rate limit testleri `OPTIONS` preflight requestlerin sayaca dahil edilmedigini dogrulayacak.
- Error handler testleri Express 5 async handler throw/reject davranisinin global error middleware'e dustugunu dogrulayacak.
- Server lifecycle testleri gerektiginde integration seviyesinde calisacak; `EADDRINUSE`, shutdown idempotency ve readiness false davranisi smoke test olarak tutulacak.

## Explicit Later Scope

Asagidakiler ilk bootstrap kapsaminda zorunlu degildir; karar bilincli olarak sonraki faza birakilir.

- Auth/account flow detaylari.
- Metrics/tracing: Prometheus veya OpenTelemetry entegrasyonu sonraki observability fazinda tasarlanacak.
- Compression: JSON API icin reverse proxy tarafinda mi yoksa `compression` middleware'i ile uygulama tarafinda mi yapilacagi deploy topolojisine gore ayrica kararlastirilacak.

## Implementation Order

1. `src/config/env.ts` Zod schema ve `AppConfig` tipiyle eklenecek.
2. `.env.example` Redis, CORS, API base path, readiness, shutdown, DB pool ve server env'leriyle guncellenecek.
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
7. `redis`, `connect-redis` ve `rate-limit-redis` major versiyonlari ve kullanilacak API'leri pinlenecek.
8. `src/logger/index.ts` ve `src/logger/http-logger.ts` eklenecek.
9. `src/cache/redis.ts` eklenecek.
10. `src/security/cors.ts`, `src/security/helmet.ts`, `src/security/rate-limit.ts` eklenecek.
11. `src/auth/session.ts`, `src/auth/csrf.ts`, `src/auth/passport.ts` bootstrap-level factory/hook olarak eklenecek.
12. `src/app.ts` `createApp(deps)` factory olarak eklenecek.
13. `src/server.ts` runtime bootstrap olarak eklenecek.
14. `src/routes/index.ts` minimum route aggregator olarak eklenecek.
15. Health endpointleri timeout ve kisa cache davranisiyla eklenecek.
16. API route'lari `/api` altina mount edilecek.
17. Error ve not-found middlewareleri eklenecek.
18. Startup Redis connect, Redis `ping` ve DB `select 1` checkleri timeout ile eklenecek.
19. Graceful shutdown icin idempotency, pre-drain, force timeout ve `closeAllConnections` akisi eklenecek.
20. `npm run typecheck` ile tipler dogrulanacak.
21. Redis/PostgreSQL ayakta iken local startup test edilecek.
22. Shutdown, EADDRINUSE, readiness, middleware order ve Express 5 async error smoke testleri yapilacak.

## Best Practices

- `app.ts` test edilebilir ve yan etkisi az bir factory olacak.
- `server.ts` process lifecycle disinda domain davranisi tasimayacak.
- Relative `.ts` import kullanilacak; ilk fazda tsconfig path alias eklenmeyecek.
- `TRUST_PROXY=1` string olarak Express'e verilmeyecek; config number `1` uretmeli.
- Redis connection `app.ts` icinde baslatilmayacak.
- DB pool `app.ts` icinde olusturulmayacak.
- Auth strategy ve route davranislari `app.ts` icinde inline yazilmayacak.
- DB ve Redis shutdown sirasi kontrollu olacak.
- Graceful shutdown idempotent olacak ve hard timeout icerecek.
- Shutdown sirasinda readiness false olduktan sonra opsiyonel pre-drain beklemesi desteklenecek.
- Startup Redis connect, Redis ping ve DB connectivity check gecmeden HTTP listen edilmeyecek.
- Env validation Zod ile uygulama basinda fail-fast davranacak.
- Production secret'lari `.env` dosyasindan degil runtime env injection ile gelecektir.
- API route'lari ilk fazda `/api` altina mount edilecek; URL path versioning kullanilmayacak.
- Production CORS wildcard olmayacak.
- Logger structured olacak; production ana logger'i `console.log` olmayacak.
- `requestIdMiddleware` ve HTTP logger ayni request id'yi kullanacak.
- Health probe basarili access loglari varsayilan olarak filtrelenecek.
- Rate limit temel middleware olarak kurulacak; production multi-instance icin Redis store kullanilacak.
- `OPTIONS` preflight requestleri rate limit sayacina dahil edilmeyecek.
- `trust proxy` production topology'ye gore bilincli set edilecek.
- Feature service dosyalari HTTP server, process signal veya Redis client lifecycle bilmeyecek.
- Health endpointleri API route'larindan bagimsiz olacak.
- Readiness checkleri timeout ve kisa cache ile calisacak.
- Express 5 async handler forwarding'e guvenilecek; genel `asyncHandler` wrapper yazilmayacak.
- Testlerde Redis/DB bagimliligi mock veya test instance ile verilebilecek.

## V1'den Alinan Dersler

V1'de iyi olan kisimlar:

- `server.ts` ile `source/app.ts` ayrimi var.
- Graceful shutdown icinde DB ve Redis disconnect dusunulmus.
- Redis/session dependency'si zaten uygulama runtime'inda var.
- Passport middleware pipeline'i kullaniliyor.

V2'de iyilestirilecek kisimlar:

- Redis connect `app.ts` icinde yapilmayacak.
- Passport strategy `app.ts` icinde inline olmayacak.
- `server.ts` sadece runtime orchestration yapacak.
- App factory dependency alacak, testlerde daha kolay kurulacak.
- CORS production davranisi net allowlist olacak.
- V1'deki inline Passport/Redis bootstrap kodu ayrilacak.

## Open Decisions

- Compression uygulama tarafinda middleware ile mi, yoksa reverse proxy seviyesinde mi uygulanacak?
- Metrics/tracing icin Prometheus, OpenTelemetry veya baska bir stack mi tercih edilecek?

## Resolved Decisions

- Request id middleware'i ilk fazda eklenecek.
- `pino-http` request id olarak `req.id` kullanacak; iki farkli correlation id uretilmeyecek.
- Production rate limit Redis store kullanacak.
- `express-rate-limit` v8, `rate-limit-redis` ve `redis` major uyumu pinlenip smoke test edilecek.
- `OPTIONS` preflight requestleri rate limit sayacina dahil edilmeyecek.
- Startup Redis connect, Redis ping, DB check ve readiness dependency checkleri timeout ile calisacak.
- Readiness sonucu kisa TTL ile cache'lenebilir.
- Graceful shutdown hard timeout ve idempotency guard icerecek.
- Shutdown pre-drain icin `SHUTDOWN_PREDRAIN_MS` desteklenecek.
- Env validation Zod v4 ile yapilacak.
- Config invariant'lari Zod `.refine()` ile dogrulanacak.
- `TRUST_PROXY=1` env degeri number `1` olarak parse edilecek.
- Production secret'lari `.env` dosyasindan degil env injection uzerinden gelecek.
- API base path ilk fazda `/api` olacak; URL path uzerinden versioning yapilmayacak.
- Path alias ilk fazda kullanilmayacak; relative `.ts` import tercih edilecek.
- Express 5 async error forwarding'e guvenilecek; genel `asyncHandler` wrapper yazilmayacak.
- Auth flow detaylari bu planin disinda kalacak.

## Verification Checklist

- Numerik ve boolean env parse hatalari Zod validation ile uygulama basinda yakalanir.
- `TRUST_PROXY=1` config icinde string `"1"` degil number `1` olur.
- Invalid shutdown timeout siralamasi config validation'da yakalanir.
- Production start akisi secret'lari `.env` varsayimi olmadan env injection ile okuyabilir.
- `DATABASE_URL` yanlisken app listen etmeden `exit(1)` ile kapanir.
- Redis kapaliyken app listen etmeden `exit(1)` ile kapanir.
- Startup Redis connect, Redis ping veya DB check timeout'a duserse app listen etmeden `exit(1)` ile kapanir.
- Port doluyken `EADDRINUSE` structured loglanir ve process `exit(1)` yapar.
- `SIGTERM` geldiginde readiness hemen `503` doner.
- `SIGTERM` sonrasi `SHUTDOWN_PREDRAIN_MS` kadar kisa drain beklemesi uygulanabilir.
- `SIGTERM` sonrasi HTTP server yeni request kabul etmez.
- Keep-alive connection acikken shutdown hard timeout calisir.
- Iki kez `SIGINT` geldiginde cleanup ikinci kez calismaz.
- Fatal exit yollarinda logger flush cagrilir.
- `unhandledRejection` ve `uncaughtException` fatal shutdown tetikler.
- `/health/live` DB/Redis kapali olsa bile process ayaktaysa cevap verebilir.
- `/health/ready` DB veya Redis sorununda `503` doner.
- `/health/ready` DB veya Redis asili kalirsa probe timeout ile `503` doner.
- `/health/ready` kisa cache sayesinde ayni anda gelen probe'larda DB/Redis'i gereksiz yormaz.
- Basarili `/health/*` probe'lari HTTP access log noise uretmez.
- HTTP loglarinda request id `requestIdMiddleware` ile ayni correlation id'dir.
- 5xx response'lar error seviyesinde, 4xx response'lar warn seviyesinde loglanir.
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
- pino-http request id, customLogLevel ve autoLogging configuration.
- Express `trust proxy` dokumantasyonu.
