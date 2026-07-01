/**
 * Global tip augmentation'ları: Express.User ve express-session SessionData.
 *
 * Express.User — passport `req.user` payload'ı. Plan Mimari Karar 4: minimal
 * deserialize payload (id, email, status). Authorization için gereken role/scope
 * özeti route/use-case ihtiyacına göre ayrıca DB'den yüklenir; `req.user` şişirilmez.
 *
 * express-session SessionData — CSRF token session'a yazılır (issueCsrfToken).
 * Burada merkezi olarak tanımlanır; session.ts'ten taşındı.
 */

declare global {
	namespace Express {
		interface User {
			id: string
			email: string
			status: 'ACTIVE' | 'INACTIVE'
		}
	}
}

declare module 'express-session' {
	interface SessionData {
		csrfToken?: string
	}
}

export {}
