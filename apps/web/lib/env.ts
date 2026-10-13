/** Ortam değişkenleri. Yönetim anahtarı (SUPABASE_SECRET_KEY) burada değil, yalnızca lib/supabase/admin.ts içinde okunur. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

export const ACTIVE_COMPANY_COOKIE = 'istakip_company';
