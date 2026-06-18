import cors from 'cors'

const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:3001']

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
