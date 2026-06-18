import { createClient } from 'redis'

const CONNECT_TIMEOUT_MS = 5_000
const COMMAND_TIMEOUT_MS = 5_000
const MAX_RECONNECT_DELAY_MS = 3_000

export const createRedisClient = (url: string) => {
	const client = createClient({
		url,
		socket: {
			connectTimeout: CONNECT_TIMEOUT_MS,
			reconnectStrategy: (retries) => {
				if (retries > 10) {
					return new Error('Redis reconnect limit reached')
				}

				return Math.min(retries * 200, MAX_RECONNECT_DELAY_MS)
			}
		},
		disableOfflineQueue: true
	})

	client.on('error', () => {
		// Connection errors are surfaced by command failures and readiness checks.
	})

	return client
}

export type RedisClient = ReturnType<typeof createRedisClient>

export const withCommandTimeout = async <T>(promise: Promise<T>, timeoutMs = COMMAND_TIMEOUT_MS): Promise<T> => {
	let timer: NodeJS.Timeout | undefined

	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => {
					reject(new Error('Redis command timed out'))
				}, timeoutMs)
			})
		])
	} finally {
		clearTimeout(timer)
	}
}
