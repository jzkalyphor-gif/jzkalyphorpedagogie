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

function studentLoginPassword(registration) {
  const normalized = registration.trim().toUpperCase().replace(/\s+/g, "");
  const text = `jzkalyphor|student|v1|${normalized}`;
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(text))
    .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));
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

const registration = "AB123";
const name = "Alice Dupont";
const phone = "+33600000000";
const cohort = "AD-2026";

async function main() {
  const password = await studentLoginPassword(registration);
  const email = `${registration.toLowerCase()}@id.jzkalyphor.app`;

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authError) {
    console.error("Student auth creation failed:", authError.message);
    process.exitCode = 1;
    return;
  }

  const userId = authData.user?.id;
  if (!userId) {
    console.error("No user id returned by Supabase auth.");
    process.exitCode = 1;
    return;
  }

  const { error: studentError } = await supabase.from("students").upsert({
    auth_user_id: userId,
    name,
    whatsapp: phone,
    registration,
    cohort,
    active: true,
    created_at: new Date().toISOString(),
  }, { onConflict: "auth_user_id" });

  if (studentError) {
    console.error("Student profile creation failed:", studentError.message);
    process.exitCode = 1;
    return;
  }

  const { error: roleError } = await supabase.from("user_roles").upsert({
    user_id: userId,
    role: "student",
  }, { onConflict: "user_id" });

  if (roleError) {
    console.error("Student role creation failed:", roleError.message);
    process.exitCode = 1;
    return;
  }

  console.log({ email, password, registration, name, cohort });
}

await main();
