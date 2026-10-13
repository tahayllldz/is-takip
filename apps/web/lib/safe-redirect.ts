/** Açık yönlendirme açığını önler: yalnızca site içi göreli yollar kabul edilir. */
export function safeNext(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
