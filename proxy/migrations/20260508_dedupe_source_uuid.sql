-- Migration: per-source-event deduplication on ledger.inference_logs
-- Context: sidecar callers (e.g., the Vernier session-jsonl tail-and-ship
-- daemon) may re-process the same source event across runs (cron retries,
-- crash-resume, idempotent replay windows). Without a dedupe key, every
-- replay extends the chain with a duplicate row. We want at-most-once
-- semantics keyed on the caller's own stable event id.
--
-- Run in the Supabase SQL editor. Idempotent: safe to re-run.

-- ─── Column (additive, nullable) ────────────────────────────────────────────
-- Nullable so the existing in-line proxy path (no source UUID; HTTP-request-
-- as-source-of-truth) is unaffected. Sidecar callers populate it.
alter table ledger.inference_logs
  add column if not exists source_uuid text;

-- ─── Unique partial index ──────────────────────────────────────────────────
-- Per-customer uniqueness on source_uuid when supplied. NULL values are
-- excluded so legacy + in-line-proxy rows never conflict.
create unique index if not exists inference_logs_customer_source_uuid_uidx
  on ledger.inference_logs (customer_id, source_uuid)
  where source_uuid is not null;
