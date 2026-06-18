import pino from 'pino'

const LOG_LEVEL = 'info'

const REDACT_PATHS = [
	'req.headers.authorization',
	'req.headers.cookie',
	'req.body.password',
	'req.body.token',
	'req.body.passwordConfirm',
	'req.body.currentPassword',
	'req.body.newPassword'
]

export const logger = pino({
	level: LOG_LEVEL,
	redact: {
		paths: REDACT_PATHS,
		censor: '[REDACTED]'
	}
})

export const flushLogger = async () => {
	await new Promise<void>((resolve, reject) => {
		logger.flush((error) => {
			if (error) {
				reject(error)
				return
			}

			resolve()
		})
	})
}
