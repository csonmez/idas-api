import helmet from 'helmet'

export const createHelmetMiddleware = () => {
	return helmet()
}
