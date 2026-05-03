# Style Review Review

## Summary

`proxy/src/index.ts` (778 lines, single-file Cloudflare Worker) is generally readable and follows the repo's `.prettierrc` for tabs/quotes/semis. However, it **fails `npx prettier --check src/index.ts`** with ~241 diff lines — the most material style finding, and a hard-blocker against the `npm run format` gate that CLAUDE.md mandates before commit. Beyond formatting, the file mixes log levels and verbosity (logs full webhook payloads at `console.log`), repeats magic numbers (`300` cache TTL, `10_000` free-tier limit) instead of naming them, has one stray `Record<string, any>` that bypasses `strict`, and contains one inconsistency where a comment claims "fire-and-forget" but the call isn't wrapped in `ctx.waitUntil` (line 655) — diverging from the matching pattern at lines 550–563.

The file also carries three near-identical "Drip email sequences removed 2026-04-30" tombstones (lines 34–36, 625–627, 686–689) — that history belongs in git, not in the source. Public exports (`isJsonContentType`, `sha256jcs`) have strong JSDoc; the rest of the helpers have none. Overall: medium polish; one P0 (formatter), several P1s, mostly stylistic P2s.

## Critical Issues

### P0-1: File fails `prettier --check` (blocks `npm run format` quality gate)
- **Where:** `proxy/src/index.ts` — multiple sites; ~241-line diff. Representative offenders:
  - `src/index.ts:102-105` — wrapped `new Response(...)` body that prettier would inline+reflow
  - `src/index.ts:124-127` — multi-token-per-line array literal (host/cf-connecting-ip/...) — prettier wants one element per line
  - `src/index.ts:161` — missing trailing comma after `})` in `ctx.waitUntil(...)` call
  - `src/index.ts:194, 205, 212, 241, 262, 273, 291, 311` — long single-line `new Response(...)` calls past `printWidth: 140`
  - `src/index.ts:207, 209, 244, 275, 289, 314, 544, 547, 651` — `await x.json() as T` should be `(await x.json()) as T`
  - `src/index.ts:278-287, 531-540, 552-563, 640-649, 665-677` — `fetch(url, {...})` call with positional URL on its own line that prettier collapses
- **Impact:** Polecat completion protocol (`CLAUDE.md` → "Quality gates are not optional") requires `npm run lint && npm run format && npm test` to pass before commit. As-is, format will fail. Any future edit that prettier rewrites will produce a noisy diff unrelated to the change.
- **Fix:** Run `npx prettier --write proxy/src/index.ts` and commit the reflow as a standalone change. No semantic risk.

## Major Issues

### P1-1: `Record<string, any>` defeats `strict`
- **Where:** `src/index.ts:602` — `const body = JSON.parse(bodyText) as Record<string, any>;`
- **Impact:** `tsconfig.json` enables `"strict": true`. The rest of the file is disciplined about typing (`Record<string, unknown>` at lines 343, 368, 374, 376, 381, 391, 400, 610). This single `any` is a regression and lets `body?.user?.email` (l.605) silently typecheck against anything.
- **Fix:** `as Record<string, unknown>`. The chained optional-property reads on lines 605–612 will continue to compile because the file already uses `?.` and `??` rather than indexing into typed shapes.

### P1-2: Comment claims "fire-and-forget" but call isn't wrapped in `ctx.waitUntil`
- **Where:** `src/index.ts:654-655`
  ```ts
  // Cache paid status for 5 minutes — fire-and-forget
  env.AILEDGER_CACHE.put(paidCacheKey, 'true', { expirationTtl: 300 });
  ```
- **Impact:** Workers cancel pending I/O when the response is returned. Without `ctx.waitUntil`, the `KV.put` may never complete on cold or fast paths — meaning the next request hits Supabase again, defeating the cache. Compare with `resolveApiKey` (l.550) which gets this right: `ctx.waitUntil(env.AILEDGER_CACHE.put(...))`. Inconsistent with the rest of the file.
- **Fix:** Either thread `ctx` through `checkUsageLimit` and wrap in `ctx.waitUntil`, or — since this is a billing decision — `await` it (the latency hit is one KV write, ~5–10 ms, against a flow that already paid ~150 ms for Supabase).

### P1-3: Verbose logs leak signup PII at `console.log` level
- **Where:** `src/index.ts:594` — `console.log('Signup hook payload:', bodyText);`
- **Where:** `src/index.ts:603` — `console.log('Signup hook parsed body:', JSON.stringify(body));`
- **Where:** `src/index.ts:628` — logs `magicLink` (a Supabase verify URL with `token_hash`) at `console.log`
- **Impact:** For an audit-grade product, dumping full Supabase auth-hook payloads (which contain emails, user metadata, and one-time verify tokens) at info level is a recipe for sensitive data ending up in Cloudflare's tail/log retention. The token in `magicLink` is single-use but its presence in worker logs is surprising. Style-guide question: "Is the code self-documenting where possible?" — these logs read like leftover debugging.
- **Fix:** Drop the payload dumps, or downgrade to `console.debug` and elide `bodyText`/`magicLink`. At minimum, log fields explicitly: `console.log('signup-hook', { actionType, hasToken: !!tokenHash })`.

### P1-4: Magic numbers duplicated across the file with no named constants
- `src/index.ts:366` — `300` (Stripe webhook freshness window, 5 min)
- `src/index.ts:550` — `300` (KV cache TTL for `resolveApiKey`)
- `src/index.ts:655` — `300` (KV cache TTL for paid-customer flag)
- `src/index.ts:683` — `10_000` (free-tier monthly inference cap; comment at l.99 says "10k/month")
- **Impact:** The two `300`s mean different things; one is a security window, one is a cache TTL — having them share a literal makes it easy to "tune" the cache and accidentally widen the replay window. The `10_000` is referenced in a user-visible error message at l.103 (`Monthly inference limit reached.`) without keeping the number in sync.
- **Fix:** Hoist to module-scope:
  ```ts
  const STRIPE_WEBHOOK_MAX_AGE_SEC = 300;
  const KEY_CACHE_TTL_SEC = 300;
  const PAID_CACHE_TTL_SEC = 300;
  const FREE_TIER_MONTHLY_LIMIT = 10_000;
  ```

### P1-5: Three near-identical "drip emails removed 2026-04-30" tombstones
- `src/index.ts:34-36` (in `scheduled` handler)
- `src/index.ts:625-627` (in `handleSignupHook`)
- `src/index.ts:686-689` (free-floating, between `checkUsageLimit` and `logInference`)
- **Impact:** That information is in the commit history (`5651420 rip Resend and Brevo from email stack`). Comments duplicating commit messages rot — when the Gmail re-introduction lands, all three sites need editing. CLAUDE.md guidance: "Don't reference the current task, fix, or callers — those belong in the PR description and rot as the codebase evolves."
- **Fix:** Keep at most one short note in `scheduled` ("// no scheduled work currently") and let `git blame` tell the story. Delete the free-floating l.686–689 block — there is no reader who lands at line 686 and benefits from reading about a removed function that doesn't appear in the file.

### P1-6: Inconsistent property access style on event payloads
- **Where:** `src/index.ts:374-407` (`processStripeEvent`) — uses bracket-string access throughout: `event['type']`, `data['customer']`, `metadata?.['supabase_user_id']`.
- **Where:** `src/index.ts:605-612` (`handleSignupHook`) — same payload shape, but uses dot notation: `body?.user?.email`, `meta?.full_name`.
- **Impact:** Both work; the bracket form is required only when the key is dynamic or has special chars. Mixing them in one file makes the code feel auto-translated. Bracket form is also noisier on the eye when keys are constants.
- **Fix:** Standardize on dot notation in `processStripeEvent`. With `Record<string, unknown>` typing, `event.type as string` reads identically to `event['type'] as string`.

## Minor Issues

### P2-1: Banner-comment width is inconsistent
- `src/index.ts:81, 172, 320, 442, 467` — banner ends at column ~84 (`─` count = 68–76)
- `src/index.ts:99` — shorter banner: `// ─── Usage limit check (free tier: 10k/month) ───────────────────────`
- **Fix:** If keeping the banners, pad to a consistent column (the file's prettier `printWidth` is 140 — banners hover near 80, suggesting an older convention). Trivial.

### P2-2: `verifyStandardWebhook` + `verifyStripeSignature` — paired functions, divergent names
- `src/index.ts:339` — `verifyStripeSignature`
- `src/index.ts:568` — `verifyStandardWebhook` (Supabase signup hook, "Standard Webhooks" spec)
- **Impact:** Reader has to look at the body to know which provider's flavor each handles. Naming asymmetric.
- **Fix:** Rename to `verifySupabaseHookSignature` (matches caller domain) or keep name and add a one-line JSDoc pointing to https://www.standardwebhooks.com.

### P2-3: Most internal helpers have no JSDoc
- `isJsonContentType`, `sha256jcs` (lines 467–520) have excellent block comments explaining the JCS contract.
- `resolveApiKey`, `checkUsageLimit`, `processStripeEvent`, `upsertSubscription`, `handleSignupHook`, `verifyStandardWebhook`, `handleCreateCheckoutSession`, `handleBillingPortal`, `handleStripeWebhook`, `verifyStripeSignature`, `logInference`, `filterHeaders`, `sha256hex` — none.
- **Impact:** Several have non-obvious contracts (e.g., `checkUsageLimit` returns `true` when over limit and "fails open" returning `false` on Supabase error — l.679). A two-line JSDoc on each public-ish helper would make the file self-documenting per the assignment's third question.

### P2-4: `checkUsageLimit` boolean-direction is hard to read at the call site
- **Where:** `src/index.ts:100-101`
  ```ts
  const limitHit = await checkUsageLimit(env, customerId);
  if (limitHit) { ... 429 ... }
  ```
- The function name is a question; the call site renames it to a statement. Renaming `checkUsageLimit` → `isOverFreeTierLimit` would let the call site read `if (await isOverFreeTierLimit(env, customerId))` and remove the `limitHit` rebind.

### P2-5: `match[1]`, `match[2]` — un-destructured regex groups
- **Where:** `src/index.ts:75, 108`
- **Fix:** `const [, providerSlug, rawPath] = match;` reads better and names the groups. Trivial.

### P2-6: `actionType ?? 'signup'` magic string default
- **Where:** `src/index.ts:617`
- The literal `'signup'` is a Supabase email-action enum value. Without a comment or named constant, a reader who isn't versed in Supabase has to guess. A `// default to signup-flow OTP if action_type missing` would suffice.

### P2-7: `console.log('Signup hook payload:', bodyText);` — first-statement-before-auth log
- **Where:** `src/index.ts:594`
- Beyond P1-3 (PII), this also logs unauthenticated bodies — anyone who can reach the endpoint generates log lines. Style-guide angle: "Is the comment quality (missing, outdated, or obvious)?" applies to log messages too — this one is debug-grade in an otherwise audit-grade file.

### P2-8: Hard-coded Stripe `price_*` IDs in source
- **Where:** `src/index.ts:175-178`
- Not a security issue (price IDs are public), but they're production-shape IDs in a checked-in file with no env override. If staging ever needs different prices, this becomes a code change. Style-only flag — convention in the rest of the file is to read from `env`.

## Observations

- **Single-file size.** 778 lines mixing `scheduled`, `fetch`, Stripe checkout, billing portal, Stripe webhook + signature verify, Supabase signup hook + Standard Webhooks verify, KV-cached API key resolution, free-tier metering, JCS content hashing, and async inference logging. The author already inserted six banner comments to delineate sections — a tell that the file wants to be split. Suggested split (no functional change):
  - `src/index.ts` — router only
  - `src/auth.ts` — `resolveApiKey`, `filterHeaders`, `verifyStandardWebhook`
  - `src/billing.ts` — `handleCreateCheckoutSession`, `handleBillingPortal`, `handleStripeWebhook`, `verifyStripeSignature`, `processStripeEvent`, `upsertSubscription`, `PRICE_IDS`
  - `src/usage.ts` — `checkUsageLimit`
  - `src/hash.ts` — `sha256hex`, `sha256jcs`, `isJsonContentType` (already exported — only file with public API)
  - `src/inference.ts` — `logInference`
  - `src/signup.ts` — `handleSignupHook`
  Per CLAUDE.md ("Don't add features, refactor, or introduce abstractions beyond what the task requires"), this is a **non-blocking observation**, not a fix request — but a follow-up bead is worth filing.

- **Test surface.** Only `isJsonContentType` and `sha256jcs` are exported. The Stripe handlers, signup hook, Standard Webhooks verifier, KV cache flows, and free-tier metering can't be unit-tested in isolation today — only end-to-end via `SELF.fetch`. Splitting per the bullet above unlocks targeted unit tests; until then, integration-only coverage is the constraint.

- **`env.AILEDGER_CACHE` typing.** `Env.AILEDGER_CACHE: KVNamespace` — KV typings give `get(key, 'json')` a return of `unknown`; the file casts via `as { customerId: string; systemId: string | null } | null` (l.528). Consider a tiny helper `getCached<T>(kv, key): Promise<T | null>` to localize the cast — minor, but it'd remove the inline `as` from the auth hot path.

- **Section banners use `─` (U+2500) box-drawing.** Renders fine in ASCII-aware terminals/editors but can look mis-aligned in some review tools. Cosmetic.

- **No regressions vs. neighboring code.** Style is largely consistent with the rest of the proxy package (single file). The `landing/`, `dashboard/`, `cli/` packages weren't in scope for this review.
