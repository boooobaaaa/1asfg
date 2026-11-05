// OPSNET site settings.
// Leave SUPABASE_URL empty to run in DEMO MODE (sample data, nothing is saved).
// Fill both values from Supabase → Project Settings → API.
// The anon key is meant to be public; the database rules in schema.sql keep writes admin-only.
window.OPSNET_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // Optional: drop your emblem image in /assets and point to it here, e.g. "assets/emblem.png".
  // Leave empty to show the radar scope instead.
  EMBLEM: "",

  // Name shown in the browser tab and header
  SITE_NAME: "OPSNET"
};
