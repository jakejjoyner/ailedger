-- Migration: Decision Event schema (v2 substrate, primary table)
--
-- Context: AILedger posture v2 (2026-05-12) — the unit of analysis is the
-- Decision Event, one record per AI decision affecting a person. This
-- migration creates the primary table. Companion migrations:
--   - 20260512_decision_type_taxonomy_seed.sql      (decision_type seed data)
--   - 20260512_protected_class_taxonomy_seed.sql    (protected_class field reference)
--   - 20260512_subject_pseudonymization.sql         (HMAC salt table + pseudonymize fn)
--   - 20260512_decision_events_chain_trigger.sql    (extends chain to wrap decision_events)
--
-- See ~/workspace/dev/ailedger/CLAUDE.md for the canonical schema spec.
--
-- ── OPEN DECISIONS (Jake review before running) ────────────────────────────
-- 1. `tenants(id)` and `ai_systems(id)` references: CLAUDE.md spec assumes
--    these tables exist. Current schema uses auth.users(id) as the tenant
--    identifier. Two paths:
--      A. Create real `tenants` and `ai_systems` tables (this migration sketches
--         them as `if not exists` — verify they don't conflict with intended
--         multi-tenancy design before running).
--      B. Rewrite the FKs to reference auth.users(id) and a new ai_systems table.
--    This migration takes path A. Switch to B by editing before running.
-- 2. Subject_id storage type: spec says TEXT. Some implementations use BYTEA
--    for HMAC output. TEXT chosen here for human-readable diagnostics; switch
--    to BYTEA if storage efficiency matters at scale.
-- 3. Hash chain field types: TEXT (hex-encoded SHA-256) matching existing
--    inference_logs.chain_prev_hash convention.
-- 4. Foreign-key cascades: NO cascade delete on any decision_events FK.
--    Decision Event records are audit records; deleting a tenant or system
--    should NOT silently destroy the audit trail. If tenant/system rows need
--    to be removed, decision_events for them must be handled by an explicit
--    archive procedure.
-- ────────────────────────────────────────────────────────────────────────────
--
-- Run in the Supabase SQL editor. Idempotent: safe to re-run.

create extension if not exists pgcrypto with schema extensions;

-- ─── Supporting tables (sketched per CLAUDE.md spec — verify intent) ────────

create table if not exists ledger.tenants (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  -- Industry tag for Charter-refused-category gating at intake. NOT a free-form
  -- field — must map to an allowed industry value via signup flow. Refused
  -- categories (predictive policing, social scoring, etc.) are blocked at
  -- application layer; this column records the tag for record-keeping.
  industry_tag text
);

create table if not exists ledger.ai_systems (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references ledger.tenants(id),
  created_at  timestamptz not null default now(),
  name        text not null,
  description text
);

-- ─── Decision Event table (primary v2 substrate) ────────────────────────────

create table if not exists ledger.decision_events (
  event_id          uuid primary key default gen_random_uuid(),
  -- "timestamp" is a reserved word in some contexts; use `at` for the column.
  -- Spec calls it "timestamp"; keep spec naming with quoted identifier.
  "timestamp"       timestamptz not null default now(),
  tenant_id         uuid not null references ledger.tenants(id),
  system_id         uuid not null references ledger.ai_systems(id),
  model_version     text not null,
  model_weights_hash text
    check (model_weights_hash is null or length(model_weights_hash) = 64),
  decision_type     text not null,
    -- FK to decision_type_taxonomy(code) added in companion migration.
  subject_id        text not null,
    -- HMAC-SHA256 hex output (64 chars) of the customer-provided subject
    -- identifier with per-tenant salt. Salt lives in ledger.tenant_salts
    -- (separate table, separate access policy — see companion migration).
  inputs_hash       text not null
    check (length(inputs_hash) = 64),
    -- SHA-256 of canonical serialization of decision inputs. Raw inputs
    -- are NOT stored in AILedger; customer retains, AILedger holds proof.
  output            jsonb not null,
    -- The decision output is stored (not hashed). This is what regulators
    -- and customers need to read to evaluate the decision.
  confidence        numeric(5,4)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  human_in_loop     boolean not null default false,
  protected_class_context jsonb,
  protected_class_collection_method text
    check (protected_class_collection_method in ('direct', 'inferred', 'blind')),
  -- Required when collection_method != 'blind'.
  -- Enforced in companion check below (cannot inline because PostgreSQL
  -- check constraints can reference multiple columns this way).
  flags_raised      jsonb not null default '[]'::jsonb,
    -- Array of { flag_id, flag_type, severity, raised_at, detection_primitive_version }
  required_actions  jsonb not null default '[]'::jsonb,
    -- Array of { action_id, action_type, raised_by_flag, deadline }
  actions_taken     jsonb not null default '[]'::jsonb,
    -- Array of { action_id, taken_at, taken_by, notes }
  hash_chain_prev   text not null
    check (length(hash_chain_prev) = 64),
  hash_chain_self   text not null
    check (length(hash_chain_self) = 64)
);

-- Cross-column check: protected_class_context required unless collection_method='blind'
alter table ledger.decision_events
  add constraint decision_events_pcc_required_when_not_blind
  check (
    protected_class_collection_method = 'blind'
    or protected_class_context is not null
  );

-- ─── Indexes (per CLAUDE.md spec) ───────────────────────────────────────────

create index if not exists idx_decision_events_tenant_system_time
  on ledger.decision_events (tenant_id, system_id, "timestamp" desc);

create index if not exists idx_decision_events_protected_class
  on ledger.decision_events using gin (protected_class_context);

create index if not exists idx_decision_events_flags
  on ledger.decision_events using gin (flags_raised)
  where jsonb_array_length(flags_raised) > 0;

create index if not exists idx_decision_events_decision_type
  on ledger.decision_events (tenant_id, decision_type, "timestamp" desc);

-- Subject-level repeated-decision query (Detection primitive 6).
create index if not exists idx_decision_events_subject_tenant
  on ledger.decision_events (tenant_id, subject_id, "timestamp" desc);

-- ─── Row Level Security ─────────────────────────────────────────────────────
-- Decision Event rows belong to the tenant. Customers see only their own
-- tenant's rows. Regulator/auditor read paths go through SECURITY INVOKER
-- functions (analogous to verify_chain() pattern in inference_logs).

alter table ledger.decision_events enable row level security;

-- Placeholder policy: a tenant's own rows readable by tenant members.
-- Adjust for actual auth model (currently inference_logs uses customer_id
-- referencing auth.users; if tenant_id is mapped to auth.users via a
-- membership table, write the policy against that join).
-- LEFT INTENTIONALLY UN-INSTANTIATED — Jake completes the policy as part
-- of the migration review. Without an explicit policy, no role can read
-- this table except service_role.

-- ─── Append-only enforcement (mirroring inference_logs pattern) ─────────────
-- Decision Event records are audit records. UPDATE and DELETE must be
-- blocked even from service_role (the chain wrapping these rows depends
-- on immutability). Triggered policy below.

create or replace function ledger.decision_events_prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ledger.decision_events is append-only; % rejected', tg_op
    using errcode = 'P0001';
end;
$$;

drop trigger if exists decision_events_no_update on ledger.decision_events;
create trigger decision_events_no_update
  before update on ledger.decision_events
  for each row
  execute function ledger.decision_events_prevent_mutation();

drop trigger if exists decision_events_no_delete on ledger.decision_events;
create trigger decision_events_no_delete
  before delete on ledger.decision_events
  for each row
  execute function ledger.decision_events_prevent_mutation();

-- ─── Comments (for SOC 2 / audit reviewer onboarding) ───────────────────────

comment on table ledger.decision_events is
  'AILedger v2 substrate. One record per AI decision affecting a person. '
  'Append-only (UPDATE/DELETE blocked at trigger level even for service_role). '
  'Chain-wrapped by hash_chain_prev/hash_chain_self (see companion migration '
  '20260512_decision_events_chain_trigger.sql).';

comment on column ledger.decision_events.subject_id is
  'HMAC-SHA256(customer_subject_identifier, per_tenant_salt). Stable for same '
  'subject across decisions within tenant; NOT reversible to customer-side PII. '
  'Salt lives in ledger.tenant_salts (separate access policy).';

comment on column ledger.decision_events.inputs_hash is
  'SHA-256 of canonical serialization of decision inputs. Raw inputs are NOT '
  'stored in AILedger; customer retains plaintext, AILedger holds the proof.';

comment on column ledger.decision_events.protected_class_collection_method is
  'How the customer obtained the protected-class data: direct (collected from '
  'subject), inferred (derived from proxies — flag for proxy-bias detection), '
  'blind (jurisdictionally prohibited collection — proxy variables captured '
  'separately for proxy-bias detection).';

comment on column ledger.decision_events.flags_raised is
  'Detection-layer findings on this event. Populated by detection primitives '
  'running against the Decision Event records. Each element: { flag_id, '
  'flag_type, severity, raised_at, detection_primitive_version }.';

comment on column ledger.decision_events.required_actions is
  'Actions required by detection findings. Populated by detection layer. '
  'The diff between required_actions and actions_taken is the unresolved '
  'compliance gap.';
