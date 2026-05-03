# Resilience Review

## Summary

`proxy/src/index.ts` is the customer-facing edge worker for ailedger: it sits on the request path of every LLM call, terminates Stripe webhooks, and writes the tamper-evident audit chain. The happy paths are clear and the use of `ctx.waitUntil` for logging is correct in spirit, but resilience is thin in two places that matter most for this product: **(1) the audit-log write is best-effort with no retry/DLQ**, which silently breaks the very guarantee the proxy exists to provide, and **(2) the Stripe webhook returns 200 to Stripe before persisting subscription state**, so a transient Supabase failure permanently desyncs billing because Stripe will not retry. Beyond those, the top-level `fetch` handler has no try/catch (a thrown error becomes a generic Cloudflare 1101 with no operator visibility), there is no upstream timeout/abort, and several `await request.json()` / `JSON.parse` sites can throw on malformed input and bubble up as unhandled errors.

The error handling that does exist is mostly *security-correct* (signature verification, key resolution) but *operationally opaque* — failures are either swallowed (`catch {}`) or written only to `console.error`, with no structured fields, no correlation IDs, and no signal back to the caller. For a worker that brokers money and audit data, an operator paged at 3 AM has very little to work with.

## Critical Issues

### C1. Stripe webhook acks before persistence — billing desync on transient failure
**File:** `proxy/src/index.ts:332`, `:436-439`

```ts
ctx.waitUntil(processStripeEvent(event, env));
return new Response(JSON.stringify({ received: true }), { ... });   // 200 to Stripe
```

`handleStripeWebhook` returns `200 received: true` *before* `upsertSubscription` runs, and `upsertSubscription` only logs on failure (`console.error('Subscription upsert failed: ...')` at line 438). Stripe interprets the 200 as "delivered" and **will not retry**. Result: a 1-second Supabase blip during `checkout.session.completed` permanently leaves the customer in a paid-but-unrecorded state — they get billed by Stripe, but `checkUsageLimit` never finds an active subscription and 429s them at 10k/month, *and* there's no record we can use to reconcile.

**Fix:** Process the event synchronously (or at least await `upsertSubscription`) and return non-2xx on persistence failure so Stripe retries via its built-in exponential backoff. If you want webhook latency low, write the raw event to a durable queue (KV with TTL, Queues, or a `pending_stripe_events` table) inside the request, and return 200 only after that durable write — then a separate processor handles upsert with retries.

### C2. Audit log loss is silent and unrecoverable
**File:** `proxy/src/index.ts:145-162`, `:774-777`

`logInference` is invoked via `ctx.waitUntil`, and on Supabase write failure does only:
```ts
if (!res.ok) {
    const body = await res.text();
    console.error(`Supabase insert failed: ${res.status} ${body}`);
}
```
There is no retry, no DLQ, no fallback. The product positioning is "immutable audit records" — but a 500 from Supabase, a network blip, or a row-level constraint violation drops the record entirely while the customer's API call already returned 200. The chain (`chain_prev_hash` from the trigger) does not detect *missing* entries, only tampered ones, so a gap would be invisible.

**Fix (in priority order):**
1. On `!res.ok`, write the entry to a fallback store: KV under `pending_log:<uuid>` with TTL, or Cloudflare Queues. A scheduled worker drains these.
2. Add at least one bounded retry with jitter for 5xx / network errors (`fetch` itself can throw — that path isn't even handled today).
3. Emit a structured log line (not just `console.error`) with `customer_id`, `provider`, `started_at`, and the response body so an operator can manually replay.

### C3. Top-level `fetch` handler has no try/catch
**File:** `proxy/src/index.ts:39-169`

Any throw from `await fetch(upstreamRequest)` (DNS failure, TLS error, upstream RST, AbortError if a timeout is ever added), `await upstreamResponse.arrayBuffer()`, or `await request.arrayBuffer()` (e.g. body too large, client disconnect) propagates out of the handler. Cloudflare returns a generic `1101 Worker threw exception` page — the customer sees no actionable error, and no log line is recorded for the failed request because the `waitUntil(logInference(...))` is never registered. The proxy is *less* observable when its own dependencies are sick.

**Fix:** Wrap the body of `fetch` in a try/catch that returns a 502/504 JSON body with an `x-ailedger-error-id` header (a UUID also emitted to `console.error`) so support can correlate. Even without retries, this turns a black-box failure into something the customer can include in a ticket.

## Major Issues

### M1. No timeout / AbortController on upstream fetch
**File:** `proxy/src/index.ts:137`

```ts
const upstreamResponse = await fetch(upstreamRequest);
```

If OpenAI/Anthropic/Gemini hangs (TCP established but no data), the worker hangs until Cloudflare's CPU/wall-clock limit kills it (~30s on paid). The customer's SDK is also waiting, holding their connection. There is no way for the proxy to fail fast and surface a clean 504 with an error id.

**Fix:** Use `AbortController` with a configurable per-provider timeout (e.g. 60s for chat completion, 120s for image gen) and on `AbortError` return `504 Upstream timeout` plus log entry. Streaming responses (SSE) need a separate read-side timeout — see M5.

### M2. Streaming responses (SSE) are buffered, defeating streaming
**File:** `proxy/src/index.ts:141, 164-168`

```ts
const responseBody = await upstreamResponse.arrayBuffer();
...
return new Response(responseBody, { status: ..., headers: upstreamResponse.headers });
```

Every response — including `text/event-stream` from OpenAI/Anthropic — is fully buffered before being returned. A 60-second streaming chat completion appears as a 60-second hang to the customer's SDK and risks hitting the worker's wall-clock or the 100MB per-request limit. The audit-log path forces this (we hash the whole body), but the customer's resilience suffers: a slow upstream is no longer "slow but flowing", it's "appears hung".

**Fix:** For `text/event-stream` (or generally when `transfer-encoding: chunked`), use `response.body.tee()` so one branch streams to the customer and the other accumulates for hashing. Comments at lines 482-488 already acknowledge SSE goes through the raw-byte path; the implementation can preserve streaming and still hash.

### M3. `metadata` lookup will lose `supabase_user_id` on subscription updates
**File:** `proxy/src/index.ts:381-393`

For `customer.subscription.updated` and `customer.subscription.deleted`, the code reads `metadata` off the subscription object. **Stripe does not propagate session-level metadata onto subsequent subscription update events** unless you set it on the subscription itself. The `subscription_data.metadata` field at line 225-226 *does* set it on the subscription, so this is OK *today* — but it's fragile: any future change that uses `customer.created` metadata, or sends an update via the API without preserving metadata, silently drops the user binding (then `supabaseUserId` becomes `null` on every subsequent update and the row's `supabase_user_id` is never patched).

**Fix:** Drop the `metadata?.['supabase_user_id']` reliance for update/delete events. Look up the existing row by `stripe_customer_id` and use its `supabase_user_id`. The current `...(supabaseUserId && { supabase_user_id: supabaseUserId })` spread *does* avoid clobbering with null, but only because of the conditional spread — the constraint is implicit and easy to break.

### M4. Request and response fully buffered into memory — no size limits
**File:** `proxy/src/index.ts:117, 141`

`request.arrayBuffer()` and `upstreamResponse.arrayBuffer()` each materialize the full payload. For an OpenAI Vision request with a base64 image plus a multi-megabyte completion, you can approach the worker's per-isolate memory ceiling (~128 MB). There's no upfront `content-length` rejection. Combined with no timeout (M1), a malicious or buggy client could hold a slot for the full CPU window with a slow-loris body.

**Fix:** Reject `content-length` > N MB at the door (e.g. 25 MB request, 100 MB response) with a 413, before reading the body. Pair with the streaming fix in M2 so well-behaved streaming isn't penalized.

### M5. `verifyStripeSignature` uses non-constant-time comparison
**File:** `proxy/src/index.ts:363`

```ts
if (computed !== v1) return null;
```

`!==` on strings is short-circuit. Practical exploitability is limited (Workers' jitter dwarfs the timing delta), but Stripe's official libraries explicitly use `crypto.timingSafeEqual`. Same issue at `verifyStandardWebhook:586`.

**Fix:** Compare bytes with a constant-time loop (XOR-accumulate over equal-length byte arrays). Cheap to implement, removes a class of finding from any future security audit.

### M6. `checkUsageLimit` fails open *and* the failure mode is invisible
**File:** `proxy/src/index.ts:679`

```ts
if (!countRes.ok) return false; // fail open
```

A 500 from Supabase here means **every free-tier user becomes unlimited** for the duration of the outage, with no log line, no metric, no alert. This may be the right product call (don't block paying behavior on an internal blip), but right now there's no way to detect it has happened or estimate the revenue impact.

**Fix:** Keep fail-open, but `console.error` the status + body, and consider a short-lived KV flag (`usage_limit_degraded=1`, TTL 60s) that an external monitor can scrape via `/health`.

### M7. Inconsistent fail-open vs. fail-closed across Supabase calls
**File:** `proxy/src/index.ts:542` (`resolveApiKey`) vs `:679` (`checkUsageLimit`)

`resolveApiKey` fails *closed* (Supabase down → all customers get 401, even with valid keys). `checkUsageLimit` fails *open* (Supabase down → free tier becomes unlimited). During the same outage, paying customers get locked out while free customers get free inferences. The KV cache at line 528 partially masks this for repeat keys (5-min TTL), but cold cache during an outage will lock everyone out.

**Fix:** Decide and document the policy. Most customer-facing proxies fail-open on auth during *outage* (return 503 if cache missed *and* Supabase down — caller can retry), or extend the KV cache TTL grace period to keep last-known-good keys alive longer. At minimum, log when the KV path served from cache vs. fell through.

## Minor Issues

### m1. `JSON.parse` and `request.json()` calls without try/catch
**Lines:** `:209` (checkout body), `:244` (Stripe checkout response), `:289` (subscription rows), `:368` (Stripe webhook payload — wrapped), `:602` (signup hook body), `:730` (request body for model name — wrapped).

The wrapped sites are fine. The unwrapped sites throw on malformed input and bubble up as the same C3 unhandled-exception case. `handleCreateCheckoutSession` line 209 is most exposed (untrusted client input). A bad body produces a 1101, not a 400.

**Fix:** Wrap these in try/catch returning 400 with a clear message.

### m2. Stripe checkout/portal upstream calls have no retry
**Lines:** `:229`, `:299`

A transient 500/timeout from Stripe is surfaced as `500 Failed to create checkout session`. Customers will hit the upgrade button, see an error, and assume the product is broken. Even one bounded retry on 5xx / network would dramatically improve perceived reliability.

### m3. Empty `catch {}` swallows useful diagnostics
**Lines:** `:369-371`, `:587-589`, `:732-734`

The signature-verify catches return null (correct — we don't want to leak whether the failure was crypto vs. parse). But there's no `console.error` for diagnostic purposes. A misconfigured webhook secret looks identical to an attacker probing — operators can't distinguish. Log the *type* of error (`err.name`) without the payload.

### m4. `KV.put` in `checkUsageLimit` is not in `ctx.waitUntil`
**File:** `:655`

```ts
env.AILEDGER_CACHE.put(paidCacheKey, 'true', { expirationTtl: 300 });
```

The other KV.put calls (`:550`, `:551`) are properly registered. Without `waitUntil`, this promise can be cancelled when the response returns, and the cache may not be populated — so the next request still pays the Supabase round-trip. Functional impact is "no cache benefit", not correctness, but it's an inconsistency.

**Fix:** Wrap in `ctx.waitUntil(...)`. The function would need `ctx` plumbed through.

### m5. `rows[0]` access without length guard
**File:** `:295`, `:547`

`rows[0].stripe_customer_id` (line 295) is preceded by a `!rows.length` check (good). `rows[0].customer_id` (line 547) is preceded by `if (!rows.length) return null;` (good). Pattern is correct — flagging here only because the type cast `as { customer_id: string; ... }[]` masks any actual schema drift.

**Fix:** Optional — replace `as` casts with a runtime shape check (e.g. zod or hand-rolled) at the boundary, since these come from an external service.

### m6. Subscription upsert has no idempotency key
**File:** `:417`

`Prefer: resolution=merge-duplicates` deduplicates by *primary key* (presumably `stripe_subscription_id`), so re-delivering the same Stripe event is safe at the row level. But there's no audit trail of "we processed event X" — debugging a "did we get this webhook?" question requires guessing.

**Fix:** Optional — log every webhook with `event.id` plus outcome. A tiny `processed_stripe_events` table also gives you idempotency at the *event* layer, not just the row layer, which matters once event handlers do anything beyond a single row write.

### m7. `signup-hook` logs full payload to console
**File:** `:594, :603`

```ts
console.log('Signup hook payload:', bodyText);
console.log('Signup hook parsed body:', JSON.stringify(body));
```

Supabase signup payloads include the user's email, the magic-link token, and metadata. These end up in Cloudflare's tail logs (limited retention but accessible to anyone with worker logs access). Token in logs = silent privilege escalation if logs are exfiltrated. The token from `email_data.token_hash` is reusable until it hits TTL.

**Fix:** Don't log the raw body, or at minimum redact `token_hash` and `email`. The structured log should be `{ event: 'signup-hook', action: actionType, has_email: !!email }`.

### m8. `latency_ms` not recorded on upstream failure
**File:** `:135-138, 162`

If the upstream request throws, `logInference` never runs, so we have no record that the customer made a request, what they tried, or how long it took. Combined with C2/C3, partial-failure visibility is poor.

**Fix:** Restructure so `logInference` is called from a `finally`-style path with whatever data is available, even if `responseBody` is null and `statusCode` is 0/upstream-error.

## Observations

- **Worker CPU limits and `canonicalize`:** RFC 8785 canonicalization on a 5 MB nested JSON body is non-trivial CPU, and runs synchronously on the request path (well, on the `waitUntil` path — which is bounded by the same wall-clock). For very large request bodies, the JCS path may starve the audit log. Worth measuring before it bites in prod.
- **`processStripeEvent` only handles three event types:** Subscription pause/resume, payment failures, and trial-related events (`customer.subscription.trial_will_end`, `invoice.payment_failed`) all fall through silently. Not a resilience issue *per se*, but it means a paused subscription stays `status='active'` in our DB, so the limit isn't enforced.
- **`PRICE_IDS` is hardcoded** — schema/SKU drift between Stripe and the worker is a deploy-coordination hazard. Consider fetching live from Stripe with a long KV cache, or a staging-vs-prod env-var indirection.
- **Health endpoint `/health` returns `{status: 'ok'}` regardless of dependency health.** A real check would attempt a cheap KV read and a Supabase select with timeout, and report `degraded` rather than `ok` when either is slow. Without this, dashboards and ops scripts can't tell the proxy is falling over.
- **No structured logging.** Every `console.error` is a freeform string. A standard JSON envelope (`{level, ts, customer_id, route, status, latency_ms, error_kind}`) would make these logs greppable in Logpush/Datadog without per-line regex. Big leverage for low effort given how observability-thin this code is.
- **`response.headers` forwarded verbatim:** OpenAI sometimes sets `cf-cache-status`, `set-cookie`, and `transfer-encoding: chunked`. Workers strip hop-by-hop headers automatically, but explicit allowlisting (or at least dropping `set-cookie`) is more defensible than relying on runtime behavior.
