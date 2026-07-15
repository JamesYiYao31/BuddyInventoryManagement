-- role-column-lockdown: Phase 1b (A) — close self-escalation hole.
-- Run in Supabase SQL editor AFTER deploying app code that drops role
-- from registration profiles.update calls (same release). Without the
-- matching client change, registration would fail on column-denied.
--
-- authenticated can still UPDATE other columns (full_name, lab_id,
-- org_id) per existing RLS; ONLY the role column is walled off.
-- The handle_new_user trigger (SECURITY DEFINER) still sets role at
-- signup; the set_user_role RPC (service_role) handles admin changes.
-- This is privilege-level enforcement — no policy expression to
-- misconfigure.

-- 1. Revoke role-column write from client roles
REVOKE UPDATE (role) ON public.profiles FROM authenticated, anon;

-- 2. Verification block (commented out — run AFTER section 1)
--
-- 2a. Column-privilege check:
-- SELECT grantee, privilege_type
-- FROM information_schema.column_privileges
-- WHERE table_schema = 'public'
--   AND table_name = 'profiles'
--   AND column_name = 'role';
-- Expect: authenticated/anon absent for UPDATE; service_role and
-- table owner retain it.
--
-- 2b. Behavioral (after deploy): re-run the technician self-escalation
-- REST attempt that previously returned 200 — expect it now FAILS
-- (403 / column-denied / permission error).
