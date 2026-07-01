import { z } from 'zod'

/**
 * POST /api/account/session — email/password ile session oluştur.
 *
 * Email normalize: trim + lowercase. Password min 1 (boş olmama); kapsamlı
 * password policy (min 15, byte limit) password reset/set schemas'ta uygulanır.
 */
export const createSessionBodySchema = z.object({
	email: z.string().trim().toLowerCase().email('Geçerli bir e-posta adresi gerekli.'),
	password: z.string().min(1, 'Şifre zorunludur.')
})

export type CreateSessionBody = z.infer<typeof createSessionBodySchema>

/**
 * bcrypt yalnızca parolanın ilk 72 byte'ını dikkate alır; bunun üstündeki
 * karakterler sessizce yok sayılır. Algoritmanın değişmez limiti olduğu için
 * config'ten değil buradan gelir; kullanıcıya sessiz truncation yerine hata döneriz.
 */
const PASSWORD_MAX_BYTE_LENGTH = 72

/**
 * POST /api/account/password-resets — token ile parola set/reset tamamlama.
 *
 * Password: min uzunluk config'ten (config.auth.passwordMinLength), max 72 byte
 * (bcrypt limiti). Token: min 1 (boş olmama; raw token loglanmaz, hash ile lookup yapılır).
 */
export const createCompletePasswordResetBodySchema = (passwordMinLength: number) =>
	z.object({
		token: z.string().min(1, 'Token zorunludur.'),
		password: z
			.string()
			.min(passwordMinLength, `Parola en az ${passwordMinLength} karakter olmalıdır.`)
			.refine(
				(val) => new TextEncoder().encode(val).length <= PASSWORD_MAX_BYTE_LENGTH,
				`Parola en fazla ${PASSWORD_MAX_BYTE_LENGTH} byte olmalıdır (bcrypt limiti).`
			)
	})

export type CompletePasswordResetBody = z.infer<ReturnType<typeof createCompletePasswordResetBodySchema>>

/**
 * POST /api/account/password-reset-requests — reset token talebi oluştur.
 *
 * Sadece email. User var/yok bilgisi sızdırmamak için her durumda 204.
 */
export const createPasswordResetRequestBodySchema = z.object({
	email: z.string().trim().toLowerCase().email('Geçerli bir e-posta adresi gerekli.')
})

export type CreatePasswordResetRequestBody = z.infer<typeof createPasswordResetRequestBodySchema>
