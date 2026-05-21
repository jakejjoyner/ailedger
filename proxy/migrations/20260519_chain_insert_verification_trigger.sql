-- Migration: AFTER INSERT verification trigger on ledger.inference_logs
--
-- Context: 2026-05-19 — verify_chain reported a break on Vernier's customer
-- (68d2edd5-dee9-411e-95e8-90b08760f791) at row id=51887, logged 2026-05-08.
-- The BEFORE INSERT trigger (migration 20260418_tamper_evident_chain.sql)
-- already takes a pg_advisory_xact_lock on the customer_id, which SHOULD
-- serialize chain extension per customer. The fact that a break exists means
-- one of:
--   (a) two concurrent inserts collided despite the advisory lock (hash
--       collision on hashtextextended, or lock acquired AFTER the SELECT)
--   (b) a non-trigger code path wrote chain_prev_hash directly
--   (c) data was manually mutated post-insert
--
-- This migration adds defense-in-depth: an AFTER INSERT row-level trigger
-- that re-computes the expected chain_prev_hash from the actual predecessor
-- and RAISEs if the stored value doesn't match. The BEFORE INSERT trigger
-- stays the authoritative writer; this one is the guardrail.
--
-- Effect on the existing break: this trigger only fires on FUTURE inserts;
-- the historical break at id=51887 is preserved as-is (anti-theater stance:
-- we don't rewrite chain data to make the dashboard green).
--
-- Run in the Supabase SQL editor. Idempotent.

create or replace function ledger.inference_logs_chain_verify_after()
returns trigger
language plpgsql
as $$
declare
  prev      ledger.inference_logs;
  expected  text;
  is_disc   boolean;
begin
  -- Skip legacy unchained rows.
  if new.chain_prev_hash is null then
    return null;  -- AFTER trigger return value is ignored
  end if;

  -- The genesis-disclosure row is the explicit reset point; its
  -- chain_prev_hash is the all-zero nil hash.
  is_disc :=
       new.provider = 'ailedger-system'
   and new.path     = '/_chain/genesis';

  -- Look up THIS row's actual predecessor — the most recent chained row
  -- before this one for the same customer (excluding self).
  select *
    into prev
    from ledger.inference_logs
   where customer_id = new.customer_id
     and chain_prev_hash is not null
     and id < new.id
   order by id desc
   limit 1;

  if is_disc or not found then
    expected := repeat('0', 64);
  else
    expected := ledger.canonical_hash(prev);
  end if;

  if new.chain_prev_hash is distinct from expected then
    raise exception
      'chain_break_detected: row id=% customer_id=% stored chain_prev_hash=% but predecessor canonical_hash=%',
      new.id, new.customer_id, new.chain_prev_hash, expected
      using errcode = 'integrity_constraint_violation';
  end if;

  return null;
end;
$$;

drop trigger if exists inference_logs_chain_verify_after on ledger.inference_logs;
create trigger inference_logs_chain_verify_after
after insert on ledger.inference_logs
for each row execute function ledger.inference_logs_chain_verify_after();

comment on function ledger.inference_logs_chain_verify_after() is
  'Defense-in-depth: re-verifies that the BEFORE INSERT trigger correctly '
  'set chain_prev_hash from the actual predecessor. RAISEs on mismatch so '
  'no broken row can ever commit. Pairs with ledger.inference_logs_chain_trigger '
  '(BEFORE INSERT). Added 2026-05-19 after a historical break was discovered '
  'at row id=51887 (Vernier customer, 2026-05-08).';
