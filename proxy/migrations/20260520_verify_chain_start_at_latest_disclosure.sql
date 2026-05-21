-- Migration: verify_chain walks from the most-recent /_chain/genesis disclosure
-- forward, instead of from row 1.
--
-- Context: 2026-05-20. The 2026-05-19 migration
-- (20260519_verify_chain_honor_disclosures.sql) tried to honor disclosure
-- rows by resetting `expected` to zeros when the iterator hit one — but
-- because the walk was `order by id asc`, a disclosure inserted AFTER a
-- pre-existing break was unreachable: the loop aborted at the broken row
-- long before reaching the disclosure. Net effect: vernier-internal
-- (customer 68d2edd5-…) stayed broken at id=51887 even after inserting
-- the disclosure at id=8882796.
--
-- This migration replaces the walk strategy:
--   1. Find the max(id) of a disclosure row for the customer.
--   2. If one exists, begin verification from that row (inclusive).
--   3. Otherwise, fall back to the original "walk from the start" path.
--
-- Anti-theater preservation:
--   * Pre-disclosure rows (including the historical break) remain in the
--     table, queryable, and immutable. The dashboard's `Records chained`
--     count (which selects from ledger.inference_logs directly) still
--     reflects the full history. We are not rewriting data.
--   * The disclosure row itself is the auditable, persistent statement
--     "the operator acknowledges a chain reset at this id." Inserting one
--     is a deliberate act and shows up in audit queries.
--   * Post-disclosure verification is unchanged: the BEFORE INSERT trigger
--     still computes chain_prev_hash from the actual predecessor, and the
--     AFTER INSERT trigger from 20260519_chain_insert_verification_trigger
--     still RAISEs on any tampering of new rows.
--
-- The `row_count` field returned by verify_chain now reflects the number
-- of rows ACTUALLY VERIFIED in this run (i.e., from latest disclosure
-- forward, inclusive of the disclosure). The dashboard's "Records chained"
-- KPI comes from a separate count query and is unaffected.
--
-- Run in production via the Supabase Management API (memory: never paste
-- credentials into the SQL editor). Idempotent.

create or replace function ledger.verify_chain(p_customer_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
as $$
declare
  expected      text := repeat('0', 64);
  r             ledger.inference_logs;
  n             bigint := 0;
  start_id      bigint;
begin
  if p_customer_id is null then
    return jsonb_build_object(
      'ok', false, 'broken_at_id', null,
      'expected_hash', null, 'actual_hash', null,
      'chain_head_hash', null, 'row_count', 0,
      'error', 'no customer_id (unauthenticated and no arg provided)'
    );
  end if;

  -- The most-recent disclosure row for this customer is the chain's
  -- effective genesis. The BEFORE INSERT trigger guarantees its
  -- chain_prev_hash is 64×'0', so `expected` correctly stays at zeros
  -- through the first iteration.
  select max(id)
    into start_id
    from ledger.inference_logs
   where customer_id = p_customer_id
     and provider    = 'ailedger-system'
     and path        = '/_chain/genesis'
     and chain_prev_hash is not null;

  for r in
    select *
      from ledger.inference_logs
     where customer_id = p_customer_id
       and chain_prev_hash is not null
       and (start_id is null or id >= start_id)
     order by id asc
  loop
    n := n + 1;

    if r.chain_prev_hash is distinct from expected then
      return jsonb_build_object(
        'ok',              false,
        'broken_at_id',    r.id,
        'expected_hash',   expected,
        'actual_hash',     r.chain_prev_hash,
        'chain_head_hash', null,
        'row_count',       n
      );
    end if;

    expected := ledger.canonical_hash(r);
  end loop;

  return jsonb_build_object(
    'ok',              true,
    'broken_at_id',    null,
    'expected_hash',   null,
    'actual_hash',     null,
    'chain_head_hash', case when n = 0 then null else expected end,
    'row_count',       n
  );
end;
$$;

comment on function ledger.verify_chain(uuid) is
  'Walks the per-customer chain from the most-recent /_chain/genesis '
  'disclosure forward (inclusive). If no disclosure exists, walks from '
  'the first chained row. Each disclosure row is stamped with '
  'chain_prev_hash = 64×0 by the BEFORE INSERT trigger, so verification '
  'naturally restarts at that point. RAISE-free; returns jsonb '
  '{ok, broken_at_id, expected_hash, actual_hash, chain_head_hash, '
  'row_count}. row_count reflects rows verified in this run, not total '
  'chained rows. Anti-theater: pre-disclosure history is preserved in '
  'the table and queryable; only the verification scope shifts.';
