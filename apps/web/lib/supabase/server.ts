import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../env';

/** Sunucu bileşenleri, server action ve route handler için kullanıcı oturumlu istemci (RLS uygulanır). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Sunucu bileşeninden çağrıldığında çerez yazılamaz; oturum yenilemesini proxy yapar.
        }
      },
    },
  });
}
