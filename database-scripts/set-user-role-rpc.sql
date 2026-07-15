-- set-user-role-rpc: Phase 1b (B) — set_user_role RPC (service_role only).
-- Run in Supabase SQL editor BEFORE deploying app/api/users/set-role.
-- Do NOT run the verification block (section 3) in the same paste —
-- execute sections 1–2 first, then 3a–3c as instructed.
--
-- Prerequisites: role-column-lockdown.sql (REVOKE UPDATE on role) and
-- security-events-extension.sql (role_changed event type allowed).
-- No UI in this file — app rewires Edit Role surfaces to the route.

-- 1. Function
CREATE OR REPLACE FUNCTION public.set_user_role(
  p_actor_id uuid,
  p_target_id uuid,
  p_new_role text
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
  target_full_name text;
  peer_count integer;
  allowed boolean := false;
BEGIN
  -- 1. Validate assignable role (org_admin stays registration-only;
  --    super_admin is never assignable via this RPC)
  IF p_new_role IS NULL OR p_new_role NOT IN ('manager', 'technician') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_role');
  END IF;

  -- 2. Load actor
  SELECT role, lab_id, org_id, is_active, full_name
  INTO actor_role, actor_lab_id, actor_org_id, actor_is_active, actor_full_name
  FROM public.profiles
  WHERE id = p_actor_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'actor_not_found');
  END IF;

  IF actor_is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'actor_inactive');
  END IF;

  IF actor_role NOT IN ('manager', 'org_admin', 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  -- 3. Load target FOR UPDATE (serializes concurrent mutations on this row)
  SELECT role, lab_id, org_id, full_name
  INTO target_role, target_lab_id, target_org_id, target_full_name
  FROM public.profiles
  WHERE id = p_target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'target_not_found');
  END IF;

  -- 4. Super_admin target blocked
  IF target_role = 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'super_admin_target');
  END IF;

  -- 5. Already in requested state
  IF target_role = p_new_role THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_in_state');
  END IF;

  -- 6. Hierarchy (identical to set_user_active_status)
  -- Technicians who join via tech_key never get profiles.org_id set
  -- (registration writes lab_id/full_name; org membership is via labs.org_id)
  -- — so org_admin checks BOTH target.org_id and the lab join.
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

  -- 7. Last-manager DEMOTION guard — parallel to set_user_active_status's
  --    last-admin guard. Fires only when demoting manager → technician,
  --    and only when the actor is NOT super_admin (offboarding/restructure
  --    override). FOR UPDATE makes the count race-proof (concurrent mutual
  --    demotions serialize; the second transaction re-reads after the first
  --    commits and gets a correct 'last_manager').
  IF target_role = 'manager'
     AND p_new_role = 'technician'
     AND actor_role <> 'super_admin' THEN
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

    IF peer_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'last_manager');
    END IF;
  END IF;

  -- 8. Apply role change. No active_sessions delete — demoted user's JWT
  --    role is stale until re-login; UI says "effective next login."
  UPDATE public.profiles
  SET role = p_new_role
  WHERE id = p_target_id;

  -- 9. Success payload for the API route (security log + response)
  RETURN jsonb_build_object(
    'success', true,
    'old_role', target_role,
    'new_role', p_new_role,
    'target_full_name', coalesce(target_full_name, 'Unknown user'),
    'target_lab_id', to_jsonb(target_lab_id)
  );
END;
$$;

-- 2. Privileges
-- service_role-only closes the direct supabase.rpc bypass; every call must
-- flow through the API route (auth + rate limit + audit logging guaranteed).
REVOKE ALL ON FUNCTION public.set_user_role(uuid, uuid, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, uuid, text)
  TO service_role;

-- 3. Verification block (commented out — run AFTER sections 1–2)
--
-- 3a. Function flags:
-- SELECT proname, prosecdef, proconfig
-- FROM pg_proc
-- WHERE proname = 'set_user_role';
-- Expect: prosecdef = true, search_path = '' in proconfig.
--
-- 3b. EXECUTE grants:
-- SELECT
--   has_function_privilege(
--     'authenticated',
--     'public.set_user_role(uuid,uuid,text)',
--     'EXECUTE'
--   ) AS auth_can_exec,   -- expect false
--   has_function_privilege(
--     'service_role',
--     'public.set_user_role(uuid,uuid,text)',
--     'EXECUTE'
--   ) AS service_can_exec; -- expect true
--
-- 3c. Editor behavioral tests (editor runs as postgres, so EXECUTE works
-- here regardless of grants). Substitute placeholders:
--   <james-uuid>  = James (super_admin) profiles.id
--   <dummy-uuid>  = throwaway technician profiles.id
--   <manager-uuid> = a lab manager profiles.id (optional c5)
--
-- c1. Promote dummy technician → manager (happy path):
--    SELECT public.set_user_role(
--      '<james-uuid>'::uuid, '<dummy-uuid>'::uuid, 'manager'
--    );
--    Expect success:true, old_role technician, new_role manager.
--    Then demote back:
--    SELECT public.set_user_role(
--      '<james-uuid>'::uuid, '<dummy-uuid>'::uuid, 'technician'
--    );
--    Expect success:true.
--
-- c2. Super_admin target (self):
--    SELECT public.set_user_role(
--      '<james-uuid>'::uuid, '<james-uuid>'::uuid, 'manager'
--    );
--    Expect {success:false, error_code:'super_admin_target'}.
--
-- c3. Forbidden (technician actor → james):
--    SELECT public.set_user_role(
--      '<dummy-uuid>'::uuid, '<james-uuid>'::uuid, 'technician'
--    );
--    Expect {success:false, error_code:'forbidden'}.
--
-- c4. Invalid_role ('super_admin' as new role):
--    SELECT public.set_user_role(
--      '<james-uuid>'::uuid, '<dummy-uuid>'::uuid, 'super_admin'
--    );
--    Expect {success:false, error_code:'invalid_role'}.
--
-- c5. CONDITIONAL / OPTIONAL — only if Oakwood has exactly one active
--    manager M and you have a non-super_admin actor who can attempt the
--    demote. Skip if you prefer not to touch the real manager account.
--    (manager-actor, M, 'technician') → expect 'last_manager';
--    then (james, M, 'technician') → success (super_admin override) —
--    and IMMEDIATELY restore:
--    SELECT public.set_user_role(
--      '<james-uuid>'::uuid, '<manager-uuid>'::uuid, 'manager'
--    );
