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

async function main() {
  const { data, error } = await supabase.from("settings").select("id, portal_url").limit(1);
  if (error) {
    console.error("Supabase connection check failed:", error.message);
    process.exitCode = 1;
    return;
  }

  console.log("Supabase OK:", data);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) {
    console.error("Auth check failed:", userError.message);
    return;
  }

  console.log("Authenticated user:", userData.user ?? "No session");
}

await main();
