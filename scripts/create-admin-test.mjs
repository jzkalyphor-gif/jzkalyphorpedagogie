import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const map = new Map();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    map.set(key, value.replace(/^['"]|['"]$/g, ""));
  }

  return map;
}

const env = loadEnvLocal();
const supabaseUrl = env.get("VITE_SUPABASE_URL") || env.get("SUPABASE_URL");
const supabaseKey = env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || env.get("VITE_SUPABASE_ANON_KEY") || env.get("SUPABASE_ANON_KEY");

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase env vars. Check .env.local and include VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

async function createAdmin() {
  const email = "admin@jzkalyphor.app";
  const password = "Admin2026@JZ";

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    console.error("Admin creation failed:", error.message);
    process.exitCode = 1;
    return;
  }

  console.log("Admin created:", data.user?.email ?? email);
}

await createAdmin();
