# Code Smells Review

**Target:** `proxy/src/index.ts` (778 lines, single-file Cloudflare Worker)
**Reviewer:** ailedger/polecats/thunder
**Leg:** smells

## Summary

`proxy/src/index.ts` is a single-file Worker doing five distinct jobs (proxy, Stripe checkout, Stripe portal, Stripe webhook, Supabase signup hook) plus shared crypto/cache/log helpers. It works, but it has significant **DRY violations** between the Stripe/Supabase HTTP handlers, **primitive-obsession** around Supabase fetches (apikey + Authorization + profile headers are re-typed inline ~6 times), and **shotgun-surgery risk** in `processStripeEvent` where three near-identical branches each re-extract `customer/id/metadata/plan` independently. The biggest near-term pain point: any change to how the worker talks to Supabase or Stripe means editing 4–6 separate fetch sites in lockstep. The biggest hidden risk: type assertions (`as Record<string, unknown>`, `as { url: string }`, `as { customer_id: string }[]`) replace runtime validation throughout, so a schema drift in Supabase or Stripe responses fails silently rather than producing a clear error.

Technical debt is being **added faster than paid down**: three commented-out feature blocks (drip emails, signup welcome email, schedule handler — all dated 2026-04-30 with the same justification) sit in the file unrenamed, and `PRICE_IDS` hardcodes prod Stripe IDs at module scope with no env indirection.

## Critical Issues

_None._ Nothing in this file is a P0 merge-blocker on smells alone — the file is functional and the smells are maintainability issues, not correctness bugs. (The `console.log(bodyText)` before signature verification at line 594 is borderline; flagged as Major below since it touches secrets.)

## Major Issues

### 1. Pre-verification logging of unverified webhook payload — `index.ts:593-594, 602-603`
```ts
const bodyText = await request.text();
console.log('Signup hook payload:', bodyText);  // logged BEFORE verifyStandardWebhook
...
const body = JSON.parse(bodyText) as Record<string, any>;
console.log('Signup hook parsed body:', JSON.stringify(body));
```
**Impact:** The signup payload contains the user's email and (in Send Email mode) a `token_hash` that is effectively a password-reset / magic-link credential until consumed. Logging it unconditionally in Workers logs widens the blast radius of a logs-access compromise, and logging *before* signature verification means an attacker can stuff your log pipeline with arbitrary content for free.
**Fix:** Drop the `bodyText` log entirely, or move both logs *after* `verifyStandardWebhook` returns true and redact `email_data.token_hash` before logging.

### 2. CORS + JWT-auth preamble duplicated verbatim across two handlers — `index.ts:182-207` vs `250-275`
The `cors` object, the OPTIONS short-circuit, the `Authorization: Bearer …` extraction, the Supabase `/auth/v1/user` round-trip, and the failure response are all **byte-identical** between `handleCreateCheckoutSession` and `handleBillingPortal`. Adding a third dashboard endpoint (or changing the allowed origin, the auth scheme, or the error shape) requires editing both copies.
**Fix:** Extract `requireDashUser(request, env): Promise<{ user, cors } | Response>` returning either the authenticated user + cors headers or an early Response. Same shape works for both call sites.

### 3. Three near-identical branches in `processStripeEvent` — `index.ts:378-407`
```ts
if (type === 'checkout.session.completed') { /* extract customer/sub/meta, upsert active */ }
else if (type === 'customer.subscription.updated') { /* extract same fields, upsert status */ }
else if (type === 'customer.subscription.deleted') { /* extract same fields, upsert canceled */ }
```
Each branch re-extracts `customerId`, `subscriptionId`, `metadata.supabase_user_id`, `metadata.plan` — only the status string and the field name for the subscription id (`subscription` vs `id`) differ. This is textbook shotgun surgery: every Stripe metadata change has to be applied three times.
**Fix:** Pull a `extractSubscriptionFields(type, data) → { customerId, subscriptionId, status, supabaseUserId, plan } | null` and call `upsertSubscription` once.

### 4. Supabase fetch boilerplate duplicated 6× — `index.ts:198-203, 266-271, 278-287, 417-425, 531-540, 552-562, 640-649, 665-677`
Every Supabase REST call re-types the same headers:
```ts
{ apikey: env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  'Accept-Profile': 'ledger',  // or 'Content-Profile' on writes
  ... }
```
Plus the `${env.SUPABASE_URL}/rest/v1/...` URL prefix. There is no `supabaseFetch(env, path, init)` helper; instead the service-role bearer + apikey + ledger-profile triplet is hand-assembled at every call site. A single typo on a header in one site (e.g. forgetting `Accept-Profile: ledger`) produces a confusing 404 because PostgREST quietly serves the `public` schema.
**Fix:** `supabaseFetch(env, path, { method, body, profile: 'read'|'write' })` that injects the headers and prepends the base URL.

### 5. `PRICE_IDS` hardcoded prod Stripe IDs at module scope — `index.ts:174-179`
```ts
const PRICE_IDS: Record<string, string> = {
  pro_monthly: 'price_1TKu0LD6WkAFuxKjcrRG4LvD',
  ...
};
```
**Impact:** Test and prod cannot diverge without a code change. There is no staging-mode equivalent. If Stripe price IDs ever rotate (e.g. price restructuring) the proxy must be redeployed in lockstep with the dashboard.
**Fix:** Move to env vars (`env.STRIPE_PRICE_PRO_MONTHLY`, etc.) on the `Env` interface, or a single `STRIPE_PRICE_IDS_JSON` parsed at module load.

### 6. `as`-cast type assertions replace validation throughout
Examples: `index.ts:207` (`as { id: string; email: string }`), `244` (`as { url: string }`), `289` (`as { stripe_customer_id: string }[]`), `374-381` (`event['type'] as string`, `event['data'] as Record<string, unknown>`), `544` (`as { customer_id: string; system_id: string | null }[]`), `602` (`as Record<string, any>`), `651` (`as { status: string; plan: string }[]`).
**Impact:** When Supabase or Stripe changes a response shape, the worker doesn't error — it returns `undefined` deep in business logic, e.g. `session.url` becomes `undefined` and the dashboard gets a JSON body with `url: undefined`. Failures surface far from the cause.
**Fix:** Either a tiny runtime-validator (`zod` is heavy for Workers; a hand-rolled `assertHasString(obj, key)` is fine) or at minimum `if (!session?.url) return 500`.

## Minor Issues

### 7. Magic numbers repeated — cache TTL `300`, free-tier cap `10_000`
- `index.ts:366` — Stripe replay window: `300` seconds, with the unit only in a sibling comment
- `index.ts:550` — KV cache TTL: `expirationTtl: 300`
- `index.ts:655` — KV paid-status TTL: `expirationTtl: 300`
- `index.ts:683` — free-tier monthly inference cap: `total >= 10_000`
**Fix:** `const FIVE_MINUTES_SEC = 300;` and `const FREE_TIER_MONTHLY_LIMIT = 10_000;` near the top.

### 8. `logInference` parameter object is a 14-field data clump — `index.ts:691-721`
The single-call-site object literal is fine ergonomically, but the shape is identical to the `entry` payload built inside the function (lines 746–760) modulo three derived fields. Strong sign there's a missing `InferenceLogEntry` type that should be defined once and shared with the trigger-aware insert path.
**Fix:** Define `type InferenceLogInput = { ... }` and reuse for the param shape and the entry literal.

### 9. Stripe error-handling triplet duplicated — `index.ts:238-242` vs `308-312`
Same `if (!stripeRes.ok) { const err = await stripeRes.text(); console.error(...); return 500 }` block twice.
**Fix:** Folds naturally into the same Stripe helper as #4 (or a dedicated `stripeFetch`).

### 10. `filterHeaders` mixes two responsibilities — `index.ts:444-453`
Accepts an explicit `drop: string[]` *and* hardcodes `k.startsWith('x-stainless-')`. The caller passes a list of stainless-* headers anyway (lines 124-127), so the prefix-match is either redundant with the list or a belt-and-suspenders catch-all. Pick one; right now a reader has to reconcile two strip mechanisms.
**Fix:** Either drop the explicit `x-stainless-*` entries from the call site (relying on the prefix check) or remove the prefix check and let the call-site list be authoritative.

### 11. `checkUsageLimit` cache write is fire-and-forget but **not** wrapped in `ctx.waitUntil` — `index.ts:655`
```ts
env.AILEDGER_CACHE.put(paidCacheKey, 'true', { expirationTtl: 300 });
```
Other writes in this file (line 550, 551-563) correctly use `ctx.waitUntil`. Without it, Cloudflare can cancel the unawaited promise as soon as the response is returned, so the cache may not be written and the next request re-hits Supabase. Inconsistent with the rest of the file.
**Fix:** Thread `ctx` into `checkUsageLimit` (it's already in scope at the call site, line 100) and `ctx.waitUntil(env.AILEDGER_CACHE.put(...))`.

### 12. Duplicate `signup-hook` magic-link assembly hardcodes Supabase URL shape — `index.ts:617`
Building auth URLs by string concatenation works but couples the proxy to Supabase's URL contract; a future Supabase change (e.g. a `verify` rename) means a silent broken-link bug. Low impact while the "email send paths removed" comment (line 625) means the magic link is currently logged-only.
**Fix:** When email re-lands, gate this on a constant or extract `buildSupabaseVerifyUrl(env, tokenHash, actionType, redirectTo)`.

### 13. Decommissioned-feature comments accumulating — `index.ts:33-37, 625-628, 686-689`
Three blocks all dated 2026-04-30 with the same "Google-only directive, see memory/feedback_email_stack_google_only.md" justification. Per repo guidance ("Don't reference the current task, fix, or callers — those belong in the PR description"), these comments duplicate context already in the commit (`5651420 rip Resend and Brevo from email stack — Google-only directive 2026-04-30`).
**Fix:** Delete the comments; the deletion itself is in `git log`. If the function bodies are needed for a future re-add, that's what `git revert` is for.

### 14. `verifyStripeSignature` and `verifyStandardWebhook` share no common HMAC primitive — `index.ts:339-372` vs `568-590`
Both import an HMAC-SHA256 key, sign a `${a}.${b}.${c}` style string, and compare against a header value. Different signature formats (Stripe uses hex; Standard Webhooks uses base64 with `v1,` prefix) and different replay-window logic — but the import + sign step is identical.
**Fix:** Low priority — sharing crypto across two distinct verification protocols often hides bugs more than it removes them. Leave as-is unless a third webhook lands, then extract `hmacSha256(secret, message): Promise<ArrayBuffer>`.

## Observations

- **Single-file architecture is fine for the current size** (778 lines, 5 endpoints). The "split into routes/" reflex is premature here — the duplication is the real signal, not the file length. Fix duplication first; if that pushes the file past ~1000 lines, then split.
- **`scheduled` handler is currently a no-op** with only a removal comment (line 33). If `wrangler.toml` still wires up a cron trigger, this is silently consuming a scheduled-event slot. Worth confirming the cron trigger is also disabled.
- **`isJsonContentType` and `sha256jcs` are exported** (lines 489, 495) but nothing else in the file is — strong hint these are tested. Good. The JCS-choice rationale at lines 467-488 is a model example of a *useful* comment block (explains a non-obvious cross-SDK invariant).
- **No structured logging.** All logs are `console.log/.error` strings. Cloudflare Workers Logpush can ingest JSON; if observability becomes a goal, the email/payload logs become a much bigger redaction problem at the same time. Worth tackling together.
- **`processStripeEvent` could miss events.** No default branch / no log on unknown `type`. If Stripe starts sending `customer.subscription.paused` (now a real event type) the proxy silently drops it. Add a `console.warn(\`Unhandled stripe event: ${type}\`)` default to catch this.
- **Answer to "what would I refactor if I owned this code?"** — In order: (a) extract `supabaseFetch` (#4), (b) collapse the three Stripe webhook branches (#3), (c) extract `requireDashUser` (#2), (d) delete the three removed-feature comment blocks (#13). That's a single ~150-line refactor PR with no behavior change and a meaningful drop in surface area for the next change.
- **Answer to "is debt being added or paid down?"** — Added. The drip-email removal commit deleted code but left three explanatory tombstones. Net signal-to-noise of the file dropped.
