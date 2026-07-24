


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_lab_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT NULLIF(auth.jwt() ->> 'lab_id', '')::uuid
$$;


ALTER FUNCTION "public"."get_my_lab_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT (auth.jwt() ->> 'org_id')::uuid
$$;


ALTER FUNCTION "public"."get_my_org_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_lab_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Only fires for managers, not technicians
  IF NEW.role = 'manager' AND NEW.lab_id IS NOT NULL THEN
    UPDATE public.labs
    SET owner_id = NEW.id
    WHERE id = NEW.lab_id
      AND owner_id IS NULL; -- only set if not already set
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_lab_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_lab"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO lab_settings (lab_id)
  VALUES (NEW.id)
  ON CONFLICT (lab_id) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_lab"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  meta_role text;
  meta_lab  uuid;
  meta_org  uuid;
BEGIN
  -- Role validation (now includes org_admin)
  meta_role := new.raw_user_meta_data->>'role';
  IF meta_role IS NULL OR meta_role NOT IN ('super_admin', 'org_admin', 'manager', 'technician') THEN
    meta_role := 'technician';
  END IF;

  -- lab_id (null is valid for super_admin and org_admin)
  BEGIN
    meta_lab := (new.raw_user_meta_data->>'lab_id')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      meta_lab := NULL;
  END;

  -- org_id (null is valid for super_admin and single-lab users)
  BEGIN
    meta_org := (new.raw_user_meta_data->>'org_id')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      meta_org := NULL;
  END;

  INSERT INTO public.profiles (id, role, full_name, lab_id, org_id)
  VALUES (
    new.id,
    meta_role,
    COALESCE(new.raw_user_meta_data->>'full_name', 'Unknown'),
    meta_lab,
    meta_org
  );

  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT is_super_admin FROM public.profiles WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lab_billing_allows_writes"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT CASE
    WHEN (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin' THEN true
    ELSE coalesce((
      SELECT ba.billing_status <> 'suspended'
      FROM public.profiles p
      LEFT JOIN public.labs l ON l.id = p.lab_id
      LEFT JOIN public.billing_accounts ba
        ON ba.lab_id = p.lab_id OR ba.org_id = l.org_id
      WHERE p.id = auth.uid()
      LIMIT 1
    ), true)
  END;
$$;


ALTER FUNCTION "public"."lab_billing_allows_writes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_user_active_status"("p_actor_id" "uuid", "p_target_id" "uuid", "p_active" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."set_user_active_status"("p_actor_id" "uuid", "p_target_id" "uuid", "p_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_user_role"("p_actor_id" "uuid", "p_target_id" "uuid", "p_new_role" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."set_user_role"("p_actor_id" "uuid", "p_target_id" "uuid", "p_new_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_is_active"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT coalesce(
    (SELECT is_active FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;


ALTER FUNCTION "public"."user_is_active"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."active_lots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lab_id" "uuid" NOT NULL,
    "item_id" "uuid",
    "lot_number" "text" NOT NULL,
    "opened_date" "date" DEFAULT CURRENT_DATE,
    "working_expiry_date" "date",
    "actual_expiry_date" "date",
    "quantity_left" "text" NOT NULL,
    "status" "text" DEFAULT 'Active'::"text"
);


ALTER TABLE "public"."active_lots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."active_sessions" (
    "user_id" "uuid" NOT NULL,
    "session_token" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."active_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lab_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "user_name" "text" NOT NULL,
    "user_initials" "text" NOT NULL,
    "action_type" "text" NOT NULL,
    "item_name" "text" NOT NULL,
    "lot_number" "text",
    "details" "text"
);


ALTER TABLE "public"."activity_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "lab_id" "uuid",
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "billing_status" "text" DEFAULT 'trialing'::"text" NOT NULL,
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_accounts_billing_status_check" CHECK (("billing_status" = ANY (ARRAY['trialing'::"text", 'active'::"text", 'past_due'::"text", 'suspended'::"text"]))),
    CONSTRAINT "billing_owner_exactly_one" CHECK ((("org_id" IS NULL) <> ("lab_id" IS NULL)))
);


ALTER TABLE "public"."billing_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coa_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lab_id" "uuid" NOT NULL,
    "lot_id" "uuid" NOT NULL,
    "file_url" "text",
    "file_name" "text",
    "lot_number" "text",
    "expiry_date" "date",
    "result" "text",
    "uploaded_by" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text",
    CONSTRAINT "coa_records_result_check" CHECK (("result" = ANY (ARRAY['pass'::"text", 'fail'::"text"])))
);


ALTER TABLE "public"."coa_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lab_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "status" "text" DEFAULT 'Open'::"text"
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_lots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lab_id" "uuid" NOT NULL,
    "item_id" "uuid",
    "lot_number" "text" NOT NULL,
    "expiry_date" "date",
    "received_date" "date" DEFAULT CURRENT_DATE,
    "storage_location" "text",
    "quantity_type" "text" DEFAULT 'units_and_count'::"text",
    "units" numeric DEFAULT 1,
    "unit_label" "text",
    "count" numeric DEFAULT 1,
    "count_label" "text",
    "notes" "text",
    "status" "text" DEFAULT 'In Storage'::"text",
    "validation_status" "text" DEFAULT 'not_required'::"text" NOT NULL,
    "validation_archived_at" timestamp with time zone,
    CONSTRAINT "check_quantity_not_zero" CHECK (((("quantity_type" = 'count_only'::"text") AND ("count" > (0)::numeric)) OR (("quantity_type" = 'units_only'::"text") AND ("units" > (0)::numeric)) OR (("quantity_type" = 'both'::"text") AND (("count" > (0)::numeric) OR ("units" > (0)::numeric))))),
    CONSTRAINT "inventory_lots_validation_status_check" CHECK (("validation_status" = ANY (ARRAY['not_required'::"text", 'pending_coa'::"text", 'pending_validation'::"text", 'pending_approval'::"text", 'approved'::"text", 'rejected'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."inventory_lots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lab_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "vendor" "text",
    "catalog_number" "text",
    "vendor_sku" "text",
    "default_price" numeric(10,2),
    "requires_coa" boolean DEFAULT false NOT NULL,
    "requires_lot_validation" boolean DEFAULT false NOT NULL,
    "expiring_soon_days" integer,
    "urgent_days" integer,
    "low_stock_threshold" integer,
    "working_expiry_days" integer
);


ALTER TABLE "public"."items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lab_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" NOT NULL,
    "lab_name" "text" NOT NULL,
    "used" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "used_at" timestamp with time zone,
    "lab_id" "uuid",
    "org_id" "uuid",
    "role" "text" DEFAULT 'manager'::"text",
    "created_by" "uuid",
    "revoked_at" timestamp with time zone,
    "revoked_by" "uuid",
    CONSTRAINT "lab_invites_role_check" CHECK (("role" = ANY (ARRAY['manager'::"text", 'org_admin'::"text"])))
);


ALTER TABLE "public"."lab_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lab_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lab_id" "uuid" NOT NULL,
    "urgent_days" integer DEFAULT 7 NOT NULL,
    "expiring_soon_days" integer DEFAULT 30 NOT NULL,
    "low_stock_threshold" integer DEFAULT 5 NOT NULL,
    "lab_timezone" "text" DEFAULT 'America/Chicago'::"text" NOT NULL,
    "tech_dashboard_widget" "text" DEFAULT 'donut'::"text" NOT NULL,
    "require_coa_approval" boolean DEFAULT false NOT NULL,
    "techs_can_edit_thresholds" boolean DEFAULT true NOT NULL,
    "onboarding_complete" boolean DEFAULT false NOT NULL,
    "audit_log_retention_years" integer DEFAULT 3,
    CONSTRAINT "audit_log_retention_years_range" CHECK ((("audit_log_retention_years" >= 1) AND ("audit_log_retention_years" <= 10))),
    CONSTRAINT "lab_settings_tech_dashboard_widget_check" CHECK (("tech_dashboard_widget" = ANY (ARRAY['donut'::"text", 'waste'::"text", 'expenses'::"text", 'none'::"text"])))
);


ALTER TABLE "public"."lab_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."labs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "tech_key" "text" NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_id" "uuid",
    "org_id" "uuid",
    "trial_starts_at" timestamp with time zone DEFAULT "now"(),
    "trial_ends_at" timestamp with time zone DEFAULT ("now"() + '90 days'::interval)
);


ALTER TABLE "public"."labs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lot_validation_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lab_id" "uuid" NOT NULL,
    "lot_id" "uuid" NOT NULL,
    "previous_lot_number" "text",
    "result" "text",
    "submitted_by" "text",
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "approved_by" "text",
    "approved_at" timestamp with time zone,
    "rejection_reason" "text",
    "notes" "text",
    "file_url" "text",
    "file_name" "text",
    CONSTRAINT "lot_validation_records_result_check" CHECK (("result" = ANY (ARRAY['acceptable'::"text", 'not_acceptable'::"text"])))
);


ALTER TABLE "public"."lot_validation_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mfa_recovery_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "code_hash" "text" NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "batch_id" "uuid" NOT NULL
);


ALTER TABLE "public"."mfa_recovery_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mfa_recovery_elevations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mfa_recovery_elevations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "plan" "text" DEFAULT 'trial'::"text",
    "trial_ends_at" timestamp with time zone DEFAULT ("now"() + '90 days'::interval),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."processed_stripe_events" (
    "event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payload" "jsonb"
);


ALTER TABLE "public"."processed_stripe_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "lab_id" "uuid",
    "full_name" "text",
    "role" "text" DEFAULT 'technician'::"text" NOT NULL,
    "org_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true NOT NULL,
    "deactivated_at" timestamp with time zone,
    "deactivated_by" "text",
    CONSTRAINT "profiles_deactivation_state_chk" CHECK (((("is_active" = true) AND ("deactivated_at" IS NULL) AND ("deactivated_by" IS NULL)) OR (("is_active" = false) AND ("deactivated_at" IS NOT NULL) AND ("deactivated_by" IS NOT NULL)))),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['super_admin'::"text", 'org_admin'::"text", 'manager'::"text", 'technician'::"text"]))),
    CONSTRAINT "profiles_super_admin_always_active_chk" CHECK ((NOT (("role" = 'super_admin'::"text") AND ("is_active" = false))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lab_id" "uuid" NOT NULL,
    "item_id" "uuid",
    "catalog_number" "text",
    "item_name" "text",
    "vendor" "text",
    "order_qty" numeric NOT NULL,
    "unit_price" numeric(10,2),
    "total_price" numeric(10,2),
    "status" "text" DEFAULT 'Pending'::"text",
    "notes" "text",
    "date_requested" "date" DEFAULT CURRENT_DATE
);


ALTER TABLE "public"."requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."security_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "user_id" "uuid",
    "user_name" "text" NOT NULL,
    "user_initials" "text" NOT NULL,
    "user_role" "text" NOT NULL,
    "lab_id" "uuid",
    "event_type" "text" NOT NULL,
    "outcome" "text" NOT NULL,
    "details" "text",
    "ip_address" "text",
    CONSTRAINT "security_logs_event_outcome_valid" CHECK ((("event_type" = 'recovery_code_redeemed'::"text") OR ("event_type" = 'login'::"text") OR (("event_type" = ANY (ARRAY['logout'::"text", 'recovery_codes_generated'::"text", 'user_deactivated'::"text", 'user_reactivated'::"text", 'mfa_factor_enrolled'::"text", 'mfa_factor_replaced'::"text", 'role_changed'::"text"])) AND ("outcome" = 'success'::"text")))),
    CONSTRAINT "security_logs_event_type_check" CHECK (("event_type" = ANY (ARRAY['login'::"text", 'logout'::"text", 'recovery_codes_generated'::"text", 'recovery_code_redeemed'::"text", 'user_deactivated'::"text", 'user_reactivated'::"text", 'mfa_factor_enrolled'::"text", 'mfa_factor_replaced'::"text", 'role_changed'::"text"]))),
    CONSTRAINT "security_logs_outcome_check" CHECK (("outcome" = ANY (ARRAY['success'::"text", 'failure'::"text"]))),
    CONSTRAINT "security_logs_user_role_check" CHECK (("user_role" = ANY (ARRAY['super_admin'::"text", 'org_admin'::"text", 'manager'::"text", 'technician'::"text"])))
);


ALTER TABLE "public"."security_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."security_logs" IS 'Append-only access-control audit trail. Server-side writes only (service role).';



COMMENT ON COLUMN "public"."security_logs"."user_id" IS 'Forensic join to auth.users when account still exists. No FK — deletion must not orphan the trail.';



COMMENT ON COLUMN "public"."security_logs"."lab_id" IS 'Nullable: super_admin and org_admin events have no lab. ON DELETE SET NULL preserves rows when a lab is deleted.';



ALTER TABLE ONLY "public"."active_lots"
    ADD CONSTRAINT "active_lots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."active_sessions"
    ADD CONSTRAINT "active_sessions_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."activity_logs"
    ADD CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_accounts"
    ADD CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_accounts"
    ADD CONSTRAINT "billing_accounts_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."billing_accounts"
    ADD CONSTRAINT "billing_accounts_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."coa_records"
    ADD CONSTRAINT "coa_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_lots"
    ADD CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_lots"
    ADD CONSTRAINT "inventory_lots_unique_lot_per_lab" UNIQUE ("lab_id", "item_id", "lot_number");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lab_invites"
    ADD CONSTRAINT "lab_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lab_invites"
    ADD CONSTRAINT "lab_invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."lab_settings"
    ADD CONSTRAINT "lab_settings_lab_id_key" UNIQUE ("lab_id");



ALTER TABLE ONLY "public"."lab_settings"
    ADD CONSTRAINT "lab_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."labs"
    ADD CONSTRAINT "labs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."labs"
    ADD CONSTRAINT "labs_tech_key_key" UNIQUE ("tech_key");



ALTER TABLE ONLY "public"."lot_validation_records"
    ADD CONSTRAINT "lot_validation_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mfa_recovery_codes"
    ADD CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mfa_recovery_elevations"
    ADD CONSTRAINT "mfa_recovery_elevations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."processed_stripe_events"
    ADD CONSTRAINT "processed_stripe_events_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."requests"
    ADD CONSTRAINT "requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."security_logs"
    ADD CONSTRAINT "security_logs_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "billing_accounts_lab_unique" ON "public"."billing_accounts" USING "btree" ("lab_id") WHERE ("lab_id" IS NOT NULL);



CREATE UNIQUE INDEX "billing_accounts_org_unique" ON "public"."billing_accounts" USING "btree" ("org_id") WHERE ("org_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_lab_invites_active_per_lab" ON "public"."lab_invites" USING "btree" ("lab_id") WHERE (("used" = false) AND ("revoked_at" IS NULL));



CREATE INDEX "idx_labs_org_id" ON "public"."labs" USING "btree" ("org_id");



CREATE UNIQUE INDEX "labs_name_unique_ci" ON "public"."labs" USING "btree" ("lower"("name"));



CREATE INDEX "mfa_recovery_codes_user_id_idx" ON "public"."mfa_recovery_codes" USING "btree" ("user_id");



CREATE INDEX "mfa_recovery_codes_user_id_used_at_idx" ON "public"."mfa_recovery_codes" USING "btree" ("user_id", "used_at");



CREATE INDEX "mfa_recovery_elevations_expires_at_idx" ON "public"."mfa_recovery_elevations" USING "btree" ("expires_at");



CREATE UNIQUE INDEX "mfa_recovery_elevations_user_session_idx" ON "public"."mfa_recovery_elevations" USING "btree" ("user_id", "session_id");



CREATE INDEX "security_logs_lab_id_created_at_idx" ON "public"."security_logs" USING "btree" ("lab_id", "created_at" DESC);



CREATE INDEX "security_logs_user_id_idx" ON "public"."security_logs" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "feedback-notify" AFTER INSERT ON "public"."feedback" FOR EACH ROW EXECUTE FUNCTION "supabase_functions"."http_request"('https://buddy-lab-tracker.vercel.app/api/feedback-notify', 'POST', '{"Content-type":"application/json","x-webhook-secret":"buddylab_webhook_secret_2024"}', '{}', '5000');



CREATE OR REPLACE TRIGGER "on_lab_created" AFTER INSERT ON "public"."labs" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_lab"();



CREATE OR REPLACE TRIGGER "on_manager_profile_created" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_lab_owner"();



ALTER TABLE ONLY "public"."active_lots"
    ADD CONSTRAINT "active_lots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."active_lots"
    ADD CONSTRAINT "active_lots_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."active_sessions"
    ADD CONSTRAINT "active_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_logs"
    ADD CONSTRAINT "activity_logs_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_accounts"
    ADD CONSTRAINT "billing_accounts_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."billing_accounts"
    ADD CONSTRAINT "billing_accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."coa_records"
    ADD CONSTRAINT "coa_records_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coa_records"
    ADD CONSTRAINT "coa_records_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."inventory_lots"
    ADD CONSTRAINT "inventory_lots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_lots"
    ADD CONSTRAINT "inventory_lots_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lab_invites"
    ADD CONSTRAINT "lab_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."lab_invites"
    ADD CONSTRAINT "lab_invites_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lab_invites"
    ADD CONSTRAINT "lab_invites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lab_invites"
    ADD CONSTRAINT "lab_invites_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."lab_settings"
    ADD CONSTRAINT "lab_settings_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."labs"
    ADD CONSTRAINT "labs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."labs"
    ADD CONSTRAINT "labs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lot_validation_records"
    ADD CONSTRAINT "lot_validation_records_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lot_validation_records"
    ADD CONSTRAINT "lot_validation_records_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mfa_recovery_codes"
    ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mfa_recovery_elevations"
    ADD CONSTRAINT "mfa_recovery_elevations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."requests"
    ADD CONSTRAINT "requests_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."requests"
    ADD CONSTRAINT "requests_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."security_logs"
    ADD CONSTRAINT "security_logs_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE SET NULL;



CREATE POLICY "Allow auth admin to read profiles" ON "public"."profiles" FOR SELECT TO "supabase_auth_admin" USING (true);



CREATE POLICY "Org admin sees own org" ON "public"."organizations" FOR SELECT USING (((("auth"."jwt"() ->> 'user_role'::"text") = 'org_admin'::"text") AND ("id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid")));



CREATE POLICY "Org admins manage invites for their org" ON "public"."lab_invites" USING (((("auth"."jwt"() ->> 'user_role'::"text") = 'org_admin'::"text") AND ("org_id" = "public"."get_my_org_id"()) AND ("role" = 'manager'::"text")));



CREATE POLICY "Org admins see profiles in their org" ON "public"."profiles" FOR SELECT USING (((("auth"."jwt"() ->> 'user_role'::"text") = 'org_admin'::"text") AND ("lab_id" IN ( SELECT "labs"."id"
   FROM "public"."labs"
  WHERE ("labs"."org_id" = "public"."get_my_org_id"())))));



CREATE POLICY "Org admins see their org labs" ON "public"."labs" FOR SELECT USING (((("auth"."jwt"() ->> 'user_role'::"text") = 'org_admin'::"text") AND ("org_id" = "public"."get_my_org_id"())));



CREATE POLICY "Org admins update profiles in their org" ON "public"."profiles" FOR UPDATE USING (((("auth"."jwt"() ->> 'user_role'::"text") = 'org_admin'::"text") AND ("lab_id" IN ( SELECT "labs"."id"
   FROM "public"."labs"
  WHERE ("labs"."org_id" = "public"."get_my_org_id"()))) AND ("role" = ANY (ARRAY['manager'::"text", 'technician'::"text"])))) WITH CHECK (("role" = ANY (ARRAY['manager'::"text", 'technician'::"text"])));



CREATE POLICY "Super admin full access" ON "public"."organizations" USING ((("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text"));



CREATE POLICY "Users can insert own feedback" ON "public"."feedback" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"()))));



CREATE POLICY "Users can view own feedback" ON "public"."feedback" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR (("auth"."uid"() = "user_id") AND ("lab_id" = "public"."get_my_lab_id"()))));



ALTER TABLE "public"."active_lots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "active_lots_billing_delete" ON "public"."active_lots" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "active_lots_billing_insert" ON "public"."active_lots" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "active_lots_billing_update" ON "public"."active_lots" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes")) WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "active_lots_delete_lab_or_super" ON "public"."active_lots" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "active_lots_insert_lab_or_super" ON "public"."active_lots" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "active_lots_require_active_user" ON "public"."active_lots" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



CREATE POLICY "active_lots_select_lab_or_super" ON "public"."active_lots" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "active_lots_update_lab_or_super" ON "public"."active_lots" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"()))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



ALTER TABLE "public"."active_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "active_sessions_own" ON "public"."active_sessions" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."activity_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_logs_insert" ON "public"."activity_logs" FOR INSERT TO "authenticated" WITH CHECK (("lab_id" = "public"."get_my_lab_id"()));



CREATE POLICY "activity_logs_require_active_user" ON "public"."activity_logs" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



CREATE POLICY "activity_logs_select" ON "public"."activity_logs" FOR SELECT TO "authenticated" USING (((("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text") OR ("lab_id" = "public"."get_my_lab_id"())));



ALTER TABLE "public"."billing_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_accounts_require_active_user" ON "public"."billing_accounts" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



CREATE POLICY "billing_accounts_select_scoped" ON "public"."billing_accounts" FOR SELECT TO "authenticated" USING (((("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text") OR ((("auth"."jwt"() ->> 'user_role'::"text") = 'manager'::"text") AND ("lab_id" = "public"."get_my_lab_id"())) OR ((("auth"."jwt"() ->> 'user_role'::"text") = 'technician'::"text") AND ("lab_id" = "public"."get_my_lab_id"())) OR ((("auth"."jwt"() ->> 'user_role'::"text") = 'org_admin'::"text") AND ("org_id" = "public"."get_my_org_id"()))));



ALTER TABLE "public"."coa_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coa_records_billing_delete" ON "public"."coa_records" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "coa_records_billing_insert" ON "public"."coa_records" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "coa_records_billing_update" ON "public"."coa_records" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes")) WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "coa_records_delete" ON "public"."coa_records" FOR DELETE TO "authenticated" USING (("lab_id" = ( SELECT "profiles"."lab_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "coa_records_insert" ON "public"."coa_records" FOR INSERT TO "authenticated" WITH CHECK (("lab_id" = ( SELECT "profiles"."lab_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "coa_records_require_active_user" ON "public"."coa_records" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



CREATE POLICY "coa_records_select" ON "public"."coa_records" FOR SELECT TO "authenticated" USING (("lab_id" = ( SELECT "profiles"."lab_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "coa_records_super_admin" ON "public"."coa_records" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))));



CREATE POLICY "coa_records_update" ON "public"."coa_records" FOR UPDATE TO "authenticated" USING (("lab_id" = ( SELECT "profiles"."lab_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback_require_active_user" ON "public"."feedback" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



ALTER TABLE "public"."inventory_lots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inventory_lots_billing_delete" ON "public"."inventory_lots" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "inventory_lots_billing_insert" ON "public"."inventory_lots" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "inventory_lots_billing_update" ON "public"."inventory_lots" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes")) WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "inventory_lots_delete_lab_or_super" ON "public"."inventory_lots" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "inventory_lots_insert_lab_or_super" ON "public"."inventory_lots" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "inventory_lots_require_active_user" ON "public"."inventory_lots" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



CREATE POLICY "inventory_lots_select_lab_or_super" ON "public"."inventory_lots" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "inventory_lots_update_lab_or_super" ON "public"."inventory_lots" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"()))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



ALTER TABLE "public"."items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "items_billing_delete" ON "public"."items" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "items_billing_insert" ON "public"."items" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "items_billing_update" ON "public"."items" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes")) WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "items_delete_lab_or_super" ON "public"."items" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "items_insert_lab_or_super" ON "public"."items" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "items_require_active_user" ON "public"."items" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



CREATE POLICY "items_select_lab_or_super" ON "public"."items" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "items_update_lab_or_super" ON "public"."items" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"()))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



ALTER TABLE "public"."lab_invites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lab_invites_all_super_admin" ON "public"."lab_invites" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))));



CREATE POLICY "lab_invites_require_active_user" ON "public"."lab_invites" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



CREATE POLICY "lab_invites_select_by_token" ON "public"."lab_invites" FOR SELECT TO "anon" USING (true);



CREATE POLICY "lab_invites_super_admin_only" ON "public"."lab_invites" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))));



CREATE POLICY "lab_invites_update_by_token" ON "public"."lab_invites" FOR UPDATE TO "anon" USING (("used" = false)) WITH CHECK (("used" = true));



CREATE POLICY "lab_invites_update_by_token_authenticated" ON "public"."lab_invites" FOR UPDATE TO "authenticated" USING (("used" = false)) WITH CHECK (("used" = true));



ALTER TABLE "public"."lab_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lab_settings_billing_delete" ON "public"."lab_settings" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "lab_settings_billing_insert" ON "public"."lab_settings" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "lab_settings_billing_update" ON "public"."lab_settings" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes")) WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "lab_settings_delete_lab_or_super" ON "public"."lab_settings" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "lab_settings_insert_lab_or_super" ON "public"."lab_settings" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "lab_settings_require_active_user" ON "public"."lab_settings" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



CREATE POLICY "lab_settings_select_lab_or_super" ON "public"."lab_settings" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "lab_settings_update_lab_or_super" ON "public"."lab_settings" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"()))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



ALTER TABLE "public"."labs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "labs_all_super_admin" ON "public"."labs" USING ((("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text"));



CREATE POLICY "labs_insert_anon" ON "public"."labs" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "labs_require_active_user" ON "public"."labs" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



CREATE POLICY "labs_select_by_registration_key" ON "public"."labs" FOR SELECT TO "anon" USING (true);



CREATE POLICY "labs_select_own_lab" ON "public"."labs" FOR SELECT USING (("id" = "public"."get_my_lab_id"()));



CREATE POLICY "labs_select_super_admin_only" ON "public"."labs" FOR SELECT USING ((("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text"));



CREATE POLICY "labs_update_own_lab" ON "public"."labs" FOR UPDATE USING (((("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text") OR ("id" = "public"."get_my_lab_id"()))) WITH CHECK (((("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text") OR ("id" = "public"."get_my_lab_id"())));



CREATE POLICY "lot_validation_lab_access" ON "public"."lot_validation_records" TO "authenticated" USING (("lab_id" = ( SELECT "profiles"."lab_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



ALTER TABLE "public"."lot_validation_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lot_validation_records_billing_delete" ON "public"."lot_validation_records" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "lot_validation_records_billing_insert" ON "public"."lot_validation_records" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "lot_validation_records_billing_update" ON "public"."lot_validation_records" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes")) WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "lot_validation_records_require_active_user" ON "public"."lot_validation_records" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



CREATE POLICY "lot_validation_super_admin" ON "public"."lot_validation_records" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))));



ALTER TABLE "public"."mfa_recovery_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mfa_recovery_elevations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations_require_active_user" ON "public"."organizations" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



ALTER TABLE "public"."processed_stripe_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_delete_super_only" ON "public"."profiles" FOR DELETE USING ((("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text"));



CREATE POLICY "profiles_insert_super_only" ON "public"."profiles" FOR INSERT WITH CHECK ((("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text"));



CREATE POLICY "profiles_select_own_lab_or_super" ON "public"."profiles" FOR SELECT USING ((("id" = "auth"."uid"()) OR ("lab_id" = "public"."get_my_lab_id"()) OR (("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text")));



CREATE POLICY "profiles_update_own_or_super" ON "public"."profiles" FOR UPDATE USING ((("id" = "auth"."uid"()) OR (("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text"))) WITH CHECK ((("id" = "auth"."uid"()) OR (("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text")));



ALTER TABLE "public"."requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "requests_billing_delete" ON "public"."requests" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "requests_billing_insert" ON "public"."requests" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "requests_billing_update" ON "public"."requests" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes")) WITH CHECK (( SELECT "public"."lab_billing_allows_writes"() AS "lab_billing_allows_writes"));



CREATE POLICY "requests_delete_lab_or_super" ON "public"."requests" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "requests_insert_lab_or_super" ON "public"."requests" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "requests_require_active_user" ON "public"."requests" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



CREATE POLICY "requests_select_lab_or_super" ON "public"."requests" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



CREATE POLICY "requests_update_lab_or_super" ON "public"."requests" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"()))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'super_admin'::"text")))) OR ("lab_id" = "public"."get_my_lab_id"())));



ALTER TABLE "public"."security_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "security_logs_require_active_user" ON "public"."security_logs" AS RESTRICTIVE TO "authenticated" USING (( SELECT "public"."user_is_active"() AS "user_is_active")) WITH CHECK (( SELECT "public"."user_is_active"() AS "user_is_active"));



CREATE POLICY "security_logs_select_scoped" ON "public"."security_logs" FOR SELECT TO "authenticated" USING (((("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text") OR ((("auth"."jwt"() ->> 'user_role'::"text") = 'manager'::"text") AND ("lab_id" = "public"."get_my_lab_id"())) OR ((("auth"."jwt"() ->> 'user_role'::"text") = 'org_admin'::"text") AND ("lab_id" IN ( SELECT "labs"."id"
   FROM "public"."labs"
  WHERE ("labs"."org_id" = "public"."get_my_org_id"()))))));



CREATE POLICY "stripe_events_select_super" ON "public"."processed_stripe_events" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'user_role'::"text") = 'super_admin'::"text"));



CREATE POLICY "users select own recovery codes" ON "public"."mfa_recovery_codes" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."get_my_lab_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_lab_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_lab_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_lab_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_lab_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_lab_owner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_lab"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_lab"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_lab"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."lab_billing_allows_writes"() TO "anon";
GRANT ALL ON FUNCTION "public"."lab_billing_allows_writes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."lab_billing_allows_writes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_user_active_status"("p_actor_id" "uuid", "p_target_id" "uuid", "p_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_user_active_status"("p_actor_id" "uuid", "p_target_id" "uuid", "p_active" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_user_role"("p_actor_id" "uuid", "p_target_id" "uuid", "p_new_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_user_role"("p_actor_id" "uuid", "p_target_id" "uuid", "p_new_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_is_active"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_is_active"() TO "anon";
GRANT ALL ON FUNCTION "public"."user_is_active"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_is_active"() TO "service_role";



GRANT ALL ON TABLE "public"."active_lots" TO "anon";
GRANT ALL ON TABLE "public"."active_lots" TO "authenticated";
GRANT ALL ON TABLE "public"."active_lots" TO "service_role";



GRANT ALL ON TABLE "public"."active_sessions" TO "anon";
GRANT ALL ON TABLE "public"."active_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."active_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."activity_logs" TO "anon";
GRANT ALL ON TABLE "public"."activity_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_logs" TO "service_role";



GRANT ALL ON TABLE "public"."billing_accounts" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."billing_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_accounts" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."billing_accounts" TO "authenticated";



GRANT SELECT("org_id") ON TABLE "public"."billing_accounts" TO "authenticated";



GRANT SELECT("lab_id") ON TABLE "public"."billing_accounts" TO "authenticated";



GRANT SELECT("billing_status") ON TABLE "public"."billing_accounts" TO "authenticated";



GRANT SELECT("current_period_end") ON TABLE "public"."billing_accounts" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."billing_accounts" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."billing_accounts" TO "authenticated";



GRANT ALL ON TABLE "public"."coa_records" TO "anon";
GRANT ALL ON TABLE "public"."coa_records" TO "authenticated";
GRANT ALL ON TABLE "public"."coa_records" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_lots" TO "anon";
GRANT ALL ON TABLE "public"."inventory_lots" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_lots" TO "service_role";



GRANT ALL ON TABLE "public"."items" TO "anon";
GRANT ALL ON TABLE "public"."items" TO "authenticated";
GRANT ALL ON TABLE "public"."items" TO "service_role";



GRANT ALL ON TABLE "public"."lab_invites" TO "anon";
GRANT ALL ON TABLE "public"."lab_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."lab_invites" TO "service_role";



GRANT ALL ON TABLE "public"."lab_settings" TO "anon";
GRANT ALL ON TABLE "public"."lab_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."lab_settings" TO "service_role";



GRANT ALL ON TABLE "public"."labs" TO "anon";
GRANT ALL ON TABLE "public"."labs" TO "authenticated";
GRANT ALL ON TABLE "public"."labs" TO "service_role";
GRANT SELECT ON TABLE "public"."labs" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."lot_validation_records" TO "anon";
GRANT ALL ON TABLE "public"."lot_validation_records" TO "authenticated";
GRANT ALL ON TABLE "public"."lot_validation_records" TO "service_role";



GRANT ALL ON TABLE "public"."mfa_recovery_codes" TO "anon";
GRANT ALL ON TABLE "public"."mfa_recovery_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."mfa_recovery_codes" TO "service_role";



GRANT ALL ON TABLE "public"."mfa_recovery_elevations" TO "anon";
GRANT ALL ON TABLE "public"."mfa_recovery_elevations" TO "authenticated";
GRANT ALL ON TABLE "public"."mfa_recovery_elevations" TO "service_role";
GRANT SELECT ON TABLE "public"."mfa_recovery_elevations" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."processed_stripe_events" TO "anon";
GRANT ALL ON TABLE "public"."processed_stripe_events" TO "authenticated";
GRANT ALL ON TABLE "public"."processed_stripe_events" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "supabase_auth_admin";



GRANT SELECT("id") ON TABLE "public"."profiles" TO "supabase_auth_admin";



GRANT SELECT("lab_id") ON TABLE "public"."profiles" TO "supabase_auth_admin";
GRANT UPDATE("lab_id") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("full_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("role") ON TABLE "public"."profiles" TO "supabase_auth_admin";



GRANT SELECT("org_id") ON TABLE "public"."profiles" TO "supabase_auth_admin";
GRANT UPDATE("org_id") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."requests" TO "anon";
GRANT ALL ON TABLE "public"."requests" TO "authenticated";
GRANT ALL ON TABLE "public"."requests" TO "service_role";



GRANT ALL ON TABLE "public"."security_logs" TO "anon";
GRANT ALL ON TABLE "public"."security_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."security_logs" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







