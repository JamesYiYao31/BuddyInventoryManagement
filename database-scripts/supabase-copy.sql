-- Buddy Lab Tracker - multi-tenant migration (full script)
-- Clears and recreates public schema tables with lab isolation + RLS

-- ---------------------------------------------------------------------------
-- 1. CLEAR OLD TABLES (dependency order: children first)
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.activity_logs cascade;
drop table if exists public.requests cascade;
drop table if exists public.active_lots cascade;
drop table if exists public.inventory_lots cascade;
drop table if exists public.items cascade;
drop table if exists public.lab_settings cascade;
drop table if exists public.feedback cascade;
drop table if exists public.profiles cascade;
drop table if exists public.lab_invites cascade;
drop table if exists public.labs cascade;

drop function if exists public.get_my_lab_id () cascade;
drop function if exists public.handle_new_user () cascade;

-- ---------------------------------------------------------------------------
-- 2. NEW CORE TABLES - labs and lab_invites (before dependent tables)
-- ---------------------------------------------------------------------------
create table public.labs (
  id uuid default gen_random_uuid () primary key,
  name text not null,
  manager_key text not null unique,
  tech_key text not null unique,
  is_archived boolean not null default false,
  archived_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

create table public.lab_invites (
  id uuid default gen_random_uuid () primary key,
  token text not null unique,
  lab_name text not null,
  used boolean not null default false,
  created_at timestamp with time zone not null default now(),
  used_at timestamp with time zone
);

-- ---------------------------------------------------------------------------
-- 3. LAB SETTINGS (per lab; uuid PK, no hardcoded default row)
-- ---------------------------------------------------------------------------
create table public.lab_settings (
  id uuid default gen_random_uuid () primary key,
  lab_id uuid not null references public.labs (id) on delete cascade,
  urgent_days integer not null default 7,
  expiring_soon_days integer not null default 30,
  low_stock_threshold integer not null default 5,
  lab_timezone text not null default 'America/Chicago',
  tech_dashboard_widget text not null default 'donut',
  constraint lab_settings_tech_dashboard_widget_check check (
    tech_dashboard_widget in ('donut', 'waste', 'expenses', 'none')
  ),
  constraint lab_settings_lab_id_key unique (lab_id)
);

-- ---------------------------------------------------------------------------
-- 4. ITEMS CATALOG
-- ---------------------------------------------------------------------------
create table public.items (
  id uuid default gen_random_uuid () primary key,
  lab_id uuid not null references public.labs (id) on delete cascade,
  name text not null,
  vendor text,
  catalog_number text,
  vendor_sku text,
  default_price numeric(10, 2)
);

-- ---------------------------------------------------------------------------
-- 5. INVENTORY LOTS
-- ---------------------------------------------------------------------------
create table public.inventory_lots (
  id uuid default gen_random_uuid () primary key,
  lab_id uuid not null references public.labs (id) on delete cascade,
  item_id uuid references public.items (id) on delete cascade,
  lot_number text not null,
  expiry_date date,
  received_date date default CURRENT_DATE,
  storage_location text,
  quantity_type text default 'units_and_count',
  units numeric default 1,
  unit_label text,
  count numeric default 1,
  count_label text,
  notes text,
  status text default 'In Storage'
);

-- ---------------------------------------------------------------------------
-- 6. ACTIVE LOTS
-- ---------------------------------------------------------------------------
create table public.active_lots (
  id uuid default gen_random_uuid () primary key,
  lab_id uuid not null references public.labs (id) on delete cascade,
  item_id uuid references public.items (id) on delete cascade,
  lot_number text not null,
  opened_date date default CURRENT_DATE,
  working_expiry_date date,
  actual_expiry_date date,
  quantity_left text not null,
  status text default 'Active'
);

-- ---------------------------------------------------------------------------
-- 7. REORDER REQUESTS
-- ---------------------------------------------------------------------------
create table public.requests (
  id uuid default gen_random_uuid () primary key,
  lab_id uuid not null references public.labs (id) on delete cascade,
  item_id uuid references public.items (id),
  catalog_number text,
  item_name text,
  vendor text,
  order_qty numeric not null,
  unit_price numeric(10, 2),
  total_price numeric(10, 2),
  status text default 'Pending',
  notes text,
  date_requested date default CURRENT_DATE
);

-- ---------------------------------------------------------------------------
-- 8. ACTIVITY LOGS
-- ---------------------------------------------------------------------------
create table public.activity_logs (
  id uuid default gen_random_uuid () primary key,
  lab_id uuid not null references public.labs (id) on delete cascade,
  created_at timestamp with time zone default timezone ('utc'::text, now()) not null,
  user_name text not null,
  user_initials text not null,
  action_type text not null,
  item_name text not null,
  lot_number text,
  details text
);

-- ---------------------------------------------------------------------------
-- 9. PROFILES (before auth trigger)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid references auth.users (id) on delete cascade primary key,
  lab_id uuid references public.labs (id) on delete set null,
  email text,
  full_name text,
  role text not null default 'technician' check (
    role in ('super_admin', 'manager', 'technician')
  )
);

alter table public.profiles disable row level security;

-- ---------------------------------------------------------------------------
-- 10. USER PROFILE TRIGGER
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user () returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role text;
  meta_lab uuid;
begin
  meta_role := new.raw_user_meta_data->>'role';
  if meta_role is null or meta_role not in ('super_admin', 'manager', 'technician') then
    meta_role := 'technician';
  end if;

  begin
    meta_lab := (new.raw_user_meta_data->>'lab_id')::uuid;
  exception
    when invalid_text_representation then
      meta_lab := null;
  end;

  insert into public.profiles (id, email, role, full_name, lab_id)
  values (
    new.id,
    new.email,
    meta_role,
    coalesce(new.raw_user_meta_data->>'full_name', 'Unknown Tech'),
    meta_lab
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. FEEDBACK
-- ---------------------------------------------------------------------------
create table public.feedback (
  id uuid default gen_random_uuid () primary key,
  lab_id uuid not null references public.labs (id) on delete cascade,
  created_at timestamp with time zone default timezone ('utc'::text, now()) not null,
  user_id uuid not null references auth.users,
  type text not null,
  title text not null,
  description text not null,
  status text default 'Open'
);

-- ---------------------------------------------------------------------------
-- 12. RLS HELPER - current user's lab from profile
-- ---------------------------------------------------------------------------
create or replace function public.get_my_lab_id () returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select p.lab_id
  from public.profiles p
  where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 13. ROW LEVEL SECURITY - lab isolation + super_admin sees all
-- ---------------------------------------------------------------------------

-- items
alter table public.items enable row level security;

create policy "items_select_lab_or_super" on public.items for select using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "items_insert_lab_or_super" on public.items for insert with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "items_update_lab_or_super" on public.items for update using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "items_delete_lab_or_super" on public.items for delete using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

-- inventory_lots
alter table public.inventory_lots enable row level security;

create policy "inventory_lots_select_lab_or_super" on public.inventory_lots for select using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "inventory_lots_insert_lab_or_super" on public.inventory_lots for insert with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "inventory_lots_update_lab_or_super" on public.inventory_lots for update using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "inventory_lots_delete_lab_or_super" on public.inventory_lots for delete using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

-- active_lots
alter table public.active_lots enable row level security;

create policy "active_lots_select_lab_or_super" on public.active_lots for select using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "active_lots_insert_lab_or_super" on public.active_lots for insert with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "active_lots_update_lab_or_super" on public.active_lots for update using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "active_lots_delete_lab_or_super" on public.active_lots for delete using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

-- requests
alter table public.requests enable row level security;

create policy "requests_select_lab_or_super" on public.requests for select using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "requests_insert_lab_or_super" on public.requests for insert with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "requests_update_lab_or_super" on public.requests for update using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "requests_delete_lab_or_super" on public.requests for delete using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

-- activity_logs
alter table public.activity_logs enable row level security;

create policy "activity_logs_select_lab_or_super" on public.activity_logs for select using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "activity_logs_insert_lab_or_super" on public.activity_logs for insert with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "activity_logs_update_lab_or_super" on public.activity_logs for update using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "activity_logs_delete_lab_or_super" on public.activity_logs for delete using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

-- lab_settings
alter table public.lab_settings enable row level security;

create policy "lab_settings_select_lab_or_super" on public.lab_settings for select using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "lab_settings_insert_lab_or_super" on public.lab_settings for insert with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "lab_settings_update_lab_or_super" on public.lab_settings for update using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

create policy "lab_settings_delete_lab_or_super" on public.lab_settings for delete using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or lab_id = public.get_my_lab_id ()
);

-- feedback: own-row insert rules + lab isolation; super_admin sees all on select
alter table public.feedback enable row level security;

create policy "Users can insert own feedback" on public.feedback for insert with check (
  auth.uid () = user_id
  and (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'super_admin'
    )
    or lab_id = public.get_my_lab_id ()
  )
);

create policy "Users can view own feedback" on public.feedback for select using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
  or (
    auth.uid () = user_id
    and lab_id = public.get_my_lab_id ()
  )
);

-- ---------------------------------------------------------------------------
-- 14. AUTH TRIGGER (after profiles + handle_new_user exist)
-- ---------------------------------------------------------------------------
create trigger on_auth_user_created
after insert on auth.users for each row
execute function public.handle_new_user ();

-- ---------------------------------------------------------------------------
-- 15. SUPER ADMIN - run manually once after first login
-- ---------------------------------------------------------------------------
/*
  After you have signed up at least once, run (replace email):

  update public.profiles
  set role = 'super_admin',
      lab_id = null
  where email = '[YOUR EMAIL HERE]';
*/
-- Protect labs table
alter table public.labs enable row level security;

create policy "labs_select_super_admin_only" on public.labs
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
    and p.role = 'super_admin'
  )
);

-- Protect lab_invites table  
alter table public.lab_invites enable row level security;

create policy "lab_invites_super_admin_only" on public.lab_invites
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
    and p.role = 'super_admin'
  )
);