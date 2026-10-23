import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Configuration Supabase.
 *
 * Ordre de priorité :
 *   1. Variables d'environnement Vite (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY,
 *      ou l'ancienne VITE_SUPABASE_ANON_KEY)
 *   2. localStorage (jz-supabase-url / jz-supabase-key)
 *   3. Constantes globales __JZK_SUPABASE_URL__ / __JZK_SUPABASE_KEY__
 *      (utilisées par la version autonome jz-kalyphor.html, éditables en haut du fichier)
 *
 * Si rien n'est configuré, l'application fonctionne en mode local (localStorage).
 * Seule la clé publique (publishable/anon) est utilisée côté navigateur :
 * la sécurité est assurée par les politiques RLS, jamais par une clé secrète.
 */

declare global {
  interface Window {
    __JZK_SUPABASE_URL__?: string;
    __JZK_SUPABASE_KEY__?: string;
    supabaseJs?: { createClient: typeof createClient };
  }
}

type EnvBag = Record<string, string | undefined>;

function readViteEnv(): EnvBag {
  try {
    // Lu par Vite à la compilation. Dans le fichier autonome (Babel), le générateur
    // remplace ce jeton par __JZK_ENV__ (voir scripts/create-standalone.mjs).
    const meta = import.meta as ImportMeta & { env?: EnvBag };
    return meta.env || {};
  } catch {
    return {};
  }
}

export type SupabaseConfig = { url: string; key: string };

export function readSupabaseConfig(): SupabaseConfig {
  const env = readViteEnv();
  const fromGlobals = {
    url: (globalThis as Record<string, unknown>).__JZK_SUPABASE_URL__ as
      | string
      | undefined,
    key: (globalThis as Record<string, unknown>).__JZK_SUPABASE_KEY__ as
      | string
      | undefined,
  };
  let url =
    env.VITE_SUPABASE_URL ||
    fromGlobals.url ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("jz-supabase-url")
      : null) ||
    "";
  let key =
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_ANON_KEY ||
    fromGlobals.key ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("jz-supabase-key")
      : null) ||
    "";
  url = String(url).trim().replace(/\/+$/, "");
  key = String(key).trim();
  return { url, key };
}

export function isSupabaseConfigured(): boolean {
  const { url, key } = readSupabaseConfig();
  return /^https:\/\/.+\.supabase\.co$/.test(url) && key.length > 20;
}

let cachedClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  const { url, key } = readSupabaseConfig();
  if (!/^https:\/\/.+\.supabase\.co$/.test(url) || !key) {
    throw new Error("Supabase n'est pas configuré.");
  }
  if (!cachedClient) {
    cachedClient = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return cachedClient;
}

/** Client Supabase, ou null en mode local. */
export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? getSupabase()
  : null;
