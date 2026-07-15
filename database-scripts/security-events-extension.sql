-- security-events-extension: extend security_logs event/outcome constraints
-- for MFA enrollment + role-change audit events.
-- Run in Supabase SQL editor after review. Do NOT run the verification
-- block in the same paste — execute 1 first, then the verify query.
--
-- Adds:
--   mfa_factor_enrolled  (written by POST /api/mfa/enroll-complete)
--   mfa_factor_replaced  (written by POST /api/mfa/enroll-complete)
--   role_changed         (RESERVED — writes ship in Phase 1b)
--
-- Constraint allowing an event nothing writes yet is harmless
-- (same precedent as login/failure reserved in the pairing constraint).
-- Preserves every existing event_type and (event_type, outcome) branch
-- exactly — same drop/recreate discipline as user-deactivation.sql §5.

-- 1a. event_type allowlist — add three new types; keep all prior.
-- Confirm constraint name first if needed:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.security_logs'::regclass
--   AND contype = 'c';

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
      'user_reactivated',
      'mfa_factor_enrolled',
      'mfa_factor_replaced',
      'role_changed'
    )
  );

-- 1b. Named pairing constraint — preserve existing branches EXACTLY;
-- add the three new types to the success-only branch.
ALTER TABLE public.security_logs
  DROP CONSTRAINT security_logs_event_outcome_valid;

ALTER TABLE public.security_logs
  ADD CONSTRAINT security_logs_event_outcome_valid CHECK (
    (event_type = 'recovery_code_redeemed')                          -- success or failure
    or (event_type = 'login')                                        -- success now; failure reserved
    or (event_type in ('logout', 'recovery_codes_generated',
                       'user_deactivated', 'user_reactivated',
                       'mfa_factor_enrolled', 'mfa_factor_replaced',
                       'role_changed')
        and outcome = 'success')                                     -- these cannot fail
  );

-- 2. Verification block (commented out — run AFTER section 1)
-- Expect all three booleans TRUE on BOTH constraint rows.
--
-- SELECT
--   conname,
--   pg_get_constraintdef(oid) LIKE '%mfa_factor_enrolled%' AS has_mfa_factor_enrolled,
--   pg_get_constraintdef(oid) LIKE '%mfa_factor_replaced%' AS has_mfa_factor_replaced,
--   pg_get_constraintdef(oid) LIKE '%role_changed%' AS has_role_changed
-- FROM pg_constraint
-- WHERE conrelid = 'public.security_logs'::regclass
--   AND contype = 'c'
--   AND conname IN (
--     'security_logs_event_type_check',
--     'security_logs_event_outcome_valid'
--   );
