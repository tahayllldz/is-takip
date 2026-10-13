/**
 * Logo görüntüsü: PNG çözme (saf JS; Expo Go'da yerel modül gerektirmez) ve doğrulama.
 * Mobil uygulama logoyu önce küçültüp PNG'ye çevirir (expo-image-manipulator), sonra burada
 * piksellerini okuyup `analyzeLogoPixels` ile renklerini çıkarır.
 */
import UPNG from 'upng-js';

export const LOGO_MIN_SIDE = 64;
export const LOGO_ACCEPTED_TYPES = ['image/png', 'image/jpeg'] as const;

/** Seçilen dosyanın türü ve boyutu uygun mu; uygun değilse Türkçe neden */
export function logoFileProblem(f: { mimeType?: string | null; width?: number | null; height?: number | null; fileSize?: number | null }): string | null {
  const type = (f.mimeType ?? '').toLowerCase();
  if (type === 'image/svg+xml') return 'SVG logolar desteklenmiyor. Logonun PNG veya JPEG hâlini seçin.';
  if (type && !(LOGO_ACCEPTED_TYPES as readonly string[]).includes(type)) return 'Logo PNG veya JPEG olmalı.';
  if (f.fileSize != null && f.fileSize > 15 * 1024 * 1024) return 'Görüntü çok büyük (en fazla 15 MB). Daha küçük bir dosya seçin.';
  if (f.width != null && f.height != null && Math.min(f.width, f.height) < LOGO_MIN_SIDE) {
    return `Logo en az ${LOGO_MIN_SIDE}×${LOGO_MIN_SIDE} piksel olmalı; daha büyük bir görüntü seçin.`;
  }
  return null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]+,/, '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]!);
    const b = B64.indexOf(clean[i + 1] ?? 'A');
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]!) : -1;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]!) : -1;
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((v, i) => bytes[i] === v);
}

/** PNG baytları → RGBA pikseller (satır satır, piksel başına 4 bayt) */
export function decodePng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  if (!isPng(bytes)) throw new Error('Görüntü PNG değil.');
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const img = UPNG.decode(buf);
  const frames = UPNG.toRGBA8(img);
  if (!frames.length) throw new Error('Görüntü okunamadı.');
  return { width: img.width, height: img.height, rgba: new Uint8Array(frames[0]!) };
}
