import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from '../env';

/**
 * YÖNETİM İSTEMCİSİ — RLS'i atlar. Yalnızca güvenilir sunucu kodunda ve yalnızca
 * Auth Admin API gerektiren dar işlemler için kullanılır (davetle hesap açma).
 * Anahtar istemciye gönderilmez: 'server-only' içe aktarımı bu dosyanın tarayıcı
 * paketine girmesini derleme hatasıyla engeller.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !key) {
    throw new Error('SUPABASE_SECRET_KEY tanımlı değil (apps/web/.env.local).');
  }
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export const isAdminConfigured = () => Boolean(SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
