/**
 * Hata eşleme. Veritabanı fonksiyonları kullanıcıya gösterilebilir Türkçe mesajı
 * `message`, makine kodunu `hint` alanında döndürür (bkz. private.fail).
 */
export type AppErrorCode =
  | 'not_authenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'module_disabled'
  | 'network'
  | 'unknown';

const KNOWN: readonly AppErrorCode[] = ['not_authenticated', 'forbidden', 'not_found', 'invalid', 'conflict', 'module_disabled'];

export class AppError extends Error {
  readonly code: AppErrorCode;
  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export const NETWORK_ERROR_MESSAGE = 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.';
export const UNKNOWN_ERROR_MESSAGE = 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.';

interface PgLikeError {
  message?: string;
  hint?: string | null;
  code?: string;
  status?: number;
  name?: string;
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = (e ?? {}) as PgLikeError;
  const hint = err.hint ?? undefined;
  if (hint && (KNOWN as readonly string[]).includes(hint)) {
    return new AppError(hint as AppErrorCode, err.message ?? UNKNOWN_ERROR_MESSAGE);
  }
  if (err.code === '42501') return new AppError('forbidden', 'Bu işlem için yetkiniz yok.');
  if (err.code === 'PGRST301' || err.status === 401) return new AppError('not_authenticated', 'Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.');
  const msg = String(err.message ?? '');
  if (err.name === 'TypeError' || /fetch failed|Failed to fetch|Network request failed|NetworkError/i.test(msg)) {
    return new AppError('network', NETWORK_ERROR_MESSAGE);
  }
  return new AppError('unknown', UNKNOWN_ERROR_MESSAGE);
}
