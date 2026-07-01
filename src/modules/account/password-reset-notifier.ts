/**
 * Password reset notification adapter (Plan Mimari Karar 8).
 *
 * Account service provider'a doğrudan bağlanmaz; bu interface üzerinden
 * inject edilir. Queue altyapısı henüz olmadığı için (kapsam dışı),
 * fake/dev adapter senkron çalışır. Gerçek provider adapter'ı ileride
 * `communication` modülünde kurulmalıdır.
 */
export type PasswordResetNotifier = {
	enqueuePasswordResetEmail(input: { userId: string; emailDigest: string; resetUrl: string }): Promise<void>
}

/**
 * Dev/test ortamı için fake notifier. Hiçbir şey yapmaz, her zaman başarılı.
 * Timing oracle riski dev/test ortamında kabul edilebilir.
 */
export const createFakePasswordResetNotifier = (): PasswordResetNotifier => ({
	async enqueuePasswordResetEmail() {
		// no-op: queue altyapısı henüz yok (kapsam dışı)
	}
})
