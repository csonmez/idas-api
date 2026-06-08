# Server & App Bootstrap V2 Plani

## Summary

V2'de HTTP uygulamasi iki ana sorumluluga ayrilacak:

- `src/server.ts`: runtime/process bootstrap.
- `src/app.ts`: saf Express app factory ve middleware pipeline.

Redis, PostgreSQL/Kysely ve Passport kullanilacak; ancak bu bagimliliklar dogrudan her dosyaya dagitilmayacak. `server.ts` dis kaynaklari hazirlayacak, `app.ts` bu hazir bagimliliklarla Express uygulamasini olusturacak.

Bu ayrim test edilebilirlik, graceful shutdown, session yonetimi ve ileride background job / scheduler / websocket gibi yeni runtime'lar eklenmesi icin temel olacak.

Bu plan production bootstrap'i hedefler. Bu nedenle graceful shutdown, startup readiness, CSRF, structured logging, rate limiting ve session invalidation konulari temel kapsamdadir; "ileride bakilacak" teknik borc olarak birakilmayacak.

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
- `auth/passport.ts` Passport strategy, serialize ve deserialize setup'ini tek yerde tutacak.
- `auth/session.ts` Express session middleware factory'sini tutacak.
- `auth/csrf.ts` cookie/session auth icin CSRF korumasini tutacak.
- `logger` katmani structured logger ve HTTP request logging sorumlulugunu tasiyacak.
- `security` katmani CORS, helmet ve rate limit factory'lerini tutacak.

## `server.ts`

`server.ts` uygulamanin process/runtime giris noktasi olacak.

Sorumluluklar:

- Env/config validation'i calistirmak.
- PostgreSQL/Kysely singleton client'i import etmek.
- Startup sirasinda DB connectivity check yapmak.
- Redis client'i connect etmek.
- Startup sirasinda Redis connectivity check yapmak.
- Passport'u configure etmek.
- `createApp(...)` ile Express app'i olusturmak.
- HTTP server'i baslatmak.
- Graceful shutdown akisini yonetmek.
- `SIGINT`, `SIGTERM`, `unhandledRejection`, `uncaughtException` gibi process event'lerini ele almak.
- Startup ve runtime server error'larini structured logger ile loglamak.

Yapmamasi gerekenler:

- Route tanimlamak.
- Feature/service importlarini daginik sekilde toplamak.
- Middleware pipeline'i kurmak.
- Passport LocalStrategy detaylarini inline yazmak.
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
import { logger } from './logger/index.ts'

const main = async () => {
	const config = readEnv()
	let isReady = false
	let isShuttingDown = false

	await connectRedis()
	await redisClient.ping()
	await sql`select 1`.execute(db)
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

		const closeConnectionsTimer = setTimeout(() => {
			logger.warn('Forcing open HTTP connections to close')
			server.closeAllConnections?.()
		}, config.shutdownCloseConnectionsAfterMs)

		closeConnectionsTimer.unref()

		const forceExitTimer = setTimeout(() => {
			logger.error('Graceful shutdown timed out')
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
	process.exit(1)
})
```

Notlar:

- `server.close()` yeni request kabulunu durdurur, mevcut requestlerin bitmesine izin verir.
- Shutdown sirasinda once HTTP server kapatilacak, sonra Redis ve DB connection'lari kapatilacak.
- Shutdown idempotent olacak; iki signal geldiginde cleanup iki kez calismayacak.
- Shutdown basladiginda readiness false olacak.
- Shutdown icin maksimum bekleme timeout'u olacak. Ornegin 15 saniye sonra process `exit(1)` ile zorla kapanacak.
- Graceful bekleme suresinin bir noktasinda `server.closeAllConnections?.()` cagrilacak.
- `server.closeAllConnections()` hemen degil, once mevcut requestlerin bitmesine izin verecek kisa bir beklemeden sonra cagrilacak.
- `server.closeAllConnections()` Node 18.2+ ile kullanilabilir; optional chaining runtime uyumu icin korunacak.
- `uncaughtException` sonrasinda process sagliksiz kabul edilmeli ve graceful shutdown denenmelidir.
- `unhandledRejection` fatal kabul edilip shutdown tetikleyecek.
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
- CSRF korumasini mutating route'lara uygulamak.
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
- Passport strategy detaylarini inline kurmak.

Onerilen skeleton:

```ts
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import passport from 'passport'
import type { Kysely } from 'kysely'
import type { RedisClientType } from 'redis'
import routes from './routes/index.ts'
import { createSessionMiddleware } from './auth/session.ts'
import { csrfProtection } from './auth/csrf.ts'
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

export const createApp = (deps: AppDependencies) => {
	const app = express()

	app.set('trust proxy', deps.config.trustProxy)

	app.use(requestIdMiddleware)
	app.use(httpLogger)
	app.use(helmet(deps.config.helmet))
	app.use(cors(deps.config.cors))
	app.use(cookieParser())
	app.use(express.json({ limit: deps.config.jsonLimit }))
	app.use(express.urlencoded({ extended: true }))

	app.get('/health/live', (_req, res) => res.status(204).end())
	app.get('/health/ready', async (_req, res) => {
		if (!deps.isReady()) {
			res.status(503).end()
			return
		}

		// DB select 1 ve Redis ping burada yapilacak.
		res.status(204).end()
	})

	app.use('/api/auth', authRateLimit)
	app.use('/api', apiRateLimit)
	app.use('/api', createSessionMiddleware(deps))
	app.use('/api', passport.initialize())
	app.use('/api', passport.session())
	app.use('/api', csrfProtection)
	app.use('/api', routes)

	app.use(notFoundHandler)
	app.use(errorHandler)

	return app
}
```

## Middleware Order

Onerilen siralama:

```text
trust proxy
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
csrf protection
api routes
not found handler
global error handler
```

Notlar:

- `session` Passport session'dan once gelmeli.
- `passport.initialize()` ve `passport.session()` route'lardan once gelmeli.
- Error handler en sonda olmali.
- 404 handler API route'lardan sonra, global error handler'dan once gelmeli.
- Audit/session context gibi request bazli middleware'ler auth middleware'lerinden sonra route seviyesinde uygulanabilir.
- Health endpointleri rate limit ve auth middleware'lerinin disinda kalmali.
- IP tabanli rate limit session/Passport'tan once calisarak Redis session store ve DB deserialize maliyetini azaltmali.
- Auth rate limit genel API rate limitinden daha siki olmali.
- CSRF korumasi `GET`, `HEAD`, `OPTIONS` gibi safe method'lari bypass etmeli; `POST`, `PUT`, `PATCH`, `DELETE` icin zorunlu olmali.
- CSRF middleware route'lardan once, session ve Passport'tan sonra calismali.

## Redis

Redis temel olarak session store icin kullanilacak.

Sorumluluklar:

- Tek bir Redis client singleton veya controlled factory olusturmak.
- `connectRedis()` ve `disconnectRedis()` fonksiyonlari saglamak.
- Session store icin client export etmek.
- Redis eventlerini loglamak: `connect`, `ready`, `error`, `end`, `reconnecting`.

Onerilen env'ler:

```text
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TLS=false
REDIS_SESSION_PREFIX=idas:sess:
```

Karar:

- Mumkunse `REDIS_URL` birincil config olsun.
- Host/port/password degerleri `REDIS_URL` yoksa fallback olarak kullanilsin.
- Redis session prefix `idas:sess:` olacak.
- V1'deki `ardek:sess:` prefix'i v2 icin kullanilmayacak.
- `connect-redis` icin guncel major API pinlenecek.
- Hedef API: `import { RedisStore } from 'connect-redis'` ve `new RedisStore({ client, prefix })`.
- `@types/connect-redis` kurulmayacak; paket kendi tiplerini saglar.

## Session

Session storage Redis uzerinden yapilacak.

Session davranisi:

- Idle timeout uygulanacak.
- Kullanici aktifse session kontrollu sekilde uzatilacak.
- Absolute session lifetime ayrica degerlendirilecek.
- Password reset, user inactive ve kritik auth version degisikliklerinde session gecersiz kilinacak.

Onerilen session config:

```ts
session({
	store: new RedisStore({
		client: deps.redisClient,
		prefix: deps.config.redisSessionPrefix
	}),
	name: 'idas.sid',
	secret: deps.config.sessionSecrets,
	resave: false,
	saveUninitialized: false,
	rolling: false,
	cookie: {
		httpOnly: true,
		secure: deps.config.isProduction,
		sameSite: deps.config.sessionSameSite,
		maxAge: deps.config.sessionIdleTimeoutMs,
		domain: deps.config.sessionCookieDomain
	}
})
```

Notlar:

- `saveUninitialized: false` olmali.
- `resave: false` olmali.
- Cookie `httpOnly` olmali.
- Production'da HTTPS varsa `secure: true` olmali.
- Cross-site frontend/API kullaniliyorsa production'da `sameSite: 'none'` + `secure: true` gerekir.
- `sameSite: 'none'` kullanildigi anda CSRF korumasi zorunludur.
- Local development icin `sameSite: 'lax'` daha sorunsuzdur.
- Session secret zorunlu env olmali; default secret olmamali.
- Secret rotasyonu icin `SESSION_SECRETS` comma-separated array olarak okunacak.
- Array'in ilk elemani yeni session'lari imzalar; eski elemanlar mevcut cookie'leri dogrulamak icin tutulur.
- Session icine minimal bilgi yazilmali.
- Session icine user objesi degil, user id ve gerekiyorsa auth/session version gibi minimal metadata yazilmali.
- `SESSION_COOKIE_DOMAIN` default `undefined` olacak. `app.example.com` ve `api.example.com` gibi subdomain paylasimi gerekiyorsa `.example.com` olarak bilincli set edilecek.
- Sliding session icin V1'deki `smartRollingMiddleware` fikri korunacak ama daha net isim ve testlerle uygulanacak.
- Onerilen ilk karar: idle timeout 24 saat, expiry son 1 saate girdiyse uzatma.
- Absolute lifetime gerekiyorsa session icine `createdAt` yazilip 7-14 gun gibi ust limit uygulanacak.

Onerilen env'ler:

```text
SESSION_SECRETS=current-secret,previous-secret
SESSION_COOKIE_NAME=idas.sid
SESSION_COOKIE_DOMAIN=
SESSION_COOKIE_SAME_SITE=lax
SESSION_IDLE_TIMEOUT_MS=86400000
SESSION_REFRESH_THRESHOLD_MS=3600000
SESSION_ABSOLUTE_TIMEOUT_MS=1209600000
```

## CSRF

Cookie + session tabanli auth kullanildigi icin CSRF korumasi temel kapsamda olacak.

Kararlar:

- `GET`, `HEAD`, `OPTIONS` safe method kabul edilecek ve CSRF kontrolunden muaf olacak.
- `POST`, `PUT`, `PATCH`, `DELETE` icin CSRF kontrolu zorunlu olacak.
- `sameSite: 'none'` kullaniliyorsa CSRF token veya signed double-submit korumasi olmadan production deploy yapilmayacak.
- CSRF token response payload'i veya ayri endpoint uzerinden frontend'e saglanacak.
- SPA istekleri token'i custom header ile gonderecek.
- Ek savunma olarak mutating requestlerde `Origin` header allowlist kontrolu yapilacak.

Onerilen yaklasim:

- Signed double-submit cookie veya synchronizer token pattern secilecek.
- Double-submit cookie secilirse token imzali olacak; salt/session id ile baglanacak.
- CSRF cookie `httpOnly: false` olabilir, cunku SPA token'i okuyup header'a koyacak.
- Session cookie `httpOnly: true` kalacak.

Onerilen env'ler:

```text
CSRF_COOKIE_NAME=idas.csrf
CSRF_HEADER_NAME=x-csrf-token
CSRF_COOKIE_SAME_SITE=lax
CSRF_COOKIE_SECURE=true
```

## Passport

Passport setup'i `auth/passport.ts` icinde toplanacak.

Sorumluluklar:

- LocalStrategy tanimlamak.
- Email normalize etmek.
- Kullanici ve credential lookup yapmak.
- Password verify yapmak.
- `serializeUser` ile sadece `user.id` saklamak.
- `deserializeUser` ile request basina guvenli user payload'ini DB'den cekmek.

Best practice kararlar:

- Session'a komple user objesi yazilmayacak.
- `serializeUser` sadece `user.id` yazacak.
- `deserializeUser` aktif kullaniciyi, rollerini ve akademik baglarini minimal select ile cekecek.
- `deserializeUser` user inactive veya soft-deleted ise `done(null, false)` donecek.
- Inactive/deleted user durumunda session destroy edilecek veya ilk auth middleware'de gecersiz kilinacak.
- User role/permission degisiklikleri yeni login beklemeden requestlerde yansiyacak.
- Password hash `users` tablosunda degil, `user_credentials` tablosunda olacak.
- Login hatalari disariya generic donecek.
- Inactive user login olamayacak.
- `deserializeUser` sicak yol oldugu icin secilen select minimal, index dostu ve cache'e hazir tasarlanacak.

Onerilen LocalStrategy akisi:

1. Email `trim().toLowerCase()` ile normalize edilir.
2. `users` tablosundan aktif user bulunur.
3. User yoksa generic auth failure.
4. User inactive ise generic auth failure.
5. `user_credentials` kaydi bulunur.
6. Credential yoksa generic auth failure.
7. Account lock varsa generic auth failure.
8. Password verify edilir.
9. Basarili login sonrasi login security state guncellenir.
10. Hatali login sonrasi failed count / lock state guncellenir.

Deserialize akisi:

1. Session'daki `user.id` okunur.
2. Kisa TTL'li auth snapshot cache aktifse once Redis cache okunur.
3. Cache miss durumunda DB'den minimal user payload cekilir.
4. User yoksa, deleted ise veya inactive ise auth false kabul edilir.
5. Session icindeki `authVersion` ile DB/cache payload'indaki `authVersion` uyusmuyorsa auth false kabul edilir.
6. User payload'i `req.user` icin guvenli shape'e normalize edilir.

Performans karari:

- Ilk fazda DB'den minimal select ile deserialize kabul edilebilir.
- Ancak bu tradeoff dokumante edilir ve query hot path kabul edilir.
- Olcek ihtiyacinda Redis auth snapshot cache eklenecek.
- Cache TTL 30-60 saniye gibi kisa tutulacak.
- Role/permission veya akademik bag degisikliklerinde `users.auth_version` benzeri bir deger artirilacak.
- Session icindeki eski `authVersion` cache olsa bile invalidation saglayacak.
- Password reset ve admin force logout icin user bazli session invalidation stratejisi ayrica kurulacak.

## PostgreSQL / Kysely

DB client lifecycle `database/client.ts` tarafinda olacak.

`server.ts` DB ile ilgili sadece sunlari bilmeli:

- `db` uygulama singleton'idir.
- `closeDb()` graceful shutdown'da cagirilir.

Notlar:

- Feature/service dosyalari kendi pool'unu olusturmayacak.
- Testlerde singleton yerine `createDb(TEST_DATABASE_URL)` tercih edilecek.
- Health readiness endpointi basit bir `select 1` ile DB durumunu kontrol edebilir.
- DB baglanti hatasi uygulama startup'inda erken fark edilmeli.
- `server.ts` icinde `await sql\`select 1\`.execute(db)` ile fail-fast check yapilacak.
- DB startup check gecmeden HTTP server listen etmeyecek.

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
- Redis ping kontrolu yapar.
- Basariliysa `204 No Content`.
- Basarisizsa `503 Service Unavailable`.
- Shutdown basladiginda readiness false doner.
- Health endpointleri session, Passport ve rate limit disinda kalir.

## Logging

Production'da `console.log` ana logging stratejisi olmayacak.

Kararlar:

- Structured logger kullanilacak.
- Onerilen paketler: `pino` ve `pino-http`.
- Tüm startup, shutdown, health failure, server error ve unexpected error loglari structured olacak.
- Her request icin request id uretilecek veya upstream request id korunacak.
- HTTP access loglari request id ile iliskilendirilecek.
- Health endpoint loglari noise yaratirsa dusuk seviyeye alinacak veya filtrelenecek.
- Hassas alanlar logger seviyesinde redact edilecek.

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

Notlar:

- Local development'ta pretty log opsiyonel olabilir.
- Production log format'i JSON olmali.
- Error objeleri `{ error }` alaniyla structured loglanmali.
- Stack trace production logunda kalabilir; response'a sizdirilmeyecek.

## Error Handling

V2 icin hedef:

- Controller'larda try/catch tekrarini azaltmak.
- Async route handler wrapper kullanmak.
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

- `password`, `token`, `authorization`, `cookie` gibi alanlar loglarda maskelenmeli.
- Error log DB'ye yazilacaksa bu islem response'u bloke etmeyecek sekilde tasarlanmali.
- Validation error, auth error, domain error ve unexpected error ayrilacak.
- Error handler structured logger kullanacak.
- `res.headersSent` durumunda Express default error akisi dikkate alinacak.
- `uncaughtException` ve `unhandledRejection` HTTP error handler ile cozulmeyecek; `server.ts` fatal shutdown akisini tetikleyecek.

## CORS

Production'da allowlist kullanilacak.

Onerilen env:

```text
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

Kararlar:

- Development'ta origin esnek olabilir.
- Production'da bilinmeyen origin'e izin verilmeyecek.
- `credentials: true` kullanilacagi icin wildcard origin (`*`) kullanilmayacak.
- Allowed origins config parse edilirken bos stringler filtrelenecek.
- `Origin` kontrolu CSRF icin de kullanilacak.

## Trust Proxy

`trust proxy` cookie security, IP tespiti, audit log ve rate limit icin kritik ayardir.

Kararlar:

- Default development degeri `false` veya `loopback` olabilir.
- Reverse proxy/load balancer arkasinda production degeri bilincli set edilecek.
- V1'deki sabit `1` degeri v2'de env/config uzerinden yonetilecek.
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
- Auth endpointleri icin genel API limitinden daha siki limit uygulanacak.
- Login ve password reset endpointleri icin ayri limit kullanilacak.
- Account-level `locked_until` brute-force savunmasi ile IP/global rate limit birbirinin yerine gecmez; ikisi birlikte kullanilacak.

Onerilen paket:

```text
rate-limit-redis
```

Onerilen env'ler:

```text
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=300
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=10
PASSWORD_RESET_RATE_LIMIT_MAX=5
```

## Implementation Order

1. `src/config/env.ts` eklenecek.
2. `.env.example` Redis, session, CORS ve server env'leriyle guncellenecek.
3. `compose.dev.yml` icine Redis servisi eklenecek.
4. Gerekli paketler eklenecek:
   - `redis`
   - `connect-redis`
   - `express-session`
   - `cookie-parser`
   - `passport`
   - `passport-local`
   - `pino`
   - `pino-http`
   - `rate-limit-redis`
   - CSRF icin secilecek paket veya local helper
5. Gerekli type paketleri eklenecek:
   - `@types/express-session`
   - `@types/cookie-parser`
   - `@types/passport`
   - `@types/passport-local`
6. `connect-redis` major versiyonu ve import API'si pinlenecek.
7. `src/logger/index.ts` ve `src/logger/http-logger.ts` eklenecek.
8. `src/cache/redis.ts` eklenecek.
9. `src/security/cors.ts`, `src/security/helmet.ts`, `src/security/rate-limit.ts` eklenecek.
10. `src/auth/session.ts` eklenecek.
11. `src/auth/csrf.ts` eklenecek.
12. `src/auth/passport.ts` eklenecek.
13. `src/app.ts` `createApp(deps)` factory olarak eklenecek.
14. `src/server.ts` runtime bootstrap olarak eklenecek.
15. `src/routes/index.ts` minimum route aggregator olarak eklenecek.
16. Health endpointleri eklenecek.
17. Error ve not-found middlewareleri eklenecek.
18. Auth login/logout route'lari Passport session ile entegre edilecek.
19. Startup DB `select 1` ve Redis `ping` checkleri eklenecek.
20. Graceful shutdown icin idempotency, force timeout ve `closeAllConnections` akisi eklenecek.
21. Session sliding refresh middleware'i eklenecek.
22. `deserializeUser` inactive/deleted user davranisi ve session invalidation netlestirilecek.
23. `npm run typecheck` ile tipler dogrulanacak.
24. Redis/PostgreSQL ayakta iken local startup test edilecek.
25. Shutdown, EADDRINUSE, readiness ve CSRF smoke testleri yapilacak.

## Best Practices

- `app.ts` test edilebilir ve yan etkisi az bir factory olacak.
- `server.ts` process lifecycle disinda domain davranisi tasimayacak.
- Redis connection `app.ts` icinde baslatilmayacak.
- Passport strategy `app.ts` icinde inline yazilmayacak.
- Session'a sadece user id yazilacak.
- `deserializeUser` guvenli ve minimal user payload'i uretmekten sorumlu olacak.
- Inactive/deleted user deserialize sirasinda auth disina dusurulecek.
- DB ve Redis shutdown sirasi kontrollu olacak.
- Graceful shutdown idempotent olacak ve hard timeout icerecek.
- Startup DB/Redis connectivity check gecmeden HTTP listen edilmeyecek.
- Env validation uygulama basinda fail-fast davranacak.
- Production CORS wildcard olmayacak.
- Cookie/session auth kullanildigi icin CSRF korumasi uygulanacak.
- `sameSite: 'none'` CSRF olmadan kullanilmayacak.
- Cookie ayarlari environment'a gore bilincli yapilacak.
- `SESSION_SECRETS` eksikse uygulama baslamayacak.
- Session secret rotation desteklenecek.
- Sliding session davranisi bilincli secilecek ve test edilecek.
- Logger structured olacak; production ana logger'i `console.log` olmayacak.
- Rate limit temel middleware olarak kurulacak; production multi-instance icin Redis store kullanilacak.
- `trust proxy` production topology'ye gore bilincli set edilecek.
- Feature service dosyalari HTTP server, process signal veya Redis client lifecycle bilmeyecek.
- Health endpointleri API route'larindan bagimsiz olacak.
- Testlerde Redis/DB bagimliligi mock veya test instance ile verilebilecek.

## V1'den Alinan Dersler

V1'de iyi olan kisimlar:

- `server.ts` ile `source/app.ts` ayrimi var.
- Graceful shutdown icinde DB ve Redis disconnect dusunulmus.
- Session storage Redis uzerinden yapiliyor.
- Passport LocalStrategy kullaniliyor.

V2'de iyilestirilecek kisimlar:

- Redis connect `app.ts` icinde yapilmayacak.
- Passport strategy `app.ts` icinde inline olmayacak.
- Session'a komple user objesi yazilmayacak.
- `server.ts` sadece runtime orchestration yapacak.
- App factory dependency alacak, testlerde daha kolay kurulacak.
- CORS production davranisi net allowlist olacak.
- V1'deki smart rolling fikri v2'de daha net sliding session middleware'i olarak tasarlanacak.
- V1'deki inline Passport/Redis bootstrap kodu ayrilacak.

## Open Decisions

- Path alias kullanilacak mi (`@/auth`, `@/routes` gibi)?
- Error log DB tablosu ilk fazda mi, audit/log migrationlari sonrasi mi eklenecek?
- Redis session invalidation icin userId -> sessionId index'i ilk fazda kurulacak mi?
- Auth snapshot cache ilk fazda mi eklenecek, yoksa minimal DB select ile mi baslanacak?
- Sliding session absolute lifetime kac gun olacak?
- CSRF icin signed double-submit mi, synchronizer token mi kullanilacak?

## Resolved Decisions

- Request id middleware'i ilk fazda eklenecek.
- Login/auth rate limit ilk fazda eklenecek.
- Production rate limit Redis store kullanacak.
- Session secret rotation `SESSION_SECRETS` array'i ile desteklenecek.
- Startup DB/Redis readiness check zorunlu olacak.
- Graceful shutdown hard timeout ve idempotency guard icerecek.

## Verification Checklist

- `DATABASE_URL` yanlisken app listen etmeden `exit(1)` ile kapanir.
- Redis kapaliyken app listen etmeden `exit(1)` ile kapanir.
- Port doluyken `EADDRINUSE` structured loglanir ve process `exit(1)` yapar.
- `SIGTERM` geldiginde readiness hemen `503` doner.
- `SIGTERM` sonrasi HTTP server yeni request kabul etmez.
- Keep-alive connection acikken shutdown hard timeout calisir.
- Iki kez `SIGINT` geldiginde cleanup ikinci kez calismaz.
- `unhandledRejection` ve `uncaughtException` fatal shutdown tetikler.
- `/health/live` DB/Redis kapali olsa bile process ayaktaysa cevap verebilir.
- `/health/ready` DB veya Redis sorununda `503` doner.
- Login endpoint auth rate limit'e takilabilir.
- Health endpointleri rate limit'e takilmaz.
- `sameSite: 'none'` config'i CSRF korumasi olmadan production'da kabul edilmez.
- Mutating request CSRF token olmadan reddedilir.
- `GET` request CSRF token gerektirmez.
- User `INACTIVE` yapildiktan sonra mevcut session sonraki requestte auth disina duser.
- Session expiry son threshold'a girdiginde sliding refresh uygulanir.
- Structured loglarda `authorization`, `cookie`, `password` ve `token` alanlari maskelenir.

## References

- Node.js HTTP server lifecycle ve `server.closeAllConnections()`.
- Express session middleware, secret rotation ve cookie ayarlari.
- connect-redis guncel RedisStore API'si.
- OWASP CSRF Prevention Cheat Sheet.
- Express `trust proxy` dokumantasyonu.
