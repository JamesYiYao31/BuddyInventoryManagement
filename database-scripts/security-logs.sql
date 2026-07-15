-- security_logs: append-only access-control audit trail (login, logout, recovery codes).
-- Separate from activity_logs (data-integrity / ALCOA+). Run in Supabase SQL editor after review.
--
-- NOTE: event/outcome constraints extended by user-deactivation.sql (July 2026)
-- and again by security-events-extension.sql (July 2026 — MFA enroll/replace +
-- reserved role_changed). Do not run this file standalone against production;
-- constraints here reflect the July 10 initial state.
--
-- lab_id FK uses ON DELETE SET NULL (not CASCADE): a tenant wipe must not delete the
-- security record — the event happened and must survive for compliance forensics.
-- user_id intentionally has NO FK: account deletion must not break the trail; attribution
-- is carried in user_name + user_initials snapshots (same principle as activity_logs).

-- 1. Create the table
create table public.security_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  user_id uuid null,
  user_name text not null,
  user_initials text not null,
  user_role text not null check (
    user_role in ('super_admin', 'org_admin', 'manager', 'technician')
  ),
  lab_id uuid null references public.labs (id) on delete set null,
  event_type text not null check (
    event_type in (
      'login',
      'logout',
      'recovery_codes_generated',
      'recovery_code_redeemed'
    )
  ),
  outcome text not null check (outcome in ('success', 'failure')),
  constraint security_logs_event_outcome_valid check (
    (event_type = 'recovery_code_redeemed')                          -- success or failure
    or (event_type = 'login')                                        -- success now; failure reserved
    or (event_type in ('logout', 'recovery_codes_generated')
        and outcome = 'success')                                     -- these cannot fail
  ),
  details text null,
  ip_address text null
);

comment on table public.security_logs is
  'Append-only access-control audit trail. Server-side writes only (service role).';

comment on column public.security_logs.user_id is
  'Forensic join to auth.users when account still exists. No FK — deletion must not orphan the trail.';

comment on column public.security_logs.lab_id is
  'Nullable: super_admin and org_admin events have no lab. ON DELETE SET NULL preserves rows when a lab is deleted.';

-- 2. Grant Data API access (required May 30, 2026+)
-- SELECT only for authenticated (no client INSERT — all writes via service-role API routes).
grant select on public.security_logs to authenticated;
grant select, insert on public.security_logs to service_role;

-- 3. Enable RLS (Option B)
alter table public.security_logs enable row level security;

-- 4. Policies — JWT only (no profiles subquery), append-only (no UPDATE/DELETE)

-- super_admin: all rows (including lab_id IS NULL).
-- manager / org_admin: lab-scoped rows only (lab_id = get_my_lab_id()).
-- Null-lab rows are visible to super_admin only (org_admin JWT lab_id is null; NULL = NULL is
-- false in SQL, so org_admin own null-lab events are super_admin-visible only — by design).
-- technician: no SELECT policy → no access.
create policy "security_logs_select_scoped"
  on public.security_logs
  for select
  to authenticated
  using (
    (auth.jwt() ->> 'user_role' = 'super_admin')
    or (
      (auth.jwt() ->> 'user_role' in ('manager', 'org_admin'))
      and lab_id = get_my_lab_id()
    )
  );

-- No INSERT policy for authenticated — writes go through service-role in API routes.
-- No UPDATE policy — append-only (21 CFR Part 11 / access-control immutability).
-- No DELETE policy — append-only.

-- 5. Indexes — append-only table, only grows; reads filter by lab_id (RLS) + sort by time.
create index security_logs_lab_id_created_at_idx
  on public.security_logs (lab_id, created_at desc);

create index security_logs_user_id_idx
  on public.security_logs (user_id);

-- If security_logs already exists without this constraint, run:
-- alter table public.security_logs
--   add constraint security_logs_event_outcome_valid check (
--     (event_type = 'recovery_code_redeemed')
--     or (event_type = 'login')
--     or (event_type in ('logout', 'recovery_codes_generated')
--         and outcome = 'success')
--   );
