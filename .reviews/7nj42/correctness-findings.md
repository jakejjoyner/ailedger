# Correctness Review

**Target:** `proxy/src/index.ts` (778 lines)
**Focus:** Logical correctness, edge case handling
**Reviewer:** ailedger/polecats/fury (leg: correctness, bead: ai-leg-henyk)

## Summary

The proxy worker is straightforward in shape: route → authenticate → rate-limit
→ forward upstream → log async. The core hashing (`sha256jcs`) and Stripe
signature verification are well thought out. However, several correctness bugs
will produce real production incidents: streaming responses are silently
broken, the Stripe webhook always returns 200 (so transient Supabase failures
permanently lose events), the API-key cache has no invalidation path (revoked
keys keep working for up to 5 min), and the "paid" check accepts only
`status === 'active'` which excludes `trialing` and `past_due` — those
customers will be incorrectly rate-limited.

The biggest concern is the streaming bug (P0). OpenAI/Anthropic clients with
`stream: true` are a primary use case; `await upstreamResponse.arrayBuffer()`
buffers the entire response, defeating SSE entirely. Customers will see hangs
followed by a single delivered blob, which is functionally a regression
versus calling the upstream directly.

## Critical Issues

### C1. Streaming responses are silently broken — `index.ts:141, 164-168`
```ts
const responseBody = await upstreamResponse.arrayBuffer();
...
return new Response(responseBody, { status: ..., headers: upstreamResponse.headers });
```
`arrayBuffer()` waits for the entire upstream response before returning. For
`text/event-stream` (OpenAI/Anthropic streaming) this means the client sees
nothing until upstream closes the connection, then receives the entire SSE
stream at once — the opposite of streaming.

Worse, the response `headers` are passed through verbatim, so `content-length`
will be re-derived by the runtime, but `transfer-encoding: chunked` /
`content-encoding` headers from the upstream may now misrepresent the buffered
body.

**Impact:** Streaming chat completions, tool-use deltas, and Anthropic
event streams are unusable. Audit-log hashes are still computed (good), but
the proxy is effectively non-functional for the majority of inference traffic.

**Fix:** Tee the body so the client sees a streamed `ReadableStream` while a
parallel pipe accumulates bytes for hashing in `ctx.waitUntil`. Sketch:
```ts
const [clientStream, hashStream] = upstreamResponse.body!.tee();
ctx.waitUntil((async () => {
  const buf = await new Response(hashStream).arrayBuffer();
  await logInference({ ..., responseBody: buf, ... });
})());
return new Response(clientStream, {
  status: upstreamResponse.status,
  headers: upstreamResponse.headers,
});
```
For SSE, the `responseContentType` will be `text/event-stream`, which already
falls out of `isJsonContentType` and into raw-byte hashing — that part is
correct.

### C2. Stripe webhook returns 200 even when processing fails — `index.ts:332-336`
```ts
ctx.waitUntil(processStripeEvent(event, env));
return new Response(JSON.stringify({ received: true }), { ... });
```
`processStripeEvent` swallows Supabase write errors via `console.error` only.
Because the worker has already returned 200, Stripe will not retry. A transient
Supabase outage during a `checkout.session.completed` event permanently drops
the subscription record — the customer is charged but never marked as paid in
your DB.

**Impact:** Silent revenue / entitlement loss on every Supabase blip. The user
can ostensibly self-heal via `customer.subscription.updated` later, but the
initial provisioning is gone.

**Fix:** Make `processStripeEvent` synchronous (or `await` it before returning),
and return 5xx if the upsert fails. Stripe will then retry per its standard
exponential-backoff policy.

### C3. API key cache never invalidated on revocation — `index.ts:522-565`
The KV cache `key:${keyHash}` has a 5-minute TTL but no invalidation hook. If
an admin deletes / disables a row in `api_keys`, the worker will continue to
authenticate the key for up to 5 minutes from any region that has the entry
cached.

**Impact:** Compromised key revocation is delayed by up to 5 minutes — during
which an attacker can continue making logged inference calls. The cached
record also doesn't carry a "disabled" bit, so even an admin-side soft-disable
column wouldn't take effect until TTL expiry.

**Fix:** Either (a) shorten TTL to ~30s, or (b) add a `key_revoked:${keyHash}`
sentinel that admin operations write, checked alongside the cache, or
(c) include `disabled_at` in the cached object and respect it.

## Major Issues

### M1. `checkUsageLimit` only treats `status === 'active'` as paid — `index.ts:651-656`
```ts
const active = subs.find((s) => s.status === 'active');
if (active) { ... return false; }
```
Stripe statuses include `trialing`, `past_due`, `incomplete`,
`incomplete_expired`, `canceled`, `unpaid`. A customer in `trialing` is
typically still entitled (Stripe explicitly distinguishes from `active` only
because they haven't paid yet). With this code, a trialing customer is
rate-limited at 10k/month exactly like a free user — likely not the intended
business logic.

**Fix:** Allow at minimum `['active', 'trialing']`, and decide explicitly how
to treat `past_due` (grace-period vs. enforce limit).

### M2. `paid:${customerId}` cache not invalidated on cancellation — `index.ts:633-658`
Mirror of C3 for the paid-status cache. When a `customer.subscription.deleted`
webhook arrives, `upsertSubscription` writes status `canceled` to Supabase
but does not invalidate the KV cache key `paid:${customerId}`. The customer
continues to bypass rate limits for up to 5 more minutes after cancellation.

**Fix:** In `processStripeEvent` (specifically the `updated` and `deleted`
branches), look up the supabase_user_id and `env.AILEDGER_CACHE.delete(...)`
the corresponding cache key as part of the upsert flow.

### M3. Supabase outage rate-limits paid customers — `index.ts:640-657`
```ts
if (subRes.ok) { ... }
// fall through to free-tier counting
```
If `subRes` is not ok (Supabase 5xx, network error), the code silently falls
through to counting this month's inference logs. A paid customer will be
treated as free, hit 10k, and get 429s during a Supabase outage — even though
they have an active subscription.

**Fix:** On `!subRes.ok`, fail closed in favour of the customer (return false /
do not enforce limit), or fall back to the most recent cached paid status if
present.

### M4. `customerId` semantics conflated across tables — `index.ts:547, 641`
`resolveApiKey` returns `customerId: rows[0].customer_id` (from `api_keys`),
but `checkUsageLimit` then queries
`subscriptions?supabase_user_id=eq.${customerId}` — i.e. it treats the
api_keys.customer_id as a Supabase auth user UUID. This works only if the
schema is actually using the auth user UUID as the api_keys.customer_id
column. If `api_keys.customer_id` is a separate "customer" entity ID (e.g.
the org/team that owns multiple Supabase users), this is wrong and will
silently fail to find the active subscription, dropping every paid user into
the free tier.

**Action:** Confirm the schema invariant. If `api_keys.customer_id` IS a
supabase_user_id, rename it for clarity. If it is not, the join in
`checkUsageLimit` is broken.

### M5. `verifyStripeSignature` accepts non-numeric timestamps — `index.ts:366`
```ts
if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return null;
```
`Number('abc')` is `NaN`, `Math.abs(NaN)` is `NaN`, and `NaN > 300` is
`false`. So a malformed `t=` value passes the freshness check.

In practice the HMAC at line 358 is computed over `${timestamp}.${payload}`,
so a forged event still fails signature comparison — but the freshness
guarantee is the explicit defense against replay-of-a-once-valid event with
known signature. Add an explicit `Number.isFinite(Number(timestamp))` guard,
or `if (!/^\d+$/.test(timestamp)) return null;` at line 348.

### M6. `Object.fromEntries(sig.split(',').map((p) => p.split('=')))` loses values containing `=` — `index.ts:345`
Stripe v1 signatures are hex so this is currently safe, but the parsing is
brittle. Prefer `p.split('=', 2)` or a manual loop. Same pattern is fine
in `verifyStandardWebhook` because it only uses `.replace(/^v1,whsec_/, '')`.

## Minor Issues

### m1. `monthStart` uses local time — `index.ts:661-663`
```ts
const monthStart = new Date();
monthStart.setDate(1);
monthStart.setHours(0, 0, 0, 0);
```
`setDate` / `setHours` set local-time fields. Cloudflare Workers runs in UTC,
so this is correct in practice, but fragile if the runtime ever moves. Use:
```ts
const now = new Date();
const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
```

### m2. OpenAI path normalization edge case — `index.ts:111-113`
`if (!upstreamPath.startsWith('/v1'))` will not prepend on `/v1beta` (already
starts with `/v1`), but also not on weird inputs like `/v10/anything`. Realistic
OpenAI paths are unaffected; flag for awareness only.

### m3. Counting query returns row data unnecessarily — `index.ts:665-678`
`select=id` with `Range: 0-0` still returns one row. Adding
`Prefer: count=exact, head=true` (no body) would shave latency. Fine as-is.

### m4. `parseInt(contentRange.split('/')[1] ?? '0', 10)` — `index.ts:682`
If Supabase returns `*/*` (count unavailable), `parseInt('*', 10)` is `NaN`,
and `NaN >= 10_000` is `false`, so the worker fails open. Probably the
intended behaviour, but worth a comment.

### m5. `processStripeEvent` typecast chain — `index.ts:376`
```ts
const data = (event['data'] as Record<string, unknown>)['object'] as Record<string, unknown>;
```
Throws if `event.data` or `event.data.object` is missing. Signature-verified
events from Stripe always have these, but a defensive `if (!data) return;`
would prevent an unhandled rejection inside `ctx.waitUntil`.

### m6. `handleSignupHook` JSON.parse without guard — `index.ts:602`
Signature is verified first, so payload is trusted, but a single
`try { ... } catch` would convert a malformed payload into a 4xx instead of
a 500.

### m7. `user-agent` stripped from upstream forward — `index.ts:124-126`
Required to dodge OpenAI's SDK-from-datacenter-IP block. Be aware Anthropic
historically required a non-empty `User-Agent`; if Anthropic forwarding
starts 4xx-ing, restore a minimal UA for the anthropic provider only.

### m8. `forwardHeaders` may pass through `content-length` from a body that the runtime will re-encode
Pass-through `Headers` includes Cloudflare-managed headers like
`content-encoding`. Workers may transparently decompress, which would make the
forwarded `content-encoding: gzip` header a lie about the body. Usually
fetch() in Workers handles this, but worth a runtime check.

### m9. `upstreamResponse.headers` re-emitted on response — `index.ts:167`
Includes upstream `set-cookie`, `cf-*`, and content negotiation headers.
Generally desirable for transparent proxying, but consider stripping
`set-cookie` (you don't want OpenAI / Stripe cookies leaking to the client).

## Observations

- **Idempotency of webhooks:** good — `Prefer: resolution=merge-duplicates`
  on `upsertSubscription` means Stripe redeliveries won't duplicate rows.
  But duplicate-key resolution is on the Supabase `subscriptions` table's
  declared unique constraint — verify the constraint matches your intent
  (one row per `stripe_customer_id`? per `stripe_subscription_id`?). A
  customer with multiple subscriptions could lose history if it's per
  customer.

- **Tamper-evident chain:** the comment at line 742 correctly notes that
  the BEFORE-INSERT trigger handles `chain_prev_hash` to avoid a worker-side
  race. This is the right architecture.

- **Fail-open default in `checkUsageLimit` (line 679):** `return false` on
  count-query failure is the right call (don't lock customers out on a
  Supabase blip), but the same logic should be extended to the paid-status
  query (see M3).

- **JCS canonicalization (`sha256jcs`):** the fall-through to raw-bytes on
  parse failure / JCS rejection (line 511-516) is correctly defensive and
  the comment block (467-488) is excellent — one of the cleanest pieces of
  code in the file.

- **`isJsonContentType` accepts `+json` but not `text/json`:** matches RFC
  6839; the long tail of non-conforming providers using `text/json` won't
  hit the JCS path. Probably fine.

- **No retries / circuit breaking on Supabase calls:** every Supabase fetch
  has a single attempt. Under partial Supabase outage, latency spikes
  propagate directly to customer requests. Consider a deadline (AbortSignal)
  on `checkUsageLimit` and `resolveApiKey` to bound worst-case latency.
