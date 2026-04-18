-- ai-55i: Anthropic multi-key upstream pool for failover.
-- Add column so inference_logs can attribute each request to the pool index
-- that ultimately served it. Non-pooled requests leave this NULL.

alter table ledger.inference_logs
    add column if not exists upstream_key_index int;

-- For querying per-key error rates in Scout / dashboards.
create index if not exists inference_logs_upstream_key_idx
    on ledger.inference_logs (upstream_key_index, logged_at desc)
    where upstream_key_index is not null;
