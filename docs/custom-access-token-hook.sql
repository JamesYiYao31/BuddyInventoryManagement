-- Custom Access Token Hook — LIVE in Supabase (not auto-deployed from Git).
-- Source of record as of June 7, 2026.
-- Injects lab_id / org_id / user_role into JWT claims. Does NOT touch aal
-- (Supabase reserves aal and overwrites hook-set values).
-- After any CREATE OR REPLACE, RE-APPLY the three grants below — they are stripped.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  claims        jsonb;
  user_lab_id   uuid;
  user_org_id   uuid;
  user_role     text;
BEGIN
  SELECT lab_id, org_id, role INTO user_lab_id, user_org_id, user_role
  FROM public.profiles
  WHERE id = (event->>'user_id')::uuid;
  claims := event->'claims';
  IF user_lab_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{lab_id}', to_jsonb(user_lab_id));
  ELSE
    claims := jsonb_set(claims, '{lab_id}', 'null');
  END IF;
  IF user_org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{org_id}', to_jsonb(user_org_id));
  ELSE
    claims := jsonb_set(claims, '{org_id}', 'null');
  END IF;
  claims := jsonb_set(claims, '{user_role}', to_jsonb(COALESCE(user_role, 'technician')));
  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;
-- Re-apply grants (CREATE OR REPLACE strips them)
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT SELECT ON public.profiles TO supabase_auth_admin;
GRANT SELECT ON public.labs TO supabase_auth_admin;
