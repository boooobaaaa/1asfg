/* ==========================================================================
   1ASFG SITE CONFIG
   --------------------------------------------------------------------------
   Leave SUPABASE_URL / SUPABASE_ANON_KEY empty to run in DEMO MODE
   (data is stored in your own browser only, seeded with sample data).

   To go live: create a Supabase project, run supabase/schema.sql, then paste
   your Project URL and PUBLISHABLE key (sb_publishable_…) below — or a legacy
   anon key. (Supabase dashboard → Project Settings → API Keys.) It is safe to
   publish; Row Level Security in schema.sql decides who can write.
   NEVER put the secret key (sb_secret_… / service_role) in this file.
   ========================================================================== */
window.SITE_CONFIG = {
  SUPABASE_URL: "https://jppvfbfxffixvqebsrop.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Og9P8zIm6Run_yiGzfuvgQ_5cd-L1W1",   // publishable key: safe to publish

  // Demo mode only: passcode for the Admin console (ignored when Supabase is on).
  DEMO_ADMIN_PASSCODE: "airborne",
};
