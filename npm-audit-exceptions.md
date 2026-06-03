# npm audit — Accepted Risks

Last reviewed: June 2, 2026

This document lists known npm audit vulnerabilities that have been
assessed and intentionally not patched, with rationale. All entries
are reviewed monthly.

---

## glob 10.2.0 - 10.4.5 (High) — GHSA-5j98-mcp5-4vw2

**Chain:** glob → @next/eslint-plugin-next → eslint-config-next

**Vulnerability:** Command injection via the glob CLI's `-c/--cmd` flag,
which executes shell commands on matched files.

**Production risk:** None. The glob CLI is never invoked by the Buddy
Inventory Management application at runtime. glob is only present as a
transitive dependency of eslint-config-next, which runs exclusively
during development (`npm run lint`). The vulnerable code path requires
an attacker to control arguments passed to the glob binary, which never
happens in our build or production environment.

**Fix path:** Awaiting stable upgrade of eslint-config-next that does
not introduce breaking lint rule changes. Will revisit on next
Next.js minor release.

---

## postcss <8.5.10 (Moderate) — GHSA-qx2v-qp2m-jg93

**Chain:** postcss → next

**Vulnerability:** XSS via unescaped `</style>` in PostCSS stringify output.

**Production risk:** Very low. The vulnerability requires an attacker
to control CSS content that PostCSS then stringifies. Buddy Inventory
Management does not accept user-submitted CSS at any input. All CSS is
authored in the codebase and processed at build time, not runtime.

**Fix path:** PostCSS is bundled inside Next.js
(node_modules/next/node_modules/postcss). The Next.js team controls
when they update their bundled PostCSS. npm's suggested fix
("downgrade to next@9.3.3") is not viable — it would break the entire
application. Awaiting Next.js patch release.

---

## qs <6.x via googleapis (Medium) — CWE-476

**Chain:** qs → googleapis (transitive)

**Vulnerability:** NULL Pointer Dereference in `qs@6.15.1` (CVSS 6.9).

**Production risk:** Low. qs is a query-string parser used by googleapis
SDK internally for Google Sheets feedback logging. The vulnerable code
path requires specially crafted input to trigger the null deref, causing
a process-level crash rather than data exfiltration. Our use of
googleapis is constrained to a single server-side endpoint
(`/api/feedback-notify`) that sends well-formed structured data — we
never pass user-controlled query strings to the SDK.

**Fix path:** No supported fix from upstream as of triage. Awaiting
googleapis to bump its qs dependency. Snyk flagged "no supported fix
available."

---

## ws <8.x via supabase-js (Medium) — CWE-908

**Chain:** ws → @supabase/supabase-js (transitive)

**Vulnerability:** Use of Uninitialized Resource in `ws@8.20.0` (CVSS 6.9).

**Production risk:** Low. ws is the WebSocket library Supabase uses for
its realtime subscriptions. Buddy Inventory Management does NOT use
Supabase realtime channels — all our data fetching goes through the
standard REST API (PostgREST). The vulnerable code path is in WebSocket
upgrade handling, which our code never invokes.

**Fix path:** No supported fix from upstream as of triage. Awaiting
supabase-js to bump its ws dependency. Snyk flagged "no supported fix
available."

---

## uuid via resend (Medium) — CWE-1285 — RESOLVED

**Chain:** uuid → resend

**Status:** Patched by upgrading resend from 6.12.2 to 6.12.3.

**Date resolved:** June 2, 2026

---

## Review process

- Reviewed monthly during compliance check
- Reviewed immediately if Dependabot opens a PR with a working fix
- Reviewed immediately if any listed vulnerability is escalated to
  Critical severity
- Reviewed if a vulnerability becomes exploitable in our specific usage
  pattern (e.g., we start accepting user CSS input)
