import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

/**
 * Client Supabase du SITE PUBLIC — session séparée de l'application de
 * gestion (autre clé de stockage) : un client connecté au site n'ouvre jamais
 * la gestion, et un employé connecté à la gestion reste un visiteur du site.
 */
export const siteSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'papeterie-site-auth' },
});
