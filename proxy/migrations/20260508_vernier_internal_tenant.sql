-- Migration: vernier-internal tenant + API key for sidecar /log ingest
-- Run in the Supabase SQL editor. Idempotent: safe to re-run (uses ON CONFLICT
-- DO NOTHING and SELECT-existing patterns).
--
-- Context (per task #34 Phase 2.2 + project_vernier_sidecar_phase3_prototype_2026_05_08):
--
--   Vernier (Mayor of jake silo) needs a tenant identity in AILedger so the
--   sidecar daemon can POST inference rows to /log without piggybacking on
--   Jake's customer account. This script:
--     1. Creates an auth.users row for vernier-internal@ailedger.dev (so
--        FK constraints on customer_id are satisfied)
--     2. Generates a fresh API key (raw form printed in NOTICE)
--     3. Inserts the SHA-256 of the key into ledger.api_keys
--     4. Prints the raw key for one-time copy to ~/.config/vernier/ailedger.key
--
-- ⚠ The raw key is printed via RAISE NOTICE. Copy it from the SQL editor's
-- "Notices" panel into ~/.config/vernier/ailedger.key on the deploy machine,
-- then never display it again. The hash is what's stored.

-- Use a transaction so a partial failure doesn't leave a half-state.
begin;

-- ─── 1. Vernier internal user (for FK to auth.users) ────────────────────────
-- Supabase manages auth.users via its own RPC (auth.users isn't directly
-- INSERT-able via SQL editor without the service role). The cleanest path:
-- use Supabase Dashboard → Authentication → Users → Add user with email
-- vernier-internal@ailedger.dev BEFORE running this migration. Then this
-- script reads back the resulting UUID.
do $migration$
declare
  v_user_id    uuid;
  v_raw_key    text;
  v_key_hash   text;
  v_key_prefix text;
  v_existing_key_count int;
begin
  -- Look up the vernier-internal user (must be pre-created via Supabase
  -- Dashboard before this migration runs).
  select id into v_user_id
    from auth.users
   where email = 'vernier-internal@ailedger.dev'
   limit 1;

  if v_user_id is null then
    raise exception
      'vernier-internal@ailedger.dev user not found in auth.users. '
      'Create it first: Supabase Dashboard → Authentication → Users → '
      'Add user → email=vernier-internal@ailedger.dev (any password — '
      'this user never logs in interactively).';
  end if;

  -- ─── 2. Bail if a vernier key already exists for this user ────────────────
  -- Idempotency: re-running the script must not create a second key.
  select count(*) into v_existing_key_count
    from ledger.api_keys
   where customer_id = v_user_id;

  if v_existing_key_count > 0 then
    raise notice 'vernier-internal already has % API key(s); skipping create. '
                 'To rotate, delete the existing row first.', v_existing_key_count;
    return;
  end if;

  -- ─── 3. Generate a fresh API key ─────────────────────────────────────────
  -- Format: agl_sk_<48 random hex chars> = 64 hex chars total = 32 bytes of
  -- entropy. Matches the customer-facing key format.
  v_raw_key    := 'agl_sk_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_key_hash   := encode(extensions.digest(v_raw_key, 'sha256'), 'hex');
  v_key_prefix := substring(v_raw_key from 1 for 14);  -- "agl_sk_" + first 6 hex

  -- ─── 4. Insert into api_keys ──────────────────────────────────────────────
  -- system_id null = the key isn't scoped to a specific AI system; all
  -- Vernier traffic shows up under the same vernier-internal tenant.
  -- key_prefix is non-null per schema (used for admin UI display without
  -- exposing the full key).
  insert into ledger.api_keys (customer_id, key_hash, key_prefix, system_id, name)
  values (v_user_id, v_key_hash, v_key_prefix, null, 'vernier-internal-sidecar')
  on conflict do nothing;

  -- ─── 5. Print the raw key for one-time copy ──────────────────────────────
  raise notice '────────────────────────────────────────────────────────────';
  raise notice 'VERNIER API KEY (copy to ~/.config/vernier/ailedger.key):';
  raise notice '%', v_raw_key;
  raise notice '────────────────────────────────────────────────────────────';
  raise notice 'After copying, this key is never recoverable from the DB —';
  raise notice 'only the SHA-256 hash is stored. To rotate, delete the row';
  raise notice 'from ledger.api_keys and re-run this migration.';
end;
$migration$;

commit;
