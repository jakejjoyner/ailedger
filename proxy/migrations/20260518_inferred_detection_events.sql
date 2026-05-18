-- Migration: inferred Detection Event support + chain_spec_version dispatch
--
-- Context: param canonicalization spec v1.0 (2026-05-18, Jake-ratified)
-- documented at gt-lab/docs/param-canonicalization-spec-v1.md.
-- Extends ledger.decision_events to support inferred events from the
-- 4-rung method ladder (detection.parse / restructure / replay / perturb)
-- per docs/compliance-architecture/HANDOFF-decision-event-layer.md.
--
-- Why chain_spec_version is needed: extending the canonical hash function
-- to include new fields would invalidate ALL pre-migration row hashes
-- (every pre-migration row's hash_chain_self would no longer match the
-- new hash function's output). chain_spec_version lets pre-migration
-- rows continue verifying under v1 hash semantics; new rows use v2.
-- Both chains coexist in the same table; verification dispatches on
-- chain_spec_version per row.
--
-- This migration is the v2-ratified shape. v1 chains remain immutable.
--
-- Companion specs:
--   - docs/param-canonicalization-spec-v1.md (canonical-serialization rules)
--   - docs/compliance-architecture/HANDOFF-decision-event-layer.md (method ladder)
--   - docs/caird/AILedger-naming-exploration.md (Detection Event naming, ratified 2026-05-17)
--
-- Naming note: SQL identifiers retain `decision_events` until coordinated
-- rename migration ships (bead hq-4yh). Prose-level "Detection Event"
-- ratified 2026-05-17 but SQL rename is separate, gated work.
--
-- Idempotent.

-- ─── 1. Add inferred-event columns ────────────────────────────────────────

alter table ledger.decision_events
  add column if not exists extractor_model         text,
  add column if not exists extractor_method        text,
  add column if not exists extractor_params        jsonb,
  add column if not exists extractor_params_hash   text,
  add column if not exists anchor_event_id         uuid,
  add column if not exists extraction_started_at   timestamptz,
  add column if not exists extraction_compute_ms   integer,
  add column if not exists chain_spec_version      smallint not null default 1;

-- After-add: bump default to 2 for new rows. Existing rows stay at 1.
-- Two-step pattern: first add with default 1 (so existing rows get 1),
-- then alter default to 2 (so future inserts get 2).
alter table ledger.decision_events
  alter column chain_spec_version set default 2;

-- ─── 2. Constraints ───────────────────────────────────────────────────────

-- extractor_method must be one of the four method-ladder values when present.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'decision_events_extractor_method_check'
      and conrelid = 'ledger.decision_events'::regclass
  ) then
    alter table ledger.decision_events
      add constraint decision_events_extractor_method_check
      check (
        extractor_method is null
        or extractor_method in (
          'detection.parse',
          'detection.restructure',
          'detection.replay',
          'detection.perturb'
        )
      );
  end if;
end $$;

-- Inferred-event integrity: if any extractor_* field is set, all of
-- extractor_model + extractor_method + extractor_params_hash + anchor_event_id
-- must be set together. Half-populated inferred-event rows are not valid.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'decision_events_inferred_fields_consistency'
      and conrelid = 'ledger.decision_events'::regclass
  ) then
    alter table ledger.decision_events
      add constraint decision_events_inferred_fields_consistency
      check (
        (extractor_model is null
         and extractor_method is null
         and extractor_params_hash is null
         and anchor_event_id is null)
        or
        (extractor_model is not null
         and extractor_method is not null
         and extractor_params_hash is not null
         and anchor_event_id is not null)
      );
end if;
end $$;

-- chain_spec_version must be either 1 (legacy) or 2 (current).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'decision_events_chain_spec_version_check'
      and conrelid = 'ledger.decision_events'::regclass
  ) then
    alter table ledger.decision_events
      add constraint decision_events_chain_spec_version_check
      check (chain_spec_version in (1, 2));
  end if;
end $$;

-- Foreign-key for anchor_event_id (inferred events reference canonical events
-- by event_id within the same tenant). NOT enforced as a SQL FK because
-- cross-tenant references are disallowed by the same-tenant verification
-- check during chain walk; an FK would also incur insert-time lookup cost
-- on the hot path. Same-tenant enforcement is documented in spec §8.

-- ─── 3. Indexes ───────────────────────────────────────────────────────────

-- Index for the chain-walk pattern: find all inferred events anchored to a
-- given canonical event. Partial index because most rows are canonical
-- (anchor_event_id IS NULL).
create index if not exists decision_events_anchor_event_id_idx
  on ledger.decision_events (anchor_event_id)
  where anchor_event_id is not null;

-- Index for the method-filter pattern: find all events extracted by a
-- specific method (e.g. "show me all detection.replay events for tenant X").
-- Partial index because most rows are canonical (extractor_method IS NULL).
create index if not exists decision_events_extractor_method_idx
  on ledger.decision_events (tenant_id, extractor_method)
  where extractor_method is not null;

-- ─── 4. Canonical hash v2 ─────────────────────────────────────────────────

-- v2 adds: extractor_model, extractor_method, extractor_params_hash,
-- anchor_event_id, extraction_started_at, extraction_compute_ms.
-- Field order: schema-declared, with new fields appended AFTER the existing
-- v1 fields (preserves the v1 field ordering as a prefix; appending is the
-- design choice per spec §5).

create or replace function ledger.decision_events_canonical_hash_v2(r ledger.decision_events)
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
      coalesce(r.hash_chain_prev,        '')                              || '|' ||
      coalesce(r.extractor_model,        '')                              || '|' ||
      coalesce(r.extractor_method,       '')                              || '|' ||
      coalesce(r.extractor_params_hash,  '')                              || '|' ||
      coalesce(r.anchor_event_id::text,  '')                              || '|' ||
      coalesce(to_char(r.extraction_started_at at time zone 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')              || '|' ||
      coalesce(r.extraction_compute_ms::text, ''),
      'sha256'
    ),
    'hex'
  );
$$;

comment on function ledger.decision_events_canonical_hash_v2(ledger.decision_events) is
  'Deterministic SHA-256 of canonical serialization of a Detection Event row '
  'under spec v1.0 (chain_spec_version = 2). Extends the v1 field list with '
  'six inferred-event fields appended after hash_chain_prev. Field order is '
  'part of the chain contract; any change invalidates prior chain links.';

-- ─── 5. Dispatch function ─────────────────────────────────────────────────

-- Replaces the original decision_events_canonical_hash with a dispatcher.
-- Verification code (auditor SQL, monitor cron, anything that calls
-- decision_events_canonical_hash) continues to work without modification:
-- the dispatcher picks v1 or v2 per row based on chain_spec_version.
--
-- v1 rows (pre-migration, default chain_spec_version = 1 backfilled by
-- the ALTER above) hash under the unchanged v1 function. Their stored
-- hash_chain_self continues to match.
--
-- v2 rows (new inserts) hash under v2 which includes the inferred-event
-- fields.

create or replace function ledger.decision_events_canonical_hash(r ledger.decision_events)
returns text
language sql
immutable
as $$
  select case r.chain_spec_version
    when 1 then encode(
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
    )
    when 2 then ledger.decision_events_canonical_hash_v2(r)
    else null
  end;
$$;

comment on function ledger.decision_events_canonical_hash(ledger.decision_events) is
  'Dispatcher: routes to v1 or v2 canonical hash based on chain_spec_version. '
  'v1 = pre-2026-05-18 chain semantics (18 fields). v2 = spec v1.0 with '
  'inferred-event extension (24 fields). New inserts use v2. v1 rows '
  'preserved as-was; their hash_chain_self continues to verify against the '
  'v1 hash function. The chain trigger function continues to call this '
  'dispatcher without modification.';

-- ─── 6. Sanity check ──────────────────────────────────────────────────────

-- For any existing row, the dispatcher must return the same hash as the v1
-- function did before this migration. Run a sample check during migration
-- (limited scope to avoid full-table scan); if any row mismatch, halt.
--
-- Note: this assertion runs against the LIVE hash_chain_self values stored
-- in pre-migration rows. The hash_chain_self was computed by the v1 trigger
-- at insert time using the v1 hash function. The dispatcher now calls the
-- v1 function for chain_spec_version = 1 rows; result must match.

do $$
declare
  v_mismatch_count integer;
begin
  select count(*) into v_mismatch_count
  from ledger.decision_events
  where chain_spec_version = 1
    and hash_chain_self is not null
    and hash_chain_self != ledger.decision_events_canonical_hash(decision_events.*)
  limit 100;

  if v_mismatch_count > 0 then
    raise exception 'Migration sanity check failed: % v1 rows have hash_chain_self that does not match dispatcher output. Halting before trigger updates apply.', v_mismatch_count;
  end if;
end $$;

-- ─── 7. Comment on the new columns for schema documentation ───────────────

comment on column ledger.decision_events.extractor_model is
  'For inferred Detection Events: model name + version of the extractor '
  '(e.g. "claude-opus-4-7@1m"). NULL for canonical production-time events.';

comment on column ledger.decision_events.extractor_method is
  'For inferred Detection Events: one of detection.parse / detection.restructure / '
  'detection.replay / detection.perturb. NULL for canonical events.';

comment on column ledger.decision_events.extractor_params is
  'For inferred Detection Events: the parameters passed to the extractor, '
  'as JSONB. Stored alongside extractor_params_hash so re-extraction is '
  'reproducible. NULL for canonical events.';

comment on column ledger.decision_events.extractor_params_hash is
  'For inferred Detection Events: SHA-256 hex of canonical-serialized '
  'extractor_params per spec v1.0 §7.2. NULL for canonical events.';

comment on column ledger.decision_events.anchor_event_id is
  'For inferred Detection Events: event_id of the canonical Detection Event '
  'this inferred event is extracted from. NULL for canonical events. '
  'Same-tenant enforcement is documented in spec v1.0 §8.';

comment on column ledger.decision_events.extraction_started_at is
  'For inferred Detection Events: timestamp when the extraction job started '
  '(UTC). Used by auditors to reconstruct temporal gaps between production '
  'decision (canonical event) and reconstruction (inferred event).';

comment on column ledger.decision_events.extraction_compute_ms is
  'For inferred Detection Events: extractor compute time in milliseconds. '
  'Doubles as a compute-proportional-to-confidence signal per HANDOFF §"Method ladder".';

comment on column ledger.decision_events.chain_spec_version is
  'Pins the row to a canonical-hash-function version. v1 = pre-2026-05-18 '
  '18-field hash. v2 = spec v1.0 24-field hash. New inserts default to v2. '
  'Migration to v3+ in future requires another spec version + grace period.';

-- Migration complete.
