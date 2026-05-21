# AILedger SEO — Weekend Ship Runbook

Generated 2026-05-20 in worktree `seo-ship-this-weekend` while user is OOO (returns 2026-06-02). All work that could be done autonomously has been done. This runbook covers (a) what changed in code, (b) what still requires a human (account access, DNS, third-party platforms), and (c) the competitor SERP audit + ailedger.com resolution from web research.

---

## A. What shipped in this worktree

Branch: `worktree-seo-ship-this-weekend` (off `origin/main`).

### `landing/index.html`
- **Title** rewritten brand-first per spec: `AILedger — EU AI Act Audit Logging & Compliance Evidence`.
- **Meta description** rewritten — AILedger in first 2 words, declarative, ~190 chars.
- **Organization JSON-LD enriched**:
  - Added `description`, `founder` (Jake Joyner), `parentOrganization` (Joyner Ventures LLC), `foundingDate: "2026"`, `foundingLocation` (Venice, CA, US).
  - `sameAs` expanded to include `https://x.com/ailedger` (verifiable — `@ailedger` already on twitter:site meta) in addition to the existing GitHub link.
  - LinkedIn URL **deliberately omitted** — adding a URL for a page that doesn't yet exist hurts more than it helps. Add to `sameAs` after creating the LinkedIn company page (see §B.4).

### `landing/src/App.tsx`
- Added `/about` to `CANONICAL_PATHS` so the per-route canonical fix applies to it.
- Added `path === '/about'` branch in `App()` returning a new `<About />` component.
- New `About()` component below `Contact()` — Joyner Ventures LLC origin, mission summary, three-layer architecture, EU data residency note, **explicit disambiguation block listing theailedger.com, ailedger.cloud, ailedger.in as not affiliated**, contact line.
- Hero H1 has a `<span className="sr-only">AILedger — </span>` prefix so the brand name is the first thing crawlers and screen readers parse out of the H1. Visual rendering unchanged.

### `landing/src/index.css`
- Added a standard `.sr-only` utility class (position: absolute + 1px clip). Pure accessibility helper — not display:none, so it's not cloaking and Google respects it.

### `landing/public/sitemap.xml`
- Was 3 URLs (`/`, `/llms.txt`, `/llms-full.txt`). Expanded to 10 URLs covering all real routes including the new `/about` and `/charter/v1`, with `lastmod` set to 2026-05-20 to nudge re-crawl.

### Build verified
`npm run build` in the worktree produces `dist/index.html` with the new title and Organization schema. No type errors.

### What didn't change (intentionally)
- **Open Graph + Twitter title/description**: kept the existing copy — they're tuned for social previews and still on-brand. Update if/when the new homepage copy stabilizes.
- **robots.txt**: already complete (search/AI-input/training distinction, sitemap reference). No changes needed.
- **Canonical tags**: per-route canonical override already exists in `App.tsx` (line 32-45). `/about` was added to the map; no other change required.
- **Core Web Vitals**: not measured here — needs PageSpeed Insights run against the deployed site. See §B.7.

---

## B. Human-required actions (when you're back)

These need account access, DNS changes, or third-party platforms you control. Numbered roughly in order of brand-defense leverage.

### B.1 Merge + deploy the worktree branch
```sh
cd /home/jjoyner/workspace/dev/ailedger
git fetch origin
# Worktree is at .claude/worktrees/seo-ship-this-weekend on branch worktree-seo-ship-this-weekend
# Review:
git -C .claude/worktrees/seo-ship-this-weekend diff origin/main -- landing/
# When happy, merge into main and push so Cloudflare Pages deploys:
git checkout main
git pull origin main
git merge --no-ff worktree-seo-ship-this-weekend
git push origin main
```
Cloudflare Pages auto-deploys main. Verify <https://ailedger.dev/about> renders and view-source on `/` shows the new title + the founder/parentOrganization fields in the JSON-LD.

### B.2 Google Search Console
1. Verify ownership of `ailedger.dev` via DNS TXT (Cloudflare DNS panel). Use a domain property, not URL prefix — it covers `dash.`, `proxy.`, etc. subdomains automatically.
2. Submit `https://ailedger.dev/sitemap.xml`.
3. Pull current ranking data for: `ailedger`, `ai ledger`, `ailedger.dev`, `EU AI Act audit logging`, `Article 12 audit trail`, `AI compliance evidence`. Snapshot today's numbers as a 2-week baseline.
4. Under **URL Inspection**, request indexing for `/`, `/about`, `/pricing`, `/docs`, `/guide/annex-iii`. Forces a fast re-crawl that will pick up the new schema.

### B.3 Bing Webmaster Tools
1. Sign in at <https://www.bing.com/webmasters> with the same Google account (Bing accepts Google SSO).
2. Add `ailedger.dev`. Verify via the same DNS TXT (Bing accepts the GSC verification token).
3. Submit the same sitemap URL.

### B.4 LinkedIn
- **Personal profile**: set AILedger as current role with `ailedger.dev` in the "Company website" field of the experience entry, not the bio.
- **Company page**: create one at <https://www.linkedin.com/company/setup/new/>. Name "AILedger", parent organization "Joyner Ventures LLC", website `ailedger.dev`. Once live, add the LinkedIn URL to `sameAs` in the Organization JSON-LD (see §C.1).

### B.5 X / Twitter
The Twitter meta already references `@ailedger`. Confirm that handle exists and is yours. If it doesn't, register it before Google starts citing it; if someone else has it, drop the `twitter:site` meta and the `https://x.com/ailedger` entry from `sameAs` — citing a stranger's handle as your social property is worse than omitting it.

### B.6 Crunchbase
1. Create a Joyner Ventures LLC organization profile and an AILedger product/company under it.
2. Set `ailedger.dev` as the company URL on both.
3. Add to `sameAs` once the Crunchbase URL is live.

### B.7 PageSpeed / Core Web Vitals
Once the new build is deployed, run <https://pagespeed.web.dev/analysis?url=https://ailedger.dev>. Targets per the SEO doc: LCP <2.5s, CLS <0.1, INP <200ms. The current build is a single-bundle Vite SPA — the most likely issue is hero-image LCP. If LCP misses, the cheapest win is preloading the OG/hero image with `<link rel="preload" as="image" ...>` in `index.html`.

### B.8 jakejoyner.com link
There's no `jakejoyner.com` source in this filesystem — assume it's hosted/edited elsewhere. Add a prominent link with anchor text `AILedger` (not "click here", not "my company"), e.g.:
```html
<p>I'm the founder of <a href="https://ailedger.dev">AILedger</a> — EU AI Act audit logging infrastructure.</p>
```

### B.9 GitHub Detection-layer repo README
Memory note: Detection layer is open-source under Apache 2.0. Confirm the public repo (likely under `github.com/jakejjoyner/...` based on the existing JSON-LD `sameAs`) has a README where the first non-title paragraph links to `ailedger.dev` with `AILedger` as anchor text:
```md
Part of [AILedger](https://ailedger.dev) — EU AI Act audit logging infrastructure for high-risk AI systems.
```

### B.10 ailedger.com — decision required
See §D — full resolution of the open question. Short version: someone else owns ailedger.com and it's serving an unconfigured-domain 404. Decision is yours, not urgent for brand defense (since it's not actively ranking against you), but worth a WHOIS to see acquisition cost.

---

## C. Follow-ups after manual steps land

### C.1 Patch Organization `sameAs` once LinkedIn / Crunchbase exist
File: `landing/index.html`, search for `"sameAs": [` inside the Organization block, append:
```json
"https://www.linkedin.com/company/ailedger",
"https://www.crunchbase.com/organization/ailedger"
```

### C.2 Calendar reminder 2026-06-03
Check Search Console rankings for the target queries. The schema + sitemap + disambiguation page should be re-crawled within 1-2 weeks; expect movement on the brand SERP between 2-4 weeks.

### C.3 Phase 2 kickoff (per the SEO doc)
First cornerstone article due 2026-05-31. Pick from the four Day-1-30 candidates in the SEO doc — recommend starting with "EU AI Act Article 12 explained" because it's both the highest-intent commercial query and the easiest piece for you to write authoritatively given the existing CLAUDE.md / Charter material.

---

## D. Competitor SERP audit (from web research, 2026-05-20)

| Domain | What it actually is | Owner | Active? | Threat to "ailedger" SERP | Notes |
|---|---|---|---|---|---|
| **theailedger.com** | AI news and analysis publication (articles, login, subscription model) | AnalyticsWeek LLC (per footer) | **Yes** — May 2026 articles, multiple authors, active CMS | **Real.** Has content depth and indexed history. Will keep beating a brand-new domain on `ai ledger` as a noun until your domain authority catches up. | Different category — they don't sell auditing. Disambiguation page is the right move; no overlap on demand queries. |
| **ailedger.cloud** | "AI Powered Accounting" placeholder | Not identified | **No** — header-only stub, no real content | **Low.** Effectively a parked domain. Will lose to a schema-enriched real site within weeks. | Mention in the disambiguation list (done) and forget about it. |
| **ailedger.in** | "Smart Accounting, Simplified" — accounting/financial services landing page | Not identified | **Barely** — cookie notice, contact section, 2025 copyright, minimal content | **Low.** Different industry (accounting), thin content. | Mention in the disambiguation list (done). |

**Conclusion**: only theailedger.com is a real SERP fight, and it's only a fight on the bare brand noun `ai ledger` — not on any of the commercial demand-capture queries (EU AI Act audit logging, Article 12, compliance evidence). For your brand defense you don't need to outrank theailedger.com immediately — you need Google to recognize that the search query `ailedger` (one word, no space) maps to *your* entity. That's exactly what schema.org Organization + alternateName + sameAs does. Expect this to converge within 4-8 weeks of the deploy.

---

## E. ailedger.com resolution (open question from the SEO doc)

**The SEO doc's premise was wrong**: it said the charter was published at `ailedger.com/charter`. It isn't. Evidence:

1. `landing/public/_redirects` line 8 routes `/charter/v1` to `/charter.html` on **ailedger.dev**. The charter is hosted on .dev, not .com.
2. `curl https://ailedger.com/` returns nginx HTTP 404 with body `Site Not Configured | 404 Not Found` — a hosting-provider boilerplate page that's served when a domain points at a server with no vhost configured.
3. `curl https://ailedger.com/charter` likewise returns 404.
4. HTTPS cert on ailedger.com fails SAN validation (`ERR_TLS_CERT_ALTNAME_INVALID`) — the cert presented isn't for ailedger.com, which is consistent with a parked/unclaimed-server-fallback configuration.

**Implication**: ailedger.com is registered to someone (the domain resolves and nginx answers), but the owner has done nothing with it. Probable scenarios, in order of likelihood:
1. Domain squatter holding for resale.
2. Someone who registered the domain years ago for an unrelated project and abandoned it.
3. Hosting reseller default ("Site Not Configured" pages are common to cPanel / Plesk environments).

**Recommended actions**:
- Run `whois ailedger.com` from a network that allows whois (port 43). The `whois` CLI didn't return on this sandbox.
- If the registrant is a squatter / parking service, get a price quote via the listed broker; usually 4-5 figures for a domain like this. **Not urgent** — they're not actively competing for any of your traffic.
- If you do acquire it, decide canonical: keep `ailedger.dev` (current) and 301-redirect `ailedger.com` → `ailedger.dev` so they consolidate authority instead of splitting it. Do not run them as parallel sites.
- Until acquired, do nothing about it. The disambiguation /about page already names .com? — actually, no, it doesn't, because .com isn't masquerading as you. Don't mention a parked domain in disambiguation; that just gives it free traffic.

---

## F. Quick reference — what's done vs. blocked on you

| Item from "What ships this weekend" | Status |
|---|---|
| Search Console + Bing Webmaster claim + sitemap | Sitemap **shipped** in code; account claim **blocked on you** (§B.2, B.3) |
| Schema.org Organization JSON-LD on homepage | **Shipped** (enriched with founder, parent org, foundingLocation, sameAs) |
| On-page metadata fixes (title, description, H1) | **Shipped** (title, description rewritten; H1 has sr-only brand prefix) |
| /about page with disambiguation | **Shipped** |
| jakejoyner.com → ailedger.dev link | **Blocked on you** — no jakejoyner.com source in this filesystem (§B.8) |
| GitHub org README link | **Blocked on you** — need access to the public Detection repo (§B.9) |
| LinkedIn company page + personal profile | **Blocked on you** (§B.4) |
| Crunchbase profile | **Blocked on you** (§B.6) |
| Competitor SERP audit table | **Done** — see §D |
| Resolve ailedger.com vs ailedger.dev | **Done** — see §E. Charter is on .dev only; .com appears parked. |

End of runbook.
