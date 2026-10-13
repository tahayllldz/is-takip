'use client';
import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../env';

/** Tarayıcı istemcisi (yalnızca yayınlanabilir anahtar; Realtime abonelikleri için). */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
