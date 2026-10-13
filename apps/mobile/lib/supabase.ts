import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { authStorage } from './secure-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const isConfigured = Boolean(url && key);

/**
 * Yalnızca yayınlanabilir anahtar kullanılır; tüm yetki kontrolü veritabanında (RLS + RPC).
 * Yapılandırma yoksa sahte veri gösterilmez, kurulum ekranı açılır.
 */
export const supabase = createClient(url || 'http://yapilandirilmadi.invalid', key || 'yok', {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    // supabase-js ≥ 2.117 oturum yenilemesini kilitsiz eşgüdümle yapar; `lock` seçeneği kullanımdan kalktı.
    detectSessionInUrl: false,
  },
});

// Uygulama ön plandayken oturum yenilemesi çalışır, arka planda durur.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
