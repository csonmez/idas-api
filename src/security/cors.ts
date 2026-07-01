import cors from 'cors'

class CorsError extends Error {
	status = 403

	constructor() {
		super('Not allowed by CORS')
		this.name = 'CorsError'
	}
}

export const createCorsMiddleware = (allowedOrigins: readonly string[]) => {
	return cors({
		credentials: true,
		origin: (origin, callback) => {
			if (!origin || allowedOrigins.includes(origin)) {
				callback(null, true)
				return
			}

			callback(new CorsError())
		},
		allowedHeaders: ['content-type', 'authorization', 'x-csrf-token', 'x-request-id'],
		exposedHeaders: ['x-request-id']
	})
}
