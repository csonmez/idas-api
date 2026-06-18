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

`SESSION_SECRET` ornek degeri bilincli olarak gecersiz kisa bir placeholder'dir; hem niyeti acik eder hem de Zod `.min(32)` kuralina takilarak kopyala-yapistir kullanimda startup'i fail-fast dusurur.

Kararlar:

- Env validation icin mevcut `zod` v4 kullanilacak.
- `AppConfig` tipi Zod schema'sindan `z.infer` ile uretilecek.
- `process.env` feature, middleware, route, DB veya Redis dosyalarinda dogrudan okunmayacak.
- `NODE_ENV` explicit okunacak; `isProduction` kaynagi `NODE_ENV === 'production'` olacak.
- `PORT` numeric parse edilecek.
- `SESSION_SECRET` icin "guclu" somut olarak tanimlanacak:
  - Minimum uzunluk `>= 32` karakter (Zod `.min(32)`).
  - Production'da default/fallback deger YOK; eksik veya kurali saglamiyorsa `readEnv()` fail-fast ile uygulamayi baslatmadan dusurecek.
  - Development'ta da ayni kurallar uygulanabilir.
- Production secret'lari `.env` dosyasindan degil, runtime env injection / secret manager / orchestrator uzerinden gelecek.
- Local development icin `.env` kullanilabilir.

Auth ile ilgili config'ler `AppConfig` icinde `auth` namespace'i altinda toplanacak. Buradaki amac auth davranisini config'e tasimak degil, auth davranisinin kullandigi ayarlari tek yerde normalize etmektir. Auth route, controller, service, Passport strategy is mantigi ve session invalidation gibi davranislar `src/auth` / ilerideki auth/account modulunde kalacak; `src/config` sadece ayar uretir.

Ilk faz `AppConfig` sekli:

```ts
export type AppConfig = {
	nodeEnv: 'development' | 'test' | 'production'
	isProduction: boolean
	port: number
	databaseUrl: string
	redisUrl: string
	auth: {
		sessionSecret: string
		sessionCookieName: string
		sessionMaxAgeMs: number
		sessionCookieSecure: boolean
		sessionCookieSameSite: 'lax' | 'strict' | 'none'
		csrfHeaderName: 'x-csrf-token'
	}
}
```

Notlar:

- Ilk fazda env'den sadece `SESSION_SECRET` gelir; diger auth config alanlari kod sabiti veya `NODE_ENV`'den turetilmis degerlerdir.
- `sessionCookieSecure`, `isProduction`'dan turetilir (`production` icin `true`, diger ortamlar icin `false`).
- `auth/session.ts` ve `auth/csrf.ts` `process.env` okumaz; sadece `config.auth` degerlerini kullanir.
- `config.auth` icinde route path, controller, service veya Passport strategy davranisi tutulmaz.

Kod sabiti olacaklar:

- DB pool degerleri.
- API prefix: `/api`.
- Request id header: `x-request-id`.
- Shutdown hard timeout degerleri.
- CORS allowlist.
- JSON/urlencoded body limitleri.
- `trust proxy` davranisi.
- Auth session cookie adi, session omru, sameSite degeri ve CSRF header adi (`AppConfig.auth` altinda normalize edilmis sekilde).

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
import { sql, type Kysely } from 'kysely'
import { createApp } from './app.ts'
import { configurePassport } from './auth/passport.ts'
import { createRedisClient, type RedisClient } from './cache/redis.ts'
import { readEnv, type AppConfig } from './config/env.ts'
import { createDb, type DB } from './database/index.ts'
import { flushLogger, logger } from './logger/index.ts'

const FORCE_CLOSE_CONNECTIONS_AFTER_MS = 10_000
const FORCE_EXIT_AFTER_MS = 15_000
const FATAL_FLUSH_TIMEOUT_MS = 2_000

let isReady = false
let isShuttingDown = false

// flushLogger takilirsa bir ust sinirdan sonra devam et. Bu fonksiyon ASLA
// reject ETMEZ: flushLogger reject ederse swallow edilir. Aksi halde
// `await flushWithTimeout()` throw eder ve hemen ardindaki process.exit(...)
// hic calismaz; yani flush hatasi exit garantisini kirardi (ve fatal path'te
// yeni bir unhandledRejection dogurabilirdi).
// Timer REF'li birakilir: fatal/startup path'lerinde event loop'ta baska handle
// kalmayabilir; unref'li timer process'i tutmazsa callback hic calismadan Node
// temiz exit(0) yapabilir ve "flush sonrasi exit(1)" garantisi kirilir. Race
// bittiginde timer temizlenir, dolayisiyla normal akista process asili kalmaz.
const flushWithTimeout = async () => {
	let timer: NodeJS.Timeout | undefined
	await Promise.race([
		flushLogger()
			.catch(() => undefined)
			.finally(() => clearTimeout(timer)),
		new Promise((resolve) => {
			timer = setTimeout(resolve, FATAL_FLUSH_TIMEOUT_MS)
		})
	])
}

// config/db/redisClient ve baglanti check'leri tek startup try/catch icinde.
// readEnv() (Zod fail-fast) veya gecersiz DB/Redis URL gibi senkron hatalar da
// boylece structured loglanip flush edilerek exit(1) ile dusurulur; logger
// env'e bagimli olmadigi (log level kod sabiti) icin bu noktada kullanilabilir.
// config/db/redisClient `let` ile disarida bildirilir ki shutdown akisi
// erisebilsin. Ucu de `| undefined` ile ayni definite-assignment pattern'ini
// kullanir: try icinde atanir, catch her durumda process.exit yapar, dolayisiyla
// try sonrasi bunlar kesin tanimlidir ama TS bunu daraltamaz; kullanim
// yerlerinde non-null assertion (`!`) gerekir. readEnv hatasinda db/redisClient
// hic olusmamis olabilecegi icin cleanup'ta ayrica optional chaining (`?.`) var.
let config: AppConfig | undefined
let db: Kysely<DB> | undefined
let redisClient: RedisClient | undefined

const checkDb = async () => {
	await sql`select 1`.execute(db!)
}
const checkRedis = async () => {
	await redisClient!.ping()
}

try {
	config = readEnv()
	db = createDb(config.databaseUrl)
	redisClient = createRedisClient(config.redisUrl)

	await redisClient.connect()
	await checkRedis()
	await checkDb()
	configurePassport({ db })
} catch (error) {
	logger.fatal({ error }, 'Server startup failed')
	// Startup-failure path'inde pending komut yok; aninda kesmek icin disconnect.
	// db/redisClient olusmadan da bu path'e dusebiliriz (orn. readEnv hatasi).
	await Promise.allSettled([redisClient?.disconnect(), db?.destroy()])
	await flushWithTimeout()
	process.exit(1)
}

// Bu noktaya gelindiyse startup try basariyla tamamlanmistir; catch her durumda
// process.exit yaptigi icin config/db/redisClient kesinlikle tanimlidir. TS bunu
// daraltamadigindan (uctip `| undefined`) non-null assertion kullanilir.
const app = createApp({
	config: config!,
	db: db!,
	redisClient: redisClient!,
	isReady: () => isReady,
	checkDb,
	checkRedis
})

const server = app.listen(config!.port, () => {
	isReady = true
	logger.info({ port: config!.port }, 'Server is running')
})

// SIGINT / SIGTERM / serverError gibi process'in saglikli oldugu durumlarda
// inflight request'lerin bitmesini bekleyen kontrollu kapanis.
const gracefulShutdown = (reason: string, exitCode = 0) => {
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

	const forceExitTimer = setTimeout(() => {
		logger.error('Graceful shutdown timed out')
		// Flush'i beklemeden cik; bu path zaten "her sey takildi" durumudur.
		void flushWithTimeout().finally(() => process.exit(1))
	}, FORCE_EXIT_AFTER_MS)

	forceExitTimer.unref()

	server.close(async (error) => {
		if (error) {
			logger.error({ error }, 'HTTP server close failed')
			exitCode = 1
		}

		// Normal kapanista pending komutlari flush etmek icin quit() kullanilir.
		// gracefulShutdown ancak listen sonrasi kurulur; bu noktada ikisi de tanimli.
		const results = await Promise.allSettled([redisClient!.quit(), db!.destroy()])

		for (const result of results) {
			if (result.status === 'rejected') {
				logger.error({ error: result.reason }, 'Shutdown cleanup failed')
				exitCode = 1
			}
		}

		clearTimeout(forceCloseTimer)
		clearTimeout(forceExitTimer)
		await flushWithTimeout()
		process.exit(exitCode)
	})
}

// Process'in bozuk/bilinmeyen state'te oldugu durumlar: graceful kapanisa
// GIRMEZ. Inflight request'lerle response uretmeye calismak veri butunlugunu
// bozabilir. Sadece hizli flush + exit yapilir.
const fatalExit = (reason: string, error: unknown) => {
	logger.fatal({ error }, reason)
	void flushWithTimeout().finally(() => process.exit(1))
}

server.on('error', (error) => {
	logger.fatal({ error }, 'HTTP server error')
	gracefulShutdown('serverError', 1)
})

process.on('SIGINT', () => gracefulShutdown('SIGINT', 0))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 0))
process.on('unhandledRejection', (error) => fatalExit('Unhandled rejection', error))
process.on('uncaughtException', (error) => fatalExit('Uncaught exception', error))
```

Notlar:

- `app.listen(...)` uygundur; Express bu cagriyla bir `http.Server` dondurur.
- `createServer(app)` sadece ekstra server customization gerekiyorsa tercih edilir. Ilk fazda gerek yoktur.
- Top-level `await` Node ESM akisi icin uygundur; `main()` wrapper TypeScript zorunlulugu degildir.
- `readEnv()`, `createDb()` ve `createRedisClient()` startup try/catch icindedir. Boylece env validation (Zod fail-fast) veya gecersiz DB/Redis URL gibi senkron hatalar da structured loglanip flush edilerek `exit(1)` ile dusurulur. Logger log level'i kod sabiti oldugu icin env'e bagimli degildir ve bu noktada guvenle kullanilabilir. `db`/`redisClient` `let` ile disarida bildirilir; readEnv hatasinda henuz olusmamis olabilecekleri icin cleanup'ta optional chaining (`?.`) ve listen sonrasi `!` ile ele alinir.
- `delay` / pre-drain ilk fazda yoktur. Shutdown basladiginda `server.close()` hemen yeni connection kabulunu durdurur.
- Hard timeout degerleri kod sabitidir. Degistirmek gerekirse koddan bilincli degistirilir.
- `unhandledRejection` ve `uncaughtException` graceful shutdown akisina GIRMEZ. Bu durumda process bilinmeyen/bozuk state'tedir; `server.close()` ile inflight request'leri bekleyip bozuk state'le response uretmeye calismak veri butunlugunu riske atar. Bu path'ler `fatalExit` ile sadece hizli flush + `exit(1)` yapar. Sadece `SIGINT`, `SIGTERM` ve `serverError` graceful kapanisa girer.
- Fatal exit path'lerinde `flushLogger` da takilabilir; `flushWithTimeout` (`FATAL_FLUSH_TIMEOUT_MS`) flush'i bir ust sinira baglar, boylece flush takilsa bile process exit eder. Bu timeout timer'i bilincli olarak `unref()` EDILMEZ: aksi halde event loop'ta baska handle kalmadiginda timer process'i tutmaz ve callback calismadan Node `exit(0)` ile cikabilir; bu da "flush sonrasi `exit(1)`" garantisini kirar. Race tamamlaninca timer `clearTimeout` ile temizlenir.
- `flushWithTimeout` asla reject etmez; `flushLogger` reject ederse hata `catch` ile yutulur. Aksi halde `await flushWithTimeout()` throw edip hemen ardindaki `process.exit(...)`'i engeller ve flush hatasi exit garantisini kirardi.
- Normal shutdown'da Redis icin `quit()` kullanilir (pending komutlari flush eder). `disconnect()` baglantiyi aninda, pending komutlari beklemeden keser ve sadece startup-failure path'inde tercih edilir.
- `forceExitTimer` ve `forceCloseTimer` `unref()` edilmistir, dolayisiyla bunlar process'i tek baslarina ayakta tutmaz. Process'i ayakta tutan, acik Redis/DB baglantilari ve inflight request'lerdir; graceful path bu kaynaklar kapaninca normal sekilde `server.close()` callback'i uzerinden exit eder. `unref()` edilmis force-exit timer, sadece bu kaynaklardan biri takildiginda en son guvence olarak devreye girer.

## `app.ts`

`app.ts` Express uygulamasini olusturan factory olacak.

Factory kalmasinin nedeni TypeScript degil; DB ve Redis dependency'lerini `server.ts` tarafinda olusturup app'e vermektir. Bu, testlerde fake DB/Redis vermeyi kolaylastirir.

Sorumluluklar:

- Express instance olusturmak.
- Request id, logger, helmet, CORS middleware'lerini eklemek.
- Health endpointlerini eklemek.
- Genel API rate limit'i body parser ve session'dan once eklemek.
- Body parser, session, Passport ve CSRF middleware'lerini siralamak.
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
import express from 'express'
import { type Kysely } from 'kysely'
import passport from 'passport'
import { createCsrfMiddleware } from './auth/csrf.ts'
import { createSessionMiddleware } from './auth/session.ts'
import type { RedisClient } from './cache/redis.ts'
import type { AppConfig } from './config/env.ts'
import type { DB } from './database/index.ts'
import { httpLogger } from './logger/http-logger.ts'
import { errorHandler } from './middlewares/error.middleware.ts'
import { notFoundHandler } from './middlewares/not-found.middleware.ts'
import { requestIdMiddleware } from './middlewares/request-id.middleware.ts'
import { createRoutes } from './routes/index.ts'
import { createCorsMiddleware } from './security/cors.ts'
import { createHelmetMiddleware } from './security/helmet.ts'
import { apiRateLimit } from './security/rate-limit.ts'

const JSON_BODY_LIMIT = '1mb'
const URLENCODED_BODY_LIMIT = '100kb'

export type AppDependencies = {
	config: AppConfig
	db: Kysely<DB>
	redisClient: RedisClient
	isReady: () => boolean
	// Readiness icin altyapidan bagimsiz, testte trivial fake'lenebilen check'ler.
	checkDb: () => Promise<void>
	checkRedis: () => Promise<void>
}

const createReadinessHandler = (deps: AppDependencies) => {
	return async (_req: express.Request, res: express.Response) => {
		if (!deps.isReady()) {
			res.status(503).end()
			return
		}

		try {
			await Promise.all([deps.checkDb(), deps.checkRedis()])
			res.status(204).end()
		} catch {
			res.status(503).end()
		}
	}
}

export const createApp = (deps: AppDependencies) => {
	const app = express()

	// Production'da onde TLS terminate eden tek bir L7 reverse proxy var (tek hop).
	// Bu proxy X-Forwarded-For/Proto uretir. Sayisal hop kullanilir; `true`
	// rate limit icin fazla permissive olur. Proxy yoksa secure cookie set
	// edilmez ve rate limit IP'si yanlis cozulur (bkz. Deployment Topolojisi).
	app.set('trust proxy', deps.config.isProduction ? 1 : false)
	app.disable('x-powered-by')

	app.use(requestIdMiddleware)
	app.use(httpLogger)
	app.use(createHelmetMiddleware())
	app.use(createCorsMiddleware())

	app.get('/health/live', (_req, res) => res.status(204).end())
	app.get('/health/ready', createReadinessHandler(deps))

	// Tum API-only middleware'ler `/api` altinda. Body parser'lar da `/api`
	// altinda: boylece `/api` disi bilinmeyen bir URL'e gelen malformed body
	// gereksiz parse edilip 400/413 uretmez, 404 doner.
	app.use('/api', apiRateLimit)
	app.use('/api', express.json({ limit: JSON_BODY_LIMIT }))
	app.use('/api', express.urlencoded({ extended: true, limit: URLENCODED_BODY_LIMIT }))
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
request id / request context        (global)
http request logger                 (global)
helmet                              (global)
cors                                (global)
health routes                       (global, /api disi)
--- buradan asagisi /api altinda ---
api rate limit
json body parser
urlencoded body parser
session
passport.initialize
passport.session
csrf middleware (safe method + token endpoint + auth istisnalari)
api routes
--- /api sonu ---
not found handler                   (global)
global error handler                (global)
```

Notlar:

- Health endpointleri `/api` disinda kalir ve rate limit/body parser/session/Passport/CSRF middleware'lerine girmez.
- Body parser'lar `/api` altinda baglanir; `/api` disi URL'ler body parse maliyetine ve malformed-body 400/413'une maruz kalmaz.
- Genel API rate limit body parser ve session'dan once calisir.
- Auth-specific rate limit bu bootstrap planinda global middleware degildir; login/forgot-password gibi route'lara auth/account planinda eklenecek.
- `cookie-parser` pipeline'da yok; session cookie'sini `express-session` kendi okur (bkz. Session and CSRF).
- `session` Passport session'dan once gelmelidir.
- CSRF middleware'i safe method'lari muaf tutar, token endpoint'i CSRF check'inden once gelir ve belirli auth endpoint'leri istisna alir (bkz. Session and CSRF).
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

// CORS reddi generic 500 degil 403 olmali. Hataya status tasinarak
// errorHandler bunu 403 FORBIDDEN'a map'ler.
class CorsError extends Error {
	status = 403

	constructor() {
		super('Not allowed by CORS')
		this.name = 'CorsError'
	}
}

export const createCorsMiddleware = () => {
	return cors({
		credentials: true,
		origin: (origin, callback) => {
			if (!origin || ALLOWED_ORIGINS.includes(origin)) {
				callback(null, true)
				return
			}

			callback(new CorsError())
		},
		allowedHeaders: ['content-type', 'authorization', 'x-csrf-token', 'x-request-id'],
		exposedHeaders: ['x-request-id']
	})
}
```

Notlar:

- CORS reddi `errorHandler`'a `status = 403` ile duser ve `403 FORBIDDEN` olarak donulur; reddedilen origin asla generic 500 gormez.
- Production frontend domain'i belli olunca bu array'e koddan eklenir. Production origin'leri `https://` scheme'li olacak; CORS origin tam string eslesmesi yaptigi icin `http://` ile `https://` farkli kabul edilir. TLS L7 proxy'de terminate edildigi (bkz. Deployment Topolojisi) icin tarayicidan gelen origin `https://`'tir; listede `http` birakmak production'da CORS reddine yol acar.
- Local `http://localhost:*` girisleri development icindir; production allowlist'i ile karistirilmayacak (gerekirse `isProduction`'a gore ayrismis liste).

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
- Redis client tipi tek noktadan turetilecek: `cache/redis.ts` `createRedisClient`'in donus tipini `export type RedisClient = ReturnType<typeof createRedisClient>` olarak export edecek. `app.ts` ve diger tuketiciler ciplak `RedisClientType` yerine bu `RedisClient` tipini kullanacak. `redis` paketinde `RedisClientType`'in default generic'i, `createClient(...)` ciktisinin generic'leriyle (modules/scripts/functions) uyusmayabilir; `ReturnType` ile turetmek bu tip uyumsuzlugunu bastan engeller.
- Redis startup'ta zorunlu dependency'dir. Connect veya ping basarisizsa app listen etmez.
- Runtime'da Redis sagliksizsa `/health/ready` `503` doner.
- `/health/live` Redis sorununda da process ayaktaysa `204` donebilir.
- Session Redis'e bagli oldugu icin Redis runtime failure durumunda authenticated/session gerektiren endpointler kontrollu `503` donmelidir.
- Rate limit Redis store hata verirse production'da fail-closed davranis tercih edilir; yani request `503` ile reddedilir.

Connection/retry davranisi (startup, readiness ve shutdown garantilerini etkiler):

- Startup'ta Redis yoksa `connect()` sonsuza kadar asili kalmamali. `createRedisClient`, startup'ta sinirli/timeout'lu baglanma davranisi kullanacak; boylece "Redis kapaliyken app listen etmeden `exit(1)`" garantisi gercekten zamaninda tetiklenir.
- `reconnectStrategy` sonsuz/agresif retry yerine sinirli bir ust geri cekilme (capped backoff) kullanacak; runtime'da Redis dususte komutlarin sonsuza kadar beklemesi engellenecek.
- `disableOfflineQueue: true` kullanilacak: Redis baglanti disindayken komutlar kuyruga alinip asilmak yerine hizla hata verecek. Bu, readiness `/health/ready`'in `503` donmesi ve rate limit fail-closed davranisiyla tutarlidir.
- Connect ve command timeout degerleri kod sabiti olacak; shutdown'daki `quit()` de bu timeout'a tabi olacak ki kapanis gereginden uzun takilmasin (force-exit timer son guvence olarak kalir).
- Bu connection/retry sabitleri ilk fazda env olmayacak; `cache/redis.ts` icinde sabit kalacak.

## Session and CSRF

Bu plan cookie tabanli session kullandigi icin CSRF korumasi gerekir.

Kararlar:

- `SESSION_SECRET` env'den gelecek ve production'da zorunlu olacak.
- Auth ile ilgili ayarlar `config.auth` altinda toplanacak; `auth/session.ts` ve `auth/csrf.ts` bu config'i tuketecek.
- Cookie/session middleware kurulumu `auth/session.ts` icinde merkezi tutulacak; ancak cookie adi, max age, secure/sameSite ve secret degerleri `config.auth`'tan okunacak.
- Session store Redis-backed olacak.
- `passport.initialize()` ve `passport.session()` route'lardan once baglanacak.
- CSRF middleware'i session ve Passport'tan sonra, API route'larindan once baglanacak.
- Auth route/service davranislari config'e alinmayacak; login/logout, password reset, session invalidation ve Passport strategy is mantigi auth/account kapsaminda kalacak.

`express-session` / `connect-redis` ayarlari (bootstrap concern):

- `resave: false` — store kendiliginden resave gerektirmedigi surece her request'te session yeniden yazilmaz.
- `saveUninitialized: false` — login oncesi bos/anonim session Redis'e yazilmaz. Bu hem gereksiz Redis dolmasini hem de cookie set edilmesini engeller. ONEMLI: bu karar CSRF token modeliyle ve (ileride) session regenerate ile birbirine baglidir; bkz. asagidaki "saveUninitialized ve CSRF/regenerate etkilesimi".
- Store `connect-redis` `RedisStore` olacak ve `prefix` (orn. `sess:`) ile namespace'lenecek. Bu prefix, password reset sonrasi "user'a ait aktif session'lari invalidate" (auth/account plani) akisi icin session key'lerine erisimi netlestirir; davranis o planda, key namespace karari burada.
- Store TTL'i `config.auth.sessionMaxAgeMs` ile hizali olacak; Redis kaydi ile cookie omru ayrismasin diye ikisi ayni config degerinden beslenecek.
- `secret` ilk fazda `config.auth.sessionSecret` olarak tek string olacak, ancak `express-session` `secret`'in dizi (`[yeni, ...eski]`) formatini destekledigi icin gelecekte secret rotation'a gecisi engellemeyen bir sekilde yazilacak (tek string'den dizi'ye gecis davranis degistirir; bu bilincli birakiliyor).
- Cookie `name`, `config.auth.sessionCookieName` olacak; varsayilan `connect.sid` yerine projeye ozel, notr bir ad kullanilacak.

Session cookie ayarlari (bootstrap concern):

Bu ayarlar `trust proxy` ile dogrudan iliskilidir, bu yuzden bootstrap kapsamindadir. `cookie.secure = true` iken Express, request'in HTTPS uzerinden geldigini `trust proxy` + proxy header'larina bakarak anlar; `trust proxy` yanlissa secure cookie hic set edilmez ve session calismaz.

- `httpOnly: true` — cookie JS'ten erisilemez (XSS ile session calinmasini zorlastirir).
- `secure: config.auth.sessionCookieSecure` — production'da cookie sadece HTTPS uzerinden gonderilir. Bu deger `config.isProduction`'dan turetilir ve production'da `trust proxy = 1`'in dogru calismasini gerektirir.
- `sameSite: config.auth.sessionCookieSameSite` — ilk faz varsayilani `'lax'`; cross-site cookie tabanli istekler ve frontend'in farkli origin'de olmasi durumunda davranis auth/account planinda netlestirilecek (gerekirse `'none'` + `secure`).
- `maxAge: config.auth.sessionMaxAgeMs` — session omru config altindaki kod sabitinden gelir.
- Cookie `name: config.auth.sessionCookieName` olacak; varsayilan `connect.sid` yerine projeye ozel ve notr bir ada (fingerprinting'i azaltmak icin) set edilir.
- `secure: 'auto'` kullanilmayacak; ortam bazli explicit `boolean` (production'da `true`) tercih edilecek.

`sameSite` ve CSRF token korumasi birbirini tamamlar; `sameSite` tek basina yeterli kabul edilmez ve CSRF middleware'i (bkz. asagi) yine pipeline'da kalir.

CSRF exemption modeli (bootstrap concern):

CSRF middleware'i `/api` altindaki tum route'lardan once baglandigi icin, exemption modeli olmadan login dahil her POST kilitlenir. Bu yuzden exemption *kategorileri* bu planda kararlastiriliyor; exact token uretim/dogrulama pattern'i auth/account planina birakiliyor.

- Safe method'lar (`GET`, `HEAD`, `OPTIONS`) CSRF check'inden muaf olacak.
- CSRF token'i veren endpoint (orn. `GET /api/csrf-token`) doga geregi safe method olacak ve CSRF check'inin "once token al" akisini kirmayacak.
- Henuz session yokken cagrilan auth endpoint'leri (login, forgot-password, reset-password) icin istisna stratejisi netlestirilecek. Tercih edilen yon: double-submit/`sameSite` temelli korumayla bu endpoint'lerin de CSRF kapsaminda kalmasi; ancak ilk faz icin bunlarin acik istisna listesi auth/account planinda kesinlesecek.
- Exact token pattern (header adi `config.auth.csrfHeaderName`, cookie vs session-bound token, rotation) auth/account planinda detaylandirilacak; bootstrap sadece middleware'in pipeline'daki yerini ve yukaridaki kategori istisnalarini sabitler.

`saveUninitialized: false` ve CSRF/regenerate etkilesimi (bootstrap concern, cunku `saveUninitialized` burada kararlastirildi):

CSRF token modeli `saveUninitialized: false` ile bagimsiz secilemez. Iki yon var:

- Session-bound token: token `req.session`'da saklanip dogrulanir. `GET /api/csrf-token` cagrisinda session'a yazma oldugu icin session "modified" sayilir ve `saveUninitialized: false` olsa bile kaydedilir + cookie set edilir (cunku `saveUninitialized` yalnizca *degismemis* session'lari engeller). Bu davranisa guvenmek yerine token endpoint'inin gercekten session olusturup cookie set ettigi TEST ile dogrulanacak.
- Double-submit cookie: token session'a degil ayri bir cookie'ye + request header'ina konur. Token endpoint session'i initialize etmez, `saveUninitialized: false` ile surtusme olmaz; ancak CSRF cookie'sinin `sameSite`/`secure`/`httpOnly` ayarlari ve cookie-header eslesmesi netlesmelidir (CSRF cookie genelde `httpOnly` OLAMAZ cunku JS okumali).

Ek bag: ileride login sonrasi session fixation korumasi icin `req.session.regenerate()` yapilirsa, session-bound CSRF token'i regenerate sonrasi yenilenmek zorundadir (eski token yeni session'da gecersizdir). Yani `saveUninitialized` <-> CSRF token modeli <-> session regenerate ucu birbirine baglidir. Exact token pattern auth/account planinda secilecek; ancak hangi yon secilirse `saveUninitialized: false` ile uyumu ve regenerate etkilesimi orada acikca dogrulanacak.

Auth bootstrap kesisimi (bu planda sadece baglanti noktasi):

- `configurePassport({ db })` hook'u Passport Local strategy'yi kuracak; parola dogrulamasi `users.password` degil `user_credentials.password_hash` uzerinden yapilacak (bkz. auth/account plani). Strategy is mantigi o planda; bootstrap sadece hook'u listen oncesi calistirir.
- Passport `serializeUser`/`deserializeUser` session'a sadece user id koyacak sekilde kurulacak; deserialize sirasinda kullanici `INACTIVE` ise session gecersiz sayilacak (davranis detayi auth planinda).
- Session store key prefix'i (`prefix`) yukarida sabitlendi; password reset sonrasi user session invalidation bu prefix uzerinden calisacak (davranis auth planinda).

Bu planda detaylandirilmeyecekler:

- Login/logout route tasarimi.
- CSRF token endpoint'inin exact token pattern'i.
- Session fixation korumasi (login sonrasi session regenerate).
- Force logout/session invalidation davranisi.
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

## Deployment Topolojisi, TLS ve Shutdown Drain (Docker Swarm)

Deploy Docker Swarm ile yapilir. Uygulamanin onunde TLS'i terminate eden bir L7 reverse proxy (Traefik/Nginx/Caddy) vardir. Bu topoloji `trust proxy`, `secure` cookie, rate limit IP'si ve healthcheck semasini dogrudan belirler.

TLS termination ve proxy onkosulu (kritik):

- TLS, uygulamanin onundeki L7 reverse proxy'de terminate edilir. Proxy `X-Forwarded-For` ve `X-Forwarded-Proto` header'larini uretip uygulamaya iletir.
- Bu onkosul saglanmadan `trust proxy = 1` ise calismaz: Swarm ingress routing mesh L4 (IPVS/NAT) seviyesindedir ve `X-Forwarded-*` header'i uretmez. L7 proxy olmadan `req.protocol` `http` kalir, `secure: true` cookie hic set edilmez (session calismaz) ve rate limit IP'si mesh NAT'i yuzunden yanlis/tek IP olur.
- L7 proxy oldugu icin `trust proxy = 1` dogrudur: uygulamanin gordugu tek guvenilir hop bu proxy'dir. Proxy ile uygulama arasina ek bir hop girerse hop sayisi koddan bilincli arttirilir.
- Trafik akisi: client -> (HTTPS) L7 proxy -> (HTTP) container. Yani uygulama container icinde duz HTTP serve eder; TLS proxy katmanindadir.
- Swarm service healthcheck'i container icine duz **HTTP** ile vuracak (`http://localhost:<port>/health/ready`); TLS proxy katmanindadir, healthcheck TLS kullanmaz.
- CORS `ALLOWED_ORIGINS` production'da `https://` scheme'li gercek domain(ler) olacak; CORS origin tam string eslesmesi yaptigi icin `http` vs `https` farki onemlidir (bkz. CORS bolumu).

Zero-downtime icin gerekenler:

Swarm'in varsayilani otomatik zero-downtime degildir. Rolling update varsayilaninda `update-order: stop-first`'tir; tek replica veya `stop-first` ile yeni task ready olana kadar kisa bir downtime penceresi olusur. Bu yuzden asagidakiler varsayim degil gereksinimdir:

- `replicas >= 2` olacak. Tek replica ile rolling update sirasinda downtime kacinilmazdir.
- `update-config.order: start-first` kullanilacak. Yeni task baslayip healthy olmadan eski task durdurulmayacak.
- Service healthcheck'i `/health/ready`'e baglanacak. Swarm healthcheck'i task lifecycle (running/healthy state) ve rolling update gating icin kullanir; `start-first` + healthcheck saglıksiz yeni task'i eski task durmadan devreye sokmaz. Not: ingress routing mesh'in saglıksiz task'a paket gondermeme davranisi tam bir LB readiness gating'i gibi degildir ve Swarm versiyonu/topolojiye gore dogrulanmalidir; bu yuzden bu davranisa tek basina guvenilmez, deploy oncesi staging'de test edilir.
- `update-config.failure-action: rollback` (veya en az `pause`) ile saglıksiz deploy ilerlemeyecek.
- Healthcheck parametreleri netlestirilecek: `start_period`, uygulamanin startup smoke-check (Redis connect + ping + DB select) suresinden uzun olacak ki yavas startup gereksiz rollback tetiklemesin; `interval`, `timeout` ve `retries` makul degerlerde (orn. `interval=10s`, `timeout=3s`, `retries=3`, `start_period=15s`) sabitlenecek. `update-config.monitor` ise yeni task'in healthy kabul edilmeden once gozlenecegi sureyi belirleyecek.

Shutdown drain davranisi:

- Swarm bir task'i durdururken once routing mesh'ten cikarma egilimindedir, sonra container'a `SIGTERM` gonderir. `start-first` + healthcheck + `replicas >= 2` ile birlikte bu, ayri bir pre-drain delay ihtiyacini pratikte ortadan kaldirir; ancak tek basina mesh'ten cikarma siralamasina guvenilmez, yukaridaki gereksinimler saglanmalidir.
- `SIGTERM` alindiginda `gracefulShutdown` calisir: `isReady = false` olur, `/health/ready` `503` doner ve `server.close()` yeni connection kabulunu durdurup inflight request'lerin bitmesini bekler.
- `server.close()` ile `FORCE_CLOSE_CONNECTIONS_AFTER_MS` arasindaki sure, inflight request'ler ve keep-alive baglantilar icin drain penceresidir.
- Swarm'in `SIGTERM` ile `SIGKILL` arasinda taniyacagi sure (`stop-grace-period`) uygulamanin hard timeout'undan (`FORCE_EXIT_AFTER_MS`) buyuk olmalidir; aksi halde graceful shutdown tamamlanmadan Swarm process'i `SIGKILL` ile oldurur. Onerilen: `stop-grace-period >= 20s` (FORCE_EXIT_AFTER_MS = 15s icin emniyet payi).
- `/health/ready` Swarm service healthcheck'inde kullanilacak; `/health/live` ise sadece process canlilik kontrolu icindir.
- Bu plan kapsaminda K8s `preStop` hook veya harici LB drain senkronizasyonu yoktur.

## API Route Prefix

API route'lari ilk fazda sabit `/api` altina mount edilecek.

Kararlar:

- API prefix icin env olmayacak.
- Health endpointleri `/api` disinda kalacak: `/health/live`, `/health/ready`.
- Route aggregator kendi icinde `/api` bilmeyecek; prefix `app.ts` tarafinda uygulanacak.
- Auth/account planindaki admin route'lari (orn. `POST /manager/users/:id/unlock-account`) da `/api` prefix'i altinda olacak; yani efektif yol `/api/manager/...`. Auth/account plani route path'lerini `/api` prefix'i app.ts tarafindan uygulandigi varsayimiyla yazacak, kendi icinde `/api` tekrar etmeyecek. Bu, iki plan arasindaki prefix tutarsizligini onlemek icin burada sabitleniyor.

## Logging

Production'da `console.log` ana logging stratejisi olmayacak.

Kararlar:

- Structured logger kullanilacak.
- Onerilen paketler: `pino` ve `pino-http`.
- Default log level kod sabiti olarak `info` olabilir.
- Her request icin request id uretilecek veya upstream `x-request-id` korunacak.
- `requestIdMiddleware`, `httpLogger`'dan once calisacak. Upstream `x-request-id` varsa onu koruyacak (kotu bicimli/asiri uzun degerler reddedilip yenisi uretilecek), yoksa uretecek; degeri hem `res.locals.requestId`'ye yazacak hem de response `x-request-id` header'ina koyacak.
- Request id `res.locals.requestId` uzerinde tasinacak; `Express.Request` global type augmentation YAPILMAYACAK. Gerekce: global `declare` tum projeye ve test ortamina sizar; `res.locals` zaten request-scoped ve tipi esnektir, `strict` altinda ekstra ambient declaration gerektirmez. `pino-http` kendi `genReqId` ciktisini `req.id`'ye koyar; bunu `res.locals.requestId` ile hizalamak icin `genReqId` ayni degeri uretip donecek (asagi).
- `pino-http`'nin kendi `genReqId`'si ikinci/farkli bir id uretmeyecek; `genReqId: (req, res) => res.locals.requestId` ile kablolanacak. `requestIdMiddleware` `httpLogger`'dan once calistigi icin `res.locals.requestId` bu noktada dolu olacak. Boylece HTTP loglarindaki `reqId`, response'taki `x-request-id` ve `res.locals.requestId` ayni deger olacak.
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

Built-in / framework hatalarinin map'lenmesi:

`errorHandler` sadece domain hatalarini degil, framework ve middleware'lerin urettigi hatalari da standart response formatina cevirecek. Aksi halde bu hatalar generic 500 olarak sizar.

- `express.json()` malformed body'de `SyntaxError` firlatir (`err.type === 'entity.parse.failed'`). Bu `400 BAD_REQUEST` olarak map'lenecek.
- Body limit asilirsa body-parser `err.type === 'entity.too.large'` (status `413`) uretir. Bu `413 PAYLOAD_TOO_LARGE` olarak map'lenecek.
- CORS reddi `errorHandler`'a `Error('Not allowed by CORS')` olarak duser. Bu generic 500 degil, `403 FORBIDDEN` olarak map'lenecek (asagidaki CORS bolumune bakiniz).
- Bu map'leme icin `errorHandler`, hata uzerindeki `status`/`statusCode` ve `type`/`code` alanlarini taniyacak; tanimadigi her seyi `500 INTERNAL_ERROR` olarak donecek ve detay sizdirmayacak.
- `errorHandler` ilk satirinda `res.headersSent` kontrolu yapacak: response yazilmaya baslanmissa (stream, kismi yazim) kendi response'unu yazamaz; `return next(error)` ile Express default error handler'a delegate edip baglantiyi kapatmasini saglayacak. Aksi halde "Cannot set headers after they are sent" hatasi ve asili response olusur.

Notlar:

- Genel amacli `asyncHandler` wrapper ilk fazda yazilmayacak.
- Callback, event emitter, stream veya timer gibi Promise zinciri disindaki hata kaynaklari icin explicit `next(error)` gerekir.
- `uncaughtException` ve `unhandledRejection` HTTP error handler ile cozulmez; `server.ts` fatal exit akisini tetikler (graceful shutdown degil).

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

`trust proxy` ve rate limit etkilesimi:

- Rate limit key'i client IP'sine gore hesaplanir. Bu IP, `trust proxy` ayarina baglidir.
- Production'da uygulamanin onunde TLS terminate eden tek bir L7 reverse proxy var (bkz. Deployment Topolojisi). Bu proxy `X-Forwarded-For` uretir; `trust proxy = 1` ile dogru client IP cozulur. Swarm ingress mesh L4 oldugu icin bu header'i kendisi uretmez, dolayisiyla rate limit'in dogru IP gormesi L7 proxy onkosuluna baglidir.
- Proxy ile uygulama arasina ek hop girerse (`trust proxy = 1` yetersiz kalirsa) client IP yanlis cozulur ve rate limit ya tum trafigi tek IP gibi gorur ya da istemci spoof edebilir. Bu durumda hop sayisi koddan bilincli ayarlanir.
- `express-rate-limit` proxy konfigurasyonunu dogrulayan `validate` kontrollerini production'da acik tutacak (`ERR_ERL_PERMISSIVE_TRUST_PROXY` gibi uyarilar bastirilmayacak). Bu, `trust proxy` cok genis (`true`) ayarlandiginda erken uyari verir; bu yuzden `true` yerine sayisal hop (`1`) kullanilir.

## Test Strategy

Bootstrap testleri `createApp(deps)` factory'sinin dis bagimlilik alabilmesi uzerine kurulacak.

Kararlar:

- HTTP davranis testleri icin `node:test` + `supertest` kullanilacak.
- Test script'i ilk fazda eklenecek: `package.json` `"test": "tsx --test"` (veya proje runner'ina uygun esdeger) ile `node:test` test'leri calistirilacak; CI bu komutu cagiracak.
- `createApp(deps)` testlerinde DB ve Redis fake dependency olarak verilebilecek.
- Readiness testleri `checkDb`/`checkRedis` fake'lenerek yazilacak; fake `Kysely<DB>` veya gercek Redis client mock'lamak gerekmeyecek. Bu fonksiyonlar dependency oldugu icin basari/basarisizlik senaryosu trivial fake ile uretilecek.
- Health testleri `isReady` false, `checkDb`/`checkRedis` basari ve basarisizlik kombinasyonlarini kapsayacak.
- Middleware order smoke testleri health route'larin auth/rate limit disinda kaldigini dogrulayacak.
- Rate limit testleri `OPTIONS` preflight requestlerin sayaca dahil edilmedigini dogrulayacak.
- Error handler testleri Express 5 async handler throw/reject davranisinin global error middleware'e dustugunu dogrulayacak.
- Session testleri `saveUninitialized: false` davranisini dogrulayacak: session'a yazmayan/anonim bir istek `Set-Cookie` uretmemeli; session'a yazan bir istek (orn. CSRF token endpoint, session-bound model secilirse) `Set-Cookie` uretmeli. CSRF token modelinin exact testi auth/account planinda olsa da bu `saveUninitialized` <-> cookie davranis dogrulamasi bootstrap'ta tutulacak.
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

1. `src/config/env.ts` Zod schema ve `AppConfig` tipiyle eklenecek; auth ayarlari `AppConfig.auth` altinda normalize edilecek (`sessionSecret`, `sessionCookieName`, `sessionMaxAgeMs`, `sessionCookieSecure`, `sessionCookieSameSite`, `csrfHeaderName`).
2. `.env.example` sadece `NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` ve local compose ihtiyaclarini icerecek. `SESSION_SECRET` ornek degeri `min(32)` kuralina takilacak kadar kisa olacak.
3. `package.json` start script'leri ayrilacak: production `"start": "node dist/server.js"` (env injection; `--env-file` YOK), local icin `"start:local": "node --env-file=.env dist/server.js"`. Mevcut `"start": "node --env-file=.env dist/server.js"` production'da `.env` yoksa Node'un `--env-file` hatasiyla patlar ve "secret'lar env injection'dan gelir" karariyla celisir; bu yuzden production start'tan `--env-file` kaldirilacak. (`dev` script'i `--env-file=.env` ile local kalabilir.)
4. `compose.dev.yml` icine Redis servisi eklenecek.
5. Gerekli paketler eklenecek:
   - `redis`
   - `connect-redis`
   - `express-session`
   - `passport`
   - `pino`
   - `pino-http`
   - `rate-limit-redis`
   - (`cookie-parser` eklenmeyecek; `express-session` cookie'yi kendi okur. Session disinda bagimsiz cookie okuma ihtiyaci dogarsa o zaman bilincli eklenir.)
6. Gerekli type paketleri eklenecek:
   - `@types/express-session`
   - `@types/passport`
7. Test paketleri eklenecek:
   - `supertest`
   - `@types/supertest`
   - `package.json`'a `"test"` script'i (`tsx --test` veya esdeger) eklenecek.
8. `database/client.ts` env okumayacak sekilde factory/default pool config yapisina cekilecek.
9. `src/logger/index.ts` ve `src/logger/http-logger.ts` eklenecek; `httpLogger` `genReqId: (req, res) => res.locals.requestId` ile baglanacak.
10. `src/cache/redis.ts` factory olarak eklenecek (sinirli reconnect, `disableOfflineQueue`, connect/command timeout; `export type RedisClient = ReturnType<typeof createRedisClient>`).
11. `src/security/cors.ts`, `src/security/helmet.ts` (`createHelmetMiddleware()` factory), `src/security/rate-limit.ts` eklenecek.
12. `src/auth/session.ts`, `src/auth/csrf.ts`, `src/auth/passport.ts` bootstrap-level factory/hook olarak eklenecek; `session.ts` ve `csrf.ts` `config.auth` degerlerini kullanacak, `process.env` okumayacak.
13. `src/routes/index.ts` `createRoutes(deps)` factory olarak eklenecek.
14. `src/app.ts` `createApp(deps)` factory olarak eklenecek.
15. `src/server.ts` top-level bootstrap olarak eklenecek; `readEnv`/`createDb`/`createRedisClient` ve baglanti check'leri startup try/catch icinde olacak, `flushWithTimeout` reject etmeyecek sekilde yazilacak.
16. Health endpointleri `checkDb`/`checkRedis` dependency'leri uzerinden readiness check davranisiyla eklenecek.
17. Body parser'lar ve diger API-only middleware'ler `/api` altina mount edilecek; route'lar sabit `/api` altinda olacak.
18. Error (`headersSent` delegasyonu + body-parser/CORS hata map'leme) ve not-found middlewareleri eklenecek.
19. Startup Redis connect, `checkRedis` (`ping`) ve `checkDb` (`select 1`) checkleri eklenecek.
20. Graceful shutdown icin idempotency, hard timeout, `closeAllConnections` ve `fatalExit` (graceful'e girmeyen fatal path) akisi eklenecek. Swarm deploy/compose tarafinda `replicas >= 2`, `update-config.order: start-first`, `failure-action: rollback`, container icine duz HTTP `/health/ready` healthcheck'i (`start_period` > startup smoke-check), ve `stop-grace-period` (`>= 20s`, `FORCE_EXIT_AFTER_MS` ile uyumlu) ayarlanacak. TLS L7 proxy (Traefik/Nginx/Caddy) `X-Forwarded-For/Proto` uretecek sekilde onde konumlandirilacak.
21. `npm run typecheck` ile tipler, `npm test` ile testler dogrulanacak.
22. Redis/PostgreSQL ayakta iken local startup test edilecek.
23. Shutdown (graceful + `fatalExit` ayrimi), EADDRINUSE, readiness, middleware order, body-parser/CORS hata map'leme ve Express 5 async error smoke testleri yapilacak.

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
- Auth ile ilgili ayarlar `AppConfig.auth` altinda toplanacak; `src/config` sadece ayar uretir, auth route/service/strategy davranisi config'e tasinmaz.
- Production secret'lari `.env` dosyasindan degil env injection uzerinden gelecek.
- Path alias ilk fazda kullanilmayacak; relative `.ts` import tercih edilecek.
- Express 5 async error forwarding'e guvenilecek.
- Cookie session kullanildigi icin CSRF middleware'i bootstrap pipeline'da yer alacak.
- `unhandledRejection`/`uncaughtException` graceful shutdown'a girmeyecek; ayri bir `fatalExit` (hizli flush + `exit(1)`) kullanilacak. Sadece `SIGINT`/`SIGTERM`/`serverError` graceful kapanisa girecek.
- Fatal flush bir ust sinira (`FATAL_FLUSH_TIMEOUT_MS`) baglanacak. `flushWithTimeout` asla reject etmeyecek; flush hatasi yutulup `exit` garanti edilecek.
- `readEnv()`/`createDb()`/`createRedisClient()` startup try/catch icinde olacak; env veya URL hatalari da structured loglanip flush edilerek `exit(1)` ile dusurulecek.
- Normal shutdown'da Redis `quit()`, startup-failure'da `disconnect()` kullanilacak.
- Production'da onde TLS terminate eden bir L7 reverse proxy (Traefik/Nginx/Caddy) var; container icine duz HTTP serve edilecek. `trust proxy = 1` bu tek L7 hop icindir; bu proxy `X-Forwarded-For/Proto` uretir. Proxy onkosulu saglanmazsa `secure` cookie set edilmez ve rate limit IP'si yanlis cozulur.
- Swarm healthcheck'i container icine duz HTTP ile `/health/ready`'e vuracak (TLS proxy katmaninda).
- Deploy Docker Swarm ile yapilacak. Zero-downtime Swarm'in varsayilani degildir; gereksinim: `replicas >= 2`, `update-config.order: start-first`, healthcheck `/health/ready`, `failure-action: rollback`, `start_period` > startup smoke-check suresi. Swarm healthcheck'inin tam LB readiness gating'i gibi davranisi topolojiye gore staging'de dogrulanacak. `stop-grace-period >= 20s` olacak. Ayri pre-drain delay eklenmeyecek.
- Production CORS allowlist'i `https://` scheme'li gercek domain(ler) olacak; `http`/`https` farki CORS tam eslesmesinde onemli.
- Production session cookie `httpOnly: true`, `secure: config.auth.sessionCookieSecure`, `sameSite: config.auth.sessionCookieSameSite` olacak; `trust proxy = 1` ile uyumlu.
- `express-session` `resave: false`, `saveUninitialized: false`, `connect-redis` store + `prefix`, store TTL = `config.auth.sessionMaxAgeMs`, ozel cookie `name = config.auth.sessionCookieName` kullanilacak. `secret = config.auth.sessionSecret` ilk fazda tek string, rotation dizi formatina gecise acik birakilacak.
- `cookie-parser` kullanilmayacak; session cookie'sini `express-session` kendi okur.
- `checkDb` ve `checkRedis` dependency olarak `createApp`'e verilecek; readiness handler dogrudan `sql.execute`/`ping` cagirmayacak (test ergonomisi).
- `req.id` augmentation yapilmayacak; request id `res.locals.requestId` uzerinde tasinacak. `pino-http` `genReqId: (req, res) => res.locals.requestId` ile baglanacak.
- `helmet` da `createHelmetMiddleware()` factory'si uzerinden baglanacak (cors ile tutarli; `security/helmet.ts`).
- `errorHandler` ilk satirda `res.headersSent` ise `next(error)` ile Express default handler'a delegate edecek.
- `SESSION_SECRET` somut kural: `>= 32` karakter, production'da fallback yok.
- `package.json` start script'leri ayrilacak: production `node dist/server.js` (`--env-file` yok), local `start:local`/`dev` `--env-file=.env` ile.
- Redis client sinirli reconnect, `disableOfflineQueue: true` ve connect/command timeout ile kurulacak; startup'ta sinirli/timeout'lu connect kullanilacak.
- Redis client tipi `ReturnType<typeof createRedisClient>` ile turetilecek; ciplak `RedisClientType` kullanilmayacak.
- CORS reddi `403`, malformed JSON `400`, body limit asimi `413` olarak `errorHandler`'da map'lenecek.
- Body parser'lar `/api` altinda baglanacak; `/api` disi URL'ler body parse etmeyecek.
- CSRF exemption kategorileri (safe method, token endpoint, auth endpoint istisnalari) bootstrap'ta sabitlenecek; CSRF header adi `config.auth.csrfHeaderName` olacak; exact token pattern auth/account planinda.
- `package.json`'a `test` script'i eklenecek (`tsx --test` veya esdeger).
- Rate limit icin `express-rate-limit` proxy `validate` kontrolleri production'da acik kalacak.

## Verification Checklist

- Env parse hatalari Zod validation ile uygulama basinda yakalanir, structured loglanir ve `exit(1)` ile dusulur (try kapsami).
- Gecersiz `DATABASE_URL`/`REDIS_URL` (URL parse hatasi) startup try/catch icinde loglanir ve `exit(1)` yapar; readEnv hatasinda `db`/`redisClient` olusmamis olsa bile cleanup patlamaz.
- Production `SESSION_SECRET` eksik veya zayifsa (`< 32` char) startup fail eder.
- Production start script'i `--env-file` icermez; `.env` olmadan da env injection ile baslar.
- Production start akisi secret'lari `.env` varsayimi olmadan env injection ile okuyabilir.
- Auth ayarlari `AppConfig.auth` altinda uretilir; `auth/session.ts` ve `auth/csrf.ts` `process.env` okumadan `config.auth` kullanir.
- Logger flush reject etse bile `flushWithTimeout` throw etmez ve `process.exit` calisir.
- `DATABASE_URL` yanlisken app listen etmeden `exit(1)` ile kapanir.
- Redis kapaliyken app listen etmeden `exit(1)` ile kapanir.
- Port doluyken `EADDRINUSE` structured loglanir ve process `exit(1)` yapar.
- `SIGTERM` geldiginde readiness hemen `503` doner.
- `SIGTERM` sonrasi HTTP server yeni connection kabul etmez.
- Keep-alive connection acikken shutdown hard timeout calisir.
- Iki kez `SIGINT` geldiginde cleanup ikinci kez calismaz.
- Fatal exit yollarinda logger flush cagrilir; flush takilirsa `FATAL_FLUSH_TIMEOUT_MS` sonrasi yine de `exit` olur.
- `unhandledRejection` ve `uncaughtException` graceful shutdown'a girmez; `fatalExit` ile hizli flush + `exit(1)` yapar.
- Normal shutdown Redis icin `quit()`, startup-failure ise `disconnect()` kullanir.
- Swarm `stop-grace-period` degeri `FORCE_EXIT_AFTER_MS`'den buyuktur; graceful shutdown `SIGKILL`'den once tamamlanir.
- CORS reddi `403` doner, generic `500` donmez.
- Malformed JSON body `400`, body limit asimi `413` doner.
- Production session cookie `secure: true`, `httpOnly: true`, `sameSite: 'lax'` ile set edilir; L7 proxy `X-Forwarded-Proto: https` ilettiginde `trust proxy = 1` ile cookie dogru gonderilir.
- L7 proxy arkasinda rate limit gercek client IP'sini (`X-Forwarded-For`) kullanir, mesh NAT IP'sini degil.
- Production CORS allowlist'inde origin'ler `https://` scheme'lidir; `http://` origin reddedilir.
- Swarm healthcheck container icine duz HTTP ile `/health/ready`'e vurur; `start_period` startup smoke-check suresinden uzundur.
- `/health/live` DB/Redis kapali olsa bile process ayaktaysa cevap verebilir.
- `/health/ready` DB veya Redis sorununda `503` doner.
- Basarili `/health/*` probe'lari HTTP access log noise uretmez.
- HTTP loglarindaki `reqId`, response `x-request-id` ve `res.locals.requestId` ayni degerdir.
- API route'lari `/api` altinda calisir.
- `/api` disi bilinmeyen bir URL'e malformed body POST edilince `400/413` degil `404` doner (body parser `/api` altinda).
- Health endpointleri rate limit'e ve body parser'a takilmaz.
- `OPTIONS` preflight requestleri rate limit sayacina dahil edilmez.
- Express 5 async route handler icinde throw/reject edilen hata global error handler'a duser.
- `res.headersSent` iken error handler kendi response'unu yazmaz, Express default handler'a delegate eder.
- Readiness testleri `checkDb`/`checkRedis` fake'lenerek gercek DB/Redis olmadan calisir.
- CSRF middleware'i safe method'lari (GET/HEAD/OPTIONS) gecirir; token endpoint kilitlenmez.
- `saveUninitialized: false` ile login oncesi anonim istek Redis'e session yazmaz/`Set-Cookie` uretmez; session'a yazan istek (session-bound CSRF token endpoint secilirse) `Set-Cookie` uretir.
- `npm test` ile `node:test` testleri calisir.
- Structured loglarda `authorization`, `cookie`, `password` ve `token` alanlari maskelenir.

## References

- Node.js HTTP server lifecycle, `server.closeAllConnections()` ve `unref()`/`exit` semantigi.
- Node `uncaughtException`/`unhandledRejection` sonrasi process state ve guvenli exit onerisi.
- Express 5 async error forwarding, `res.headersSent` ve error handling davranisi.
- Zod env validation ve coercion davranisi.
- Express session middleware pipeline; `resave`/`saveUninitialized`/`secret` rotation davranisi.
- connect-redis guncel RedisStore API'si ve key `prefix`.
- redis client `reconnectStrategy`, `disableOfflineQueue` ve connect/command timeout.
- express-rate-limit v8 store API'si, `validate`/`trust proxy` etkilesimi ve rate-limit-redis uyumu.
- pino-http `genReqId`, request id ve autoLogging configuration.
- Docker Swarm rolling update (`update-config.order`, `failure-action`) ve `stop-grace-period`.
- Iliskili plan: `1_USERS_ACCOUNTS_V2_PLAN.md` (Passport Local strategy, session invalidation, auth rate limit davranislari).
