# Commit Discipline Review

## Summary

Reviewed the full commit history touching `proxy/src/index.ts` (5 commits, ebca0da → 5651420). Overall discipline is **good-to-very-good**: commits are atomic, messages explain the *why* (often citing standards, bugs, or directives), and PR-merged commits include bead + PR refs. The main weaknesses are (1) inconsistent prefix conventions across commits, (2) one severely mislabeled initial-import commit, and (3) two direct-to-main mayor commits without bead/PR linkage. The history is bisectable and a reviewer can follow the progression without difficulty.

## Critical Issues
(P0 — Must fix before merge)

None. No commits in scope are outright broken (no "WIP", "asdf", "stuff", etc.) and all touch a coherent unit of work.

## Major Issues
(P1 — Should fix before merge)

- **ebca0da "ci: add claude-code @claude action"** — message scope is grossly misleading. The commit adds the **entire repo** (`.github/workflows/claude.yml` plus `dashboard/`, `proxy/`, `LICENSE`, `README.md`, lockfiles, assets — ~30+ files including the 923-line initial `proxy/src/index.ts`) but the title only mentions the CI workflow. A reviewer or bisecting engineer scanning `git log --oneline` would never guess this commit introduced the proxy. **Suggested fix:** rename initial-import commits to `chore: initial repo import` (or split: one commit for repo skeleton, one for the CI action). Going forward, never bury an initial import under a narrow type prefix.

## Minor Issues
(P2 — Nice to fix)

- **Inconsistent prefix conventions.** Three styles coexist on the same file's history:
  - Conventional Commits: `feat:` (e5c69df), `ci:` (ebca0da)
  - Scope prefix: `proxy: …` (1a16f09, 75b666b)
  - No prefix: `rip Resend and Brevo from email stack — Google-only directive 2026-04-30` (5651420)

  Pick one and document it in `CONTRIBUTING.md` / `AGENTS.md`. Recommend conventional-commits with optional scope (`refactor(proxy): rip Resend and Brevo …`) since it is already partially adopted and machine-parseable for changelogs.

- **5651420 "rip Resend and Brevo from email stack — Google-only directive 2026-04-30"** — message is descriptive about the what/why but:
  - Date is **embedded in the subject line** (`2026-04-30`), which is redundant with the commit date and clutters `git log --oneline`.
  - No type prefix; this is a 254-line deletion that is functionally a `refactor:` or `chore(email):`.
  - No bead ID or PR ref despite being mayor work. If "Google-only directive" came from a tracked decision, link it (`(ai-xxx)` or DECISION doc).

- **75b666b "proxy: fix drip-email double-fire bug (3am daily emails)"** — clear and well-scoped, but missing bead/PR linkage. For bug fixes that ship straight to main, a bead reference makes incident archaeology much easier ("which commit fixed the 3am pages last April?"). Consider `fix(proxy): drip-email double-fire (ai-xxx)`.

## Observations
(Non-blocking notes and suggestions)

- **Atomicity is strong** for the four post-import commits. Each touches one concern (JCS canonicalization, drip fix, hash chain, Resend/Brevo removal) and the diff stats reflect that focus (one-file-deep churn in three of four cases).
- **Bisectability** is good: deletions are isolated from feature work, the JCS adoption is its own commit, and the hash-chain feature is its own commit. `git bisect` against any audit/email-related regression would converge cleanly.
- **WHY-content is above-average.** Three of five commits cite an external trigger or standard (RFC 8785, "Google-only directive", "3am daily emails", "tamper-evident"). This is rarer than it should be — keep doing it.
- **PR-merged commits (1a16f09, e5c69df) carry bead + PR refs in the subject** (`(ai-jae) (#19)`, `(ai-2cg) (#15)`). This is the gold standard the direct-to-main commits (5651420, 75b666b) should match.
- **Co-author trailers** are consistently used in ebca0da and likely others — good practice, no action needed.
- **No giant "WIP" / "fix" / "stuff" commits** in the file's history. No squash-of-shame in scope.
- **No mixed feature+refactor+bugfix commits** in scope.

### Recommendation

Adopt and enforce a one-line commit-message convention in `CONTRIBUTING.md`:

```
<type>(<scope>): <subject> (<bead-id>) [(<PR#>)]
```

Where `<type>` ∈ {feat, fix, refactor, chore, docs, test, ci, perf}, `<scope>` is optional (e.g. `proxy`, `dashboard`, `landing`), bead-id is required for any tracked work, PR# is added by the merge tooling. This codifies what 1a16f09 and e5c69df already do and would have caught the ebca0da mislabel and the missing bead refs on 5651420 / 75b666b.
