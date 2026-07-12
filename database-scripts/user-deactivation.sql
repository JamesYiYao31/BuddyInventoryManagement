-- user-deactivation: Phase A schema only — profiles deactivation columns,
-- state CHECKs, user_is_active() helper, security_logs event pairs.
-- Run in Supabase SQL editor after review. Do NOT run the verification
-- block (section 6) in the same paste — execute 1–5 first, then 6a–6f
-- line by line.
--
-- No app/API code in this file. Phase B wires gates + UI.

-- 1. Columns on profiles
-- NOT NULL DEFAULT on Postgres 11+ is a metadata-only change — no table
-- rewrite, safe on the live profiles table; all existing rows read as
-- is_active = true immediately.
ALTER TABLE public.profiles
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN deactivated_at timestamptz,
  ADD COLUMN deactivated_by text;

-- 2. State-coherence CHECK
-- Makes half-set states unrepresentable; reactivation must clear both
-- metadata columns.
ALTER TABLE public.profiles ADD CONSTRAINT
  profiles_deactivation_state_chk CHECK (
    (is_active = true  AND deactivated_at IS NULL
                       AND deactivated_by IS NULL)
    OR
    (is_active = false AND deactivated_at IS NOT NULL
                       AND deactivated_by IS NOT NULL)
  );

-- 3. Super_admin immunity CHECK (DB-layer guarantee)
-- super_admin is structurally non-deactivatable. No API path, service-role
-- write, or future bug can flip this row. This is the enforcement; API-layer
-- checks added later are just friendly errors.
ALTER TABLE public.profiles ADD CONSTRAINT
  profiles_super_admin_always_active_chk CHECK (
    NOT (role = 'super_admin' AND is_active = false)
  );

-- 4. Live-check helper for RLS (used in Phase B, inert until then)
-- SECURITY DEFINER so Phase B restrictive policies can call it regardless
-- of profiles RLS; STABLE so Postgres evaluates it once per statement
-- (initplan) when wrapped as (SELECT public.user_is_active()) — not per row.
-- Fail-closed: no row / null uid → false. Empty search_path with fully
-- qualified references, per SECURITY DEFINER hygiene.
CREATE OR REPLACE FUNCTION public.user_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT is_active FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.user_is_active() FROM public;
GRANT EXECUTE ON FUNCTION public.user_is_active() TO authenticated;

-- 5. Extend BOTH security_logs constraints (two-layer structure preserved)
-- Full new event_type allowlist:
--   'login', 'logout', 'recovery_codes_generated', 'recovery_code_redeemed',
--   'user_deactivated', 'user_reactivated'
-- Full new (event_type, outcome) pair set:
--   (login, success)
--   (login, failure)                    -- reserved
--   (logout, success)
--   (recovery_codes_generated, success)
--   (recovery_code_redeemed, success)
--   (recovery_code_redeemed, failure)
--   (user_deactivated, success)
--   (user_reactivated, success)
-- Deactivate/reactivate events are written only after the action succeeds
-- (audit-after-action rule); guard-blocked attempts are not logged in MVP —
-- consistent with the documented failed-login exclusion. No failure pairs
-- reserved for these events.

-- 5a. Run first, confirm name of the auto-generated event_type CHECK:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.security_logs'::regclass
--   AND contype = 'c';
-- Then substitute the real event_type check name below if it differs from
-- security_logs_event_type_check (Postgres auto-name for an unnamed inline
-- CHECK on column event_type — do NOT guess without the lookup).

ALTER TABLE public.security_logs
  DROP CONSTRAINT security_logs_event_type_check;

ALTER TABLE public.security_logs
  ADD CONSTRAINT security_logs_event_type_check CHECK (
    event_type in (
      'login',
      'logout',
      'recovery_codes_generated',
      'recovery_code_redeemed',
      'user_deactivated',
      'user_reactivated'
    )
  );

-- 5b. Named pairing constraint — preserve existing branches EXACTLY;
-- add user_deactivated / user_reactivated to the success-only branch.
ALTER TABLE public.security_logs
  DROP CONSTRAINT security_logs_event_outcome_valid;

ALTER TABLE public.security_logs
  ADD CONSTRAINT security_logs_event_outcome_valid CHECK (
    (event_type = 'recovery_code_redeemed')                          -- success or failure
    or (event_type = 'login')                                        -- success now; failure reserved
    or (event_type in ('logout', 'recovery_codes_generated',
                       'user_deactivated', 'user_reactivated')
        and outcome = 'success')                                     -- these cannot fail
  );

-- 6. Verification block (commented out — run line by line AFTER 1–5)
--
-- 6a. Column check:
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'profiles'
-- ORDER BY ordinal_position;
--
-- 6b. Backfill check (expect equal counts — all rows is_active = true):
-- SELECT count(*) FILTER (WHERE is_active), count(*)
-- FROM public.profiles;
--
-- 6c. Constraint definitions on profiles:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.profiles'::regclass
--   AND conname LIKE 'profiles_%chk';
--
-- 6d. Super_admin immunity behavioral test — rollback-transaction DO block
-- (verdict embedded in the terminating exception message; Supabase SQL
-- editor suppresses RAISE NOTICE). Attempt UPDATE of James's row to
-- is_active = false inside a transaction; expect check_violation; roll
-- back; report PASS/FAIL via exception text. Zero persistent changes.
-- Substitute the real super_admin id if needed:
-- DO $$
-- DECLARE
--   target_id uuid;
-- BEGIN
--   SELECT id INTO target_id
--   FROM public.profiles
--   WHERE role = 'super_admin'
--   LIMIT 1;
--
--   IF target_id IS NULL THEN
--     RAISE EXCEPTION 'FAIL: no super_admin profile found';
--   END IF;
--
--   BEGIN
--     UPDATE public.profiles
--     SET is_active = false,
--         deactivated_at = now(),
--         deactivated_by = 'immunity-test'
--     WHERE id = target_id;
--
--     -- If we reach here, the CHECK did not fire — fail loudly, then undo.
--     RAISE EXCEPTION 'FAIL: super_admin immunity CHECK did not block deactivation';
--   EXCEPTION
--     WHEN check_violation THEN
--       RAISE EXCEPTION 'PASS: super_admin immunity CHECK blocked deactivation (check_violation)';
--   END;
-- END;
-- $$;
--
-- 6e. security_logs constraints — BOTH must be present; new event types in both:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.security_logs'::regclass
--   AND contype = 'c';
-- Confirm security_logs_event_type_check lists user_deactivated +
-- user_reactivated, and security_logs_event_outcome_valid includes them in
-- the success-only branch; all prior pairs/branches intact.
--
-- 6f. Function sanity:
-- SELECT provolatile, prosecdef, proconfig
-- FROM pg_proc
-- WHERE proname = 'user_is_active';
-- Expect: provolatile = 's' (stable), prosecdef = true (security definer),
-- proconfig includes search_path=''.
-- NOTE: calling SELECT public.user_is_active() from the SQL editor returns
-- FALSE — the editor session has no auth.uid(). That is correct fail-closed
-- behavior, not a bug. Real true/false behavior is verified in Phase B's
-- browser test.
