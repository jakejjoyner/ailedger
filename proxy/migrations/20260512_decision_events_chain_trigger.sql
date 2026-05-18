-- Migration: tamper-evident hash chain wrapping ledger.decision_events
--
-- Context: AILedger posture v2 (2026-05-12). The chain mechanism from
-- 20260418_tamper_evident_chain.sql is repurposed to wrap Decision Event
-- records. The mechanism is unchanged; the row shape being chained is
-- richer. Companion to:
--   - 20260512_decision_events_schema.sql
--   - 20260418_tamper_evident_chain.sql (inference_logs chain, for reference)
--
-- See CLAUDE.md three-layer architecture: Integrity layer (this chain)
-- wraps the Decision Event layer.
--
-- Idempotent.

create extension if not exists pgcrypto with schema extensions;

-- ─── Canonical serialization for Decision Event rows ───────────────────────
-- Field order is part of the chain contract; changing it invalidates every
-- prior chain link. Mirrors the pattern from inference_logs.canonical_hash.

create or replace function ledger.decision_events_canonical_hash(r ledger.decision_events)
returns text
language sql
immutable
as $$
  select encode(
    extensions.digest(
      r.event_id::text                                                    || '|' ||
      to_char(r."timestamp" at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')                            || '|' ||
      r.tenant_id::text                                                   || '|' ||
      r.system_id::text                                                   || '|' ||
      coalesce(r.model_version,        '')                                || '|' ||
      coalesce(r.model_weights_hash,   '')                                || '|' ||
      coalesce(r.decision_type,        '')                                || '|' ||
      coalesce(r.subject_id,           '')                                || '|' ||
      coalesce(r.inputs_hash,          '')                                || '|' ||
      coalesce(r.output::text,         '')                                || '|' ||
      coalesce(r.confidence::text,     '')                                || '|' ||
      coalesce(r.human_in_loop::text,  '')                                || '|' ||
      coalesce(r.protected_class_context::text,           '')             || '|' ||
      coalesce(r.protected_class_collection_method,       '')             || '|' ||
      coalesce(r.flags_raised::text,     '[]')                            || '|' ||
      coalesce(r.required_actions::text, '[]')                            || '|' ||
      coalesce(r.actions_taken::text,    '[]')                            || '|' ||
      coalesce(r.hash_chain_prev,        ''),
      'sha256'
    ),
    'hex'
  );
$$;

comment on function ledger.decision_events_canonical_hash(ledger.decision_events) is
  'Deterministic SHA-256 of canonical serialization of a Decision Event row. '
  'Used to compute hash_chain_self at INSERT time and to re-verify the chain '
  'on demand. Field order is part of the contract — any change invalidates '
  'prior chain links.';

-- ─── BEFORE INSERT trigger: compute hash_chain_prev + hash_chain_self ──────

create or replace function ledger.decision_events_compute_chain()
returns trigger
language plpgsql
as $$
declare
  v_prev text;
begin
  -- Per-tenant advisory lock (matches inference_logs pattern). Prevents
  -- concurrent inserts from same tenant racing on chain head.
  perform pg_advisory_xact_lock(
    hashtext('ledger.decision_events.chain'),
    hashtext(new.tenant_id::text)
  );

  -- Look up the current chain head for this tenant.
  select hash_chain_self into v_prev
    from ledger.decision_events
    where tenant_id = new.tenant_id
    order by "timestamp" desc, event_id desc
    limit 1;

  -- Genesis row uses all-zero prev hash.
  if v_prev is null then
    v_prev := repeat('0', 64);
  end if;

  new.hash_chain_prev := v_prev;
  -- Compute self-hash now that prev is set.
  new.hash_chain_self := ledger.decision_events_canonical_hash(new);

  return new;
end;
$$;

drop trigger if exists decision_events_compute_chain on ledger.decision_events;
create trigger decision_events_compute_chain
  before insert on ledger.decision_events
  for each row
  execute function ledger.decision_events_compute_chain();

-- ─── verify_chain() over decision_events ────────────────────────────────────
-- Reproduces the chain. Returns first broken row id (NULL if intact).
-- SECURITY INVOKER so the caller's RLS applies — auditors see only their
-- own tenant's chain.

create or replace function ledger.verify_decision_event_chain(p_tenant_id uuid)
returns table (
  ok boolean,
  broken_at_event_id uuid,
  broken_at_position bigint,
  total_rows bigint
)
language plpgsql
security invoker
set search_path = ledger, public, extensions
as $$
declare
  v_prev text := repeat('0', 64);
  v_row ledger.decision_events%rowtype;
  v_expected_self text;
  v_count bigint := 0;
begin
  for v_row in
    select *
    from ledger.decision_events
    where tenant_id = p_tenant_id
    order by "timestamp" asc, event_id asc
  loop
    v_count := v_count + 1;
    -- Check prev pointer
    if v_row.hash_chain_prev <> v_prev then
      return query select false, v_row.event_id, v_count, v_count;
      return;
    end if;
    -- Recompute self
    v_expected_self := ledger.decision_events_canonical_hash(v_row);
    if v_row.hash_chain_self <> v_expected_self then
      return query select false, v_row.event_id, v_count, v_count;
      return;
    end if;
    v_prev := v_row.hash_chain_self;
  end loop;

  return query select true, null::uuid, null::bigint, v_count;
end;
$$;

comment on function ledger.verify_decision_event_chain(uuid) is
  'Reproduces the per-tenant Decision Event chain. Returns ok=true if intact, '
  'or ok=false with the event_id and position of the first break. Anyone with '
  'read access to a tenant''s decision_events can call this; the function uses '
  'SECURITY INVOKER so the caller''s RLS applies.';

-- ─── chain_head() helper for PDF / audit export ─────────────────────────────

create or replace function ledger.decision_event_chain_head(p_tenant_id uuid)
returns table (
  event_id uuid,
  "timestamp" timestamptz,
  hash_chain_self text,
  total_rows bigint
)
language sql
security invoker
set search_path = ledger, public
as $$
  select
    de.event_id,
    de."timestamp",
    de.hash_chain_self,
    (select count(*) from ledger.decision_events
      where tenant_id = p_tenant_id) as total_rows
  from ledger.decision_events de
  where de.tenant_id = p_tenant_id
  order by de."timestamp" desc, de.event_id desc
  limit 1;
$$;

comment on function ledger.decision_event_chain_head(uuid) is
  'Returns the latest Decision Event row for a tenant plus the total count. '
  'Used by PDF compliance reports and audit-export flows to anchor a snapshot.';
