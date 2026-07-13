-- user-deactivation-rls: Phase B — RESTRICTIVE RLS so a deactivated user's
-- data access dies instantly, even mid-session on a valid JWT.
-- Run in Supabase SQL editor after Phase A (profiles.is_active +
-- public.user_is_active()). Do NOT run the verification block (section 2)
-- in the same paste — execute section 1 first, then 2a–2c as instructed.
--
-- Design notes:
-- (a) RESTRICTIVE policies AND with existing permissive policies — lab
--     scoping and role gates are unchanged; this layer only requires an
--     active profile.
-- (b) TO authenticated leaves anon registration flows, supabase_auth_admin
--     (custom_access_token_hook), and service-role writes untouched.
-- (c) The (SELECT public.user_is_active()) wrapper makes Postgres evaluate
--     the STABLE function once per statement (initplan), not per row —
--     one PK lookup on profiles per query.
-- (d) Deliberate exclusions:
--     - profiles — deactivated users must read their own row for a
--       legible gate message in Phase C
--     - active_sessions — eviction poll semantics unchanged; Phase D
--       deletes the row explicitly
--     - mfa_recovery_codes, mfa_recovery_elevations — auth flows untouched
--
-- No app/API code in this file. Phase C wires login/gate UX.

-- 1. Restrictive policies (13 tables)

CREATE POLICY items_require_active_user
  ON public.items
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

CREATE POLICY inventory_lots_require_active_user
  ON public.inventory_lots
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

CREATE POLICY active_lots_require_active_user
  ON public.active_lots
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

CREATE POLICY coa_records_require_active_user
  ON public.coa_records
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

CREATE POLICY lot_validation_records_require_active_user
  ON public.lot_validation_records
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

CREATE POLICY requests_require_active_user
  ON public.requests
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

CREATE POLICY activity_logs_require_active_user
  ON public.activity_logs
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

CREATE POLICY lab_settings_require_active_user
  ON public.lab_settings
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

CREATE POLICY feedback_require_active_user
  ON public.feedback
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

CREATE POLICY lab_invites_require_active_user
  ON public.lab_invites
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

CREATE POLICY labs_require_active_user
  ON public.labs
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

CREATE POLICY organizations_require_active_user
  ON public.organizations
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

CREATE POLICY security_logs_require_active_user
  ON public.security_logs
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.user_is_active()))
  WITH CHECK ((SELECT public.user_is_active()));

-- 2. Verification block (commented out — run AFTER section 1)
--
-- 2a. Policy count + list (expect exactly 13 rows, cmd = ALL):
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
-- ORDER BY tablename;
--
-- 2b. Definition spot-check on one policy (both expressions must
-- reference user_is_active):
-- SELECT pg_get_expr(polqual, polrelid),
--        pg_get_expr(polwithcheck, polrelid)
-- FROM pg_policy
-- WHERE polname = 'items_require_active_user';
--
-- 2c. BEHAVIORAL TEST — Decision 3 proof (manual; numbered steps):
--
-- 1. Register a fresh throwaway technician via the REAL registration
--    flow using Oakwood's tech_key (this doubles as proof that
--    registration works under the new policies). Note the new user's
--    profiles.id.
--
-- 2. Log in as that technician in a browser; confirm dashboard loads
--    with normal data access. LEAVE THE SESSION OPEN.
--
-- 3. In the SQL editor, flip the flag — ALL THREE columns in one
--    UPDATE or the state-coherence CHECK rejects it:
--    UPDATE public.profiles
--    SET is_active = false,
--        deactivated_at = now(),
--        deactivated_by = 'James Cheong (JC) — Phase B test'
--    WHERE id = '<test-user-uuid>';
--
-- 4. In the STILL-OPEN browser session, click through inventory / lots /
--    activity / requests. Expected: every view goes empty or errors.
--    The silent Array(0) that is usually your RLS bug signature is,
--    this one time, the PASS condition. Login itself still works
--    until Phase C — expected interim state, not a failure.
--
-- 5. Reactivate:
--    UPDATE public.profiles
--    SET is_active = true,
--        deactivated_at = NULL,
--        deactivated_by = NULL
--    WHERE id = '<test-user-uuid>';
--
-- 6. Refresh the browser: data access returns. KEEP this test user —
--    it is the test dummy for Phases C and D.
--
-- 7. Log in as James (super_admin): confirm dashboards fully
--    functional (immunity CHECK guarantees is_active = true, so
--    restrictive policies are transparent for you).
