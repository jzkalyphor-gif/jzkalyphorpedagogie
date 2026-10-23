import { getSupabase, isSupabaseConfigured } from "./supabaseClient";

export async function verifySupabaseConnection() {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      step: "config",
      message: "Supabase n'est pas configuré. Vérifiez VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY.",
    };
  }

  const supabase = getSupabase();

  try {
    const { data, error } = await supabase.from("settings").select("id, portal_url").limit(1);

    if (error) {
      return {
        ok: false,
        step: "query",
        message: `Erreur Supabase : ${error.message}`,
      };
    }

    return {
      ok: true,
      step: "query",
      message: `Connexion OK. ${Array.isArray(data) ? data.length : 0} ligne(s) lues.`,
      data,
    };
  } catch (err) {
    return {
      ok: false,
      step: "runtime",
      message: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}

export async function verifySupabaseAuth() {
  const supabase = getSupabase();

  try {
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error) {
      return { ok: false, message: error.message };
    }

    return {
      ok: true,
      message: user ? `Utilisateur connecté : ${user.email}` : "Aucune session active.",
      user,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Erreur d'auth",
    };
  }
}
