/**
 * Logo hazırlama (cihazda, yükleme öncesi):
 *   seç → türünü/boyutunu doğrula → en fazla 512 px PNG'ye çevir (saydamlık korunur)
 *   → 96 px kopyanın piksellerinden renkleri çıkar → boş kenar boşluklarını kırp.
 * Dosya yalnızca düzenleyicide "Kaydet"e basılınca özel depoya yüklenir.
 * Hepsi Expo Go'da da çalışır (yerel modül gerektiren renk kitaplığı kullanılmaz).
 */
import { analyzeLogoPixels, type LogoAnalysis } from '@istakip/shared';
import { LOGO_MIN_SIDE, base64ToBytes, decodePng, logoFileProblem } from '@istakip/shared/logo-image';
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export const LOGO_MAX_SIDE = 512;
const ANALYSIS_SIDE = 96;

export interface PreparedLogo {
  /** Yerel önizleme adresi */
  uri: string;
  /** Yüklenecek PNG */
  bytes: Uint8Array;
  width: number;
  height: number;
  analysis: LogoAnalysis;
  /** Boş kenarlar kırpıldı mı */
  trimmed: boolean;
}

export type LogoPick = { ok: true; logo: PreparedLogo } | { ok: false; error: string } | { ok: false; canceled: true };

/** Uzun kenarı `max`'a indirir (küçükse dokunmaz) */
function fit(width: number, height: number, max: number): { width?: number; height?: number } | null {
  if (Math.max(width, height) <= max) return null;
  return width >= height ? { width: max } : { height: max };
}

async function toPng(uri: string, resize: { width?: number; height?: number } | null, crop?: { originX: number; originY: number; width: number; height: number }) {
  let ctx = ImageManipulator.manipulate(uri);
  if (crop) ctx = ctx.crop(crop);
  if (resize) ctx = ctx.resize(resize);
  const ref = await ctx.renderAsync();
  return ref.saveAsync({ format: SaveFormat.PNG, base64: true, compress: 1 });
}

/** Seçilmiş görüntüyü yüklemeye hazırlar; `onStep` ilerleme metnini bildirir */
export async function prepareLogo(
  uri: string,
  meta: { mimeType?: string | null; fileSize?: number | null },
  onStep?: (text: string) => void,
): Promise<LogoPick> {
  const typeProblem = logoFileProblem({ mimeType: meta.mimeType ?? null, fileSize: meta.fileSize ?? null });
  if (typeProblem) return { ok: false, error: typeProblem };
  try {
    onStep?.('Logo hazırlanıyor…');
    const original = await ImageManipulator.manipulate(uri).renderAsync();
    const sizeProblem = logoFileProblem({ width: original.width, height: original.height });
    if (sizeProblem) return { ok: false, error: sizeProblem };

    let png = await toPng(uri, fit(original.width, original.height, LOGO_MAX_SIDE));

    onStep?.('Renkler çıkarılıyor…');
    const small = await toPng(png.uri, fit(png.width, png.height, ANALYSIS_SIDE));
    if (!small.base64) throw new Error('Görüntü verisi okunamadı.');
    const pixels = decodePng(base64ToBytes(small.base64));
    const analysis = analyzeLogoPixels(pixels.rgba, pixels.width, pixels.height);
    if (!analysis.swatches.length || !analysis.bounds) {
      return { ok: false, error: 'Görüntüde ayırt edilebilir bir logo bulunamadı (tamamen saydam veya tek renk). Başka bir dosya seçin.' };
    }

    // Boş kenarlar (saydam veya düz zemin) logonun %8'inden fazlaysa kırp; küçük bir pay bırak
    const b = analysis.bounds;
    const sx = png.width / pixels.width;
    const sy = png.height / pixels.height;
    const padX = Math.round(png.width * 0.02);
    const padY = Math.round(png.height * 0.02);
    const originX = Math.max(0, Math.floor(b.x * sx) - padX);
    const originY = Math.max(0, Math.floor(b.y * sy) - padY);
    const cropW = Math.min(png.width - originX, Math.ceil(b.width * sx) + padX * 2);
    const cropH = Math.min(png.height - originY, Math.ceil(b.height * sy) + padY * 2);
    const trimmed = cropW < png.width * 0.92 || cropH < png.height * 0.92;
    if (trimmed && Math.min(cropW, cropH) >= 16) {
      png = await toPng(png.uri, null, { originX, originY, width: cropW, height: cropH });
    }
    if (!png.base64) throw new Error('Görüntü verisi okunamadı.');
    const bytes = base64ToBytes(png.base64);
    return { ok: true, logo: { uri: png.uri, bytes, width: png.width, height: png.height, analysis, trimmed } };
  } catch {
    return { ok: false, error: 'Görüntü işlenemedi. Dosya bozuk olabilir; PNG veya JPEG biçiminde başka bir dosya deneyin.' };
  }
}

/** Fotoğraflardan seç (iPhone'da HEIC fotoğraflar JPEG olarak gelir) */
export async function pickLogoFromPhotos(onStep?: (text: string) => void): Promise<LogoPick> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, error: 'Logo seçmek için fotoğraflara erişim izni verin (Ayarlar).' };
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  const a = res.canceled ? null : res.assets[0];
  if (!a) return { ok: false, canceled: true };
  return prepareLogo(a.uri, { mimeType: a.mimeType, fileSize: a.fileSize }, onStep);
}

/** Dosyalardan seç (logolar çoğunlukla PNG dosyası olarak gelir) */
export async function pickLogoFromFiles(onStep?: (text: string) => void): Promise<LogoPick> {
  const res = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true, type: ['image/png', 'image/jpeg', 'image/svg+xml'] });
  const a = res.canceled ? null : res.assets[0];
  if (!a) return { ok: false, canceled: true };
  return prepareLogo(a.uri, { mimeType: a.mimeType, fileSize: a.size }, onStep);
}

/** Yükleme için ArrayBuffer (supabase-js depo istemcisi bunu her platformda kabul eder) */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export { LOGO_MIN_SIDE };
