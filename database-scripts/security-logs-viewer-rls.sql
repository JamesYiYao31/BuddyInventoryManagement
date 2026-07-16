-- security-logs-viewer-rls: fix org_admin SELECT gap on security_logs.
-- Run in Supabase SQL editor after review. Do NOT run the verification
-- block in the same paste — execute section 1 first, then verify.
--
-- Intent (permissive SELECT policy only; restrictive
-- security_logs_require_active_user is UNTOUCHED and still ANDs):
--   super_admin — ALL rows, including lab_id IS NULL
--   manager     — own lab only (lab_id = get_my_lab_id())
--   org_admin   — rows for labs in their org
--                 (lab_id IN labs WHERE org_id = get_my_org_id());
--                 NOT null-lab rows — those stay super_admin-only
--   technician  — no SELECT policy branch → no access
--
-- Why: the prior shared branch treated org_admin like manager
-- (lab_id = get_my_lab_id()). Org_admin JWT lab_id is NULL, so
-- NULL = NULL never matches → org_admin read nothing. Split the
-- branches: manager unchanged; org_admin uses org-scoped labs.
-- Null-lab rows remain super_admin-only (existing rule preserved).

-- 1. Drop + recreate security_logs_select_scoped
drop policy if exists "security_logs_select_scoped"
  on public.security_logs;

create policy "security_logs_select_scoped"
  on public.security_logs
  for select
  to authenticated
  using (
    (auth.jwt() ->> 'user_role' = 'super_admin')
    or (
      auth.jwt() ->> 'user_role' = 'manager'
      and lab_id = get_my_lab_id()
    )
    or (
      auth.jwt() ->> 'user_role' = 'org_admin'
      and lab_id in (
        select id from public.labs where org_id = get_my_org_id()
      )
    )
  );

-- 2. Verification block (commented out — run AFTER section 1)
--
-- 2a. Policy definition check — confirm all three role branches:
-- SELECT pg_get_expr(polqual, polrelid)
-- FROM pg_policy
-- WHERE polname = 'security_logs_select_scoped';
-- Expect: super_admin OR (manager AND lab_id = get_my_lab_id())
--         OR (org_admin AND lab_id IN (SELECT id FROM labs WHERE …)).
--
-- 2b. Data-shape baseline (run as postgres / SQL editor — bypasses RLS,
--     sees all rows). Records what "correct" looks like for later
--     browser checks: null_lab count = super_admin-only rows;
--     distinct_labs = how many labs appear in the trail.
-- SELECT
--   count(*) AS total,
--   count(*) FILTER (WHERE lab_id IS NULL) AS null_lab,
--   count(DISTINCT lab_id) AS distinct_labs
-- FROM public.security_logs;
--
-- 2c. Per-role row-count expectations (reason about during the UI-phase
--     live browser test — the SQL editor cannot assume a JWT role):
--
--   Role            | Viewer must show
--   ----------------|--------------------------------------------------
--   Oakwood MANAGER | ONLY Oakwood lab_id rows; ZERO null-lab rows
--   ORG_ADMIN       | Only their org's labs; ZERO null-lab rows.
--                     NOTE: no org_admin in production today (orgs empty
--                     post July 10 wipe). Defer live org_admin proof
--                     until an org tenant exists.
--   SUPER_ADMIN     | ALL rows, INCLUDING null-lab
--   TECHNICIAN      | Viewer not reachable at all (no tab / no route)
--
-- 2d. Cross-tenant safety — manager browser count must EQUAL the
--     editor baseline for Oakwood. If the manager sees MORE, the
--     org_admin branch is leaking; if FEWER, scoping is over-tight.
--
-- Resolve Oakwood's id first (name lookup — do not hard-code):
-- SELECT id, name FROM public.labs WHERE name ILIKE '%oakwood%';
--
-- Then baseline (paste the UUID from the previous query):
-- SELECT count(*) FROM public.security_logs
-- WHERE lab_id = '<oakwood-lab-uuid>';
