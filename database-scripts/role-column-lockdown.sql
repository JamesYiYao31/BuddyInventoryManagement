-- role-column-lockdown: Phase 1b (A) — close self-escalation hole.
-- Run in Supabase SQL editor BEFORE deploying app code that drops role
-- from registration profiles.update calls (same release). Without the
-- matching client change, registration would fail on column-denied.
--
-- WHY table revoke + column re-grant (not REVOKE UPDATE (role)):
-- Supabase grants table-level UPDATE to authenticated, which implicitly
-- covers EVERY column including role. A column-level REVOKE UPDATE (role)
-- is a no-op against that table grant — production verified. To make role
-- client-immutable you must revoke the table UPDATE grant, then re-grant
-- UPDATE only on columns clients legitimately write (full_name, lab_id,
-- org_id — registration + Profile Settings). role, is_active, and the
-- deactivation columns are deliberately NOT re-granted.
--
-- The handle_new_user trigger (SECURITY DEFINER) still sets role at
-- signup; the set_user_role RPC (service_role) handles admin changes.
-- This is privilege-level enforcement — no policy expression to
-- misconfigure.

-- 1. Wall off client role writes (and all other unlisted columns)
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (full_name, lab_id, org_id) ON public.profiles TO authenticated;

-- 2. Verification block (commented out — run AFTER section 1)
--
-- 2a. Column-privilege check:
-- SELECT grantee, column_name, privilege_type
-- FROM information_schema.column_privileges
-- WHERE table_schema = 'public'
--   AND table_name = 'profiles'
--   AND privilege_type = 'UPDATE'
--   AND grantee IN ('authenticated', 'anon')
-- ORDER BY grantee, column_name;
-- Expect: authenticated has UPDATE on full_name, lab_id, org_id only;
--         NO row for role (or is_active / deactivated_at / deactivated_by);
--         anon absent entirely.
--
-- 2b. Behavioral (after deploy): re-run the technician self-escalation
-- REST attempt that previously returned 200 — expect it now FAILS
-- (403 / column-denied / permission error).
