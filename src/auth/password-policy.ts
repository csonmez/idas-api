/**
 * Timing oracle eşitleme için önceden hesaplanmış sabit, non-secret bcrypt hash.
 *
 * User yok / user INACTIVE / credential kaydı yok dallarında, gerçek credential
 * hash bulunmasa bile aynı cost factor ile üretilmiş bu hash'e karşı `bcrypt.compare`
 * çalıştırılır ve sonuç yok sayılır. Amaç, gerçek credential varlığında çalışan bcrypt
 * maliyetini no-user/no-credential dallarında da çalıştırarak email/account existence
 * bilgisinin yanıt süresinden sızmasını zorlaştırmaktır. Runtime'da her request'te
 * üretilmez.
 *
 * Cost factor config.auth.bcryptRounds ile uyumlu olmalıdır. getDummyHash(bcryptRounds)
 * ilk çağrıda hashSync ile üretir ve cache'ler; bcryptRounds değişirse yeniden üretir.
 */
import { hashSync } from 'bcryptjs'

let cachedRounds: number | null = null
let cachedDummyHash: string | null = null

/**
 * Verilen bcryptRounds için dummy hash döner. Aynı rounds değeri için cache'lenir;
 * rounds değişirse yeniden üretilir. Üretim bir kez çalışır (hashSync), her request'te değil.
 */
export const getDummyHash = (bcryptRounds: number): string => {
	if (cachedRounds !== bcryptRounds || cachedDummyHash === null) {
		cachedRounds = bcryptRounds
		cachedDummyHash = hashSync('', bcryptRounds)
	}
	return cachedDummyHash
}
