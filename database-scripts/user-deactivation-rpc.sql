-- user-deactivation-rpc: Phase D — set_user_active_status RPC (service_role only).
-- Run in Supabase SQL editor AFTER deploying app/api/users/set-active.
-- Do NOT run the verification block (section 3) in the same paste —
-- execute sections 1–2 first, then 3a–3c as instructed.
--
-- Prerequisites: Phase A (is_active columns + CHECKs) and Phase B
-- (restrictive RLS). Phase C gates already deny deactivated logins.
-- No UI in this file — Phase E wires the members UI.

-- 1. Function
CREATE OR REPLACE FUNCTION public.set_user_active_status(
  p_actor_id uuid,
  p_target_id uuid,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_role text;
  actor_lab_id uuid;
  actor_org_id uuid;
  actor_is_active boolean;
  actor_full_name text;
  target_role text;
  target_lab_id uuid;
  target_org_id uuid;
  target_is_active boolean;
  target_full_name text;
  peer_count integer;
  allowed boolean := false;
BEGIN
  -- 1. Load actor
  SELECT role, lab_id, org_id, is_active, full_name
  INTO actor_role, actor_lab_id, actor_org_id, actor_is_active, actor_full_name
  FROM public.profiles
  WHERE id = p_actor_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'actor_not_found');
  END IF;

  -- 2. Actor must be active
  IF actor_is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'actor_inactive');
  END IF;

  -- 3. Actor role must be privileged
  IF actor_role NOT IN ('manager', 'org_admin', 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  -- 4. Load target FOR UPDATE (serializes concurrent mutations on this row)
  SELECT role, lab_id, org_id, is_active, full_name
  INTO target_role, target_lab_id, target_org_id, target_is_active, target_full_name
  FROM public.profiles
  WHERE id = p_target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'target_not_found');
  END IF;

  -- 5. Super_admin is structurally non-deactivatable (Phase A CHECK is hard backstop)
  IF target_role = 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'super_admin_target');
  END IF;

  -- 6. No-op / already in requested state
  IF target_is_active IS NOT DISTINCT FROM p_active THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_in_state');
  END IF;

  -- 7. Hierarchy
  -- Technicians who join via tech_key never get profiles.org_id set (registration
  -- only writes role/lab_id/full_name). Org membership for them is only via
  -- labs.org_id — so org_admin checks BOTH target.org_id and the lab join.
  IF actor_role = 'super_admin' THEN
    allowed := true;
  ELSIF actor_role = 'org_admin' THEN
    IF actor_org_id IS NOT NULL AND (
      target_org_id = actor_org_id
      OR EXISTS (
        SELECT 1
        FROM public.labs
        WHERE id = target_lab_id
          AND org_id = actor_org_id
      )
    ) THEN
      allowed := true;
    END IF;
  ELSIF actor_role = 'manager' THEN
    IF actor_lab_id IS NOT NULL
       AND target_lab_id = actor_lab_id
       AND target_role IN ('technician', 'manager') THEN
      allowed := true;
    END IF;
  END IF;

  IF NOT allowed THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  -- 8. Last-admin guard — ONLY when deactivating a manager/org_admin,
  --    and only when the actor is NOT super_admin (offboarding override).
  -- FOR UPDATE makes the count race-proof (concurrent mutual deactivations
  -- serialize; the second transaction re-reads after the first commits and
  -- gets a correct 'last_admin'). A deadlock between simultaneous mutual
  -- deactivations is possible, auto-detected by Postgres, and resolves to a
  -- correct end state; the killed request simply retries.
  IF p_active = false
     AND target_role IN ('manager', 'org_admin')
     AND actor_role <> 'super_admin' THEN
    IF target_role = 'manager' THEN
      SELECT count(*)::integer INTO peer_count
      FROM (
        SELECT id
        FROM public.profiles
        WHERE lab_id = target_lab_id
          AND role = 'manager'
          AND is_active = true
          AND id <> p_target_id
        ORDER BY id
        FOR UPDATE
      ) peers;
    ELSE
      -- org_admin target
      SELECT count(*)::integer INTO peer_count
      FROM (
        SELECT id
        FROM public.profiles
        WHERE org_id = target_org_id
          AND role = 'org_admin'
          AND is_active = true
          AND id <> p_target_id
        ORDER BY id
        FOR UPDATE
      ) peers;
    END IF;

    IF peer_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'last_admin');
    END IF;
  END IF;

  -- 9. Apply state change (satisfies profiles_deactivation_state_chk)
  UPDATE public.profiles
  SET
    is_active = p_active,
    deactivated_at = CASE WHEN p_active THEN NULL ELSE now() END,
    deactivated_by = CASE
      WHEN p_active THEN NULL
      ELSE coalesce(actor_full_name, 'Unknown user ' || p_actor_id::text)
    END
  WHERE id = p_target_id;

  -- 10. Kill active session(s) atomically with the flag flip
  IF p_active = false THEN
    DELETE FROM public.active_sessions WHERE user_id = p_target_id;
  END IF;

  -- 11. Success payload for the API route (security log + response)
  RETURN jsonb_build_object(
    'success', true,
    'target_full_name', coalesce(target_full_name, 'Unknown user'),
    'target_role', target_role,
    'target_lab_id', to_jsonb(target_lab_id)
  );
END;
$$;

-- 2. Privileges
-- service_role-only closes the direct supabase.rpc bypass; every call must
-- flow through the API route (auth + rate limit + audit logging guaranteed).
REVOKE ALL ON FUNCTION public.set_user_active_status(uuid, uuid, boolean)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_active_status(uuid, uuid, boolean)
  TO service_role;

-- 3. Verification block (commented out — run AFTER sections 1–2)
--
-- 3a. Function flags:
-- SELECT proname, prosecdef, proconfig
-- FROM pg_proc
-- WHERE proname = 'set_user_active_status';
-- Expect: prosecdef = true, search_path = '' in proconfig.
--
-- 3b. EXECUTE grants:
-- SELECT
--   has_function_privilege(
--     'authenticated',
--     'public.set_user_active_status(uuid,uuid,boolean)',
--     'EXECUTE'
--   ) AS auth_can_exec,   -- expect false
--   has_function_privilege(
--     'service_role',
--     'public.set_user_active_status(uuid,uuid,boolean)',
--     'EXECUTE'
--   ) AS service_can_exec; -- expect true
--
-- 3c. Editor behavioral tests (editor runs as postgres, so EXECUTE works
-- here regardless of grants). Substitute placeholders:
--   <james-uuid>  = James (super_admin) profiles.id
--   <dummy-uuid>  = Phase B/C throwaway technician profiles.id
--
-- 1. Deactivate dummy:
--    SELECT public.set_user_active_status(
--      '<james-uuid>'::uuid, '<dummy-uuid>'::uuid, false
--    );
--    Expect success:true. Then:
--    SELECT is_active, deactivated_at, deactivated_by
--    FROM public.profiles WHERE id = '<dummy-uuid>';
--    Expect is_active=false, deactivated_at set, deactivated_by = James's
--    full_name. And:
--    SELECT * FROM public.active_sessions WHERE user_id = '<dummy-uuid>';
--    Expect zero rows.
--
-- 2. Reactivate:
--    SELECT public.set_user_active_status(
--      '<james-uuid>'::uuid, '<dummy-uuid>'::uuid, true
--    );
--    Expect success:true; metadata columns NULL.
--
-- 3. Super_admin target (self):
--    SELECT public.set_user_active_status(
--      '<james-uuid>'::uuid, '<james-uuid>'::uuid, false
--    );
--    Expect {success:false, error_code:'super_admin_target'}.
--
-- 4. Forbidden (technician actor → james):
--    SELECT public.set_user_active_status(
--      '<dummy-uuid>'::uuid, '<james-uuid>'::uuid, false
--    );
--    Expect {success:false, error_code:'forbidden'}.
--
-- 5. Already_in_state (reactivate already-active dummy):
--    SELECT public.set_user_active_status(
--      '<james-uuid>'::uuid, '<dummy-uuid>'::uuid, true
--    );
--    Expect {success:false, error_code:'already_in_state'}.
--
-- 6. CONDITIONAL / OPTIONAL — only if Oakwood has exactly one active
--    manager M. Skip if you prefer not to touch the real manager account.
--    (M, M, false) → expect 'last_admin';
--    then (james, M, false) → success (super_admin override) —
--    and IMMEDIATELY reactivate M:
--    SELECT public.set_user_active_status(
--      '<james-uuid>'::uuid, '<manager-uuid>'::uuid, true
--    );
