-- Run in Supabase SQL editor if `validation_archived_at` is not already on `inventory_lots`.
-- Used for Validation & COA → History ("Archived on …").

alter table public.inventory_lots
add column if not exists validation_archived_at timestamptz;

comment on column public.inventory_lots.validation_archived_at is
  'When the manager moved this lot to validation history (validation_status = archived).';
