-- =====================================================================
--  TIME TRACKER — Supabase schema + Row Level Security
--  Run this once in your Supabase project:  Database ▸ SQL Editor ▸ paste ▸ Run
--
--  Replaces the old Firebase/Firestore backend. Design goals:
--   - Employees can only read/write THEIR OWN sessions, requests, payroll.
--   - Only managers (role = 'admin') can touch projects, assignments,
--     settings, and approve requests / mark payroll paid.
--   - The FIRST registered user automatically becomes the manager.
--   - Screenshots (from the desktop app) go to a private storage bucket
--     that only the owner and managers can read.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- profiles — one row per auth user (mirrors the old `users` collection)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  name           text not null default '',
  email          text,
  role           text not null default 'employee' check (role in ('admin','employee')),
  city           text,
  pay_method     text,
  pay_details    text,
  worker_type    text check (worker_type in ('remote','inhouse')),
  track_mode     text check (track_mode in ('activity','inout')),
  breaks_enabled boolean,
  created_at     timestamptz not null default now()
);

-- Admin check. SECURITY DEFINER so it bypasses RLS on profiles
-- (prevents infinite recursion when policies below call it).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Auto-create a profile on signup. First-ever user becomes the manager.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when is_first then 'admin' else 'employee' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- projects, assignments
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  location   text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id                 uuid primary key default gen_random_uuid(),
  employee_uid       uuid not null references public.profiles(id) on delete cascade,
  project_id         uuid not null references public.projects(id) on delete cascade,
  hourly_rate        numeric default 0,
  overtime_rate      numeric,
  overtime_threshold numeric,
  weekly_limit       numeric,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- sessions — the actual tracked time
-- ---------------------------------------------------------------------
create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  employee_uid     uuid not null references public.profiles(id) on delete cascade,
  employee_name    text,
  project_id       uuid references public.projects(id) on delete set null,
  assignment_id    uuid references public.assignments(id) on delete set null,
  memo             text default '',
  week_of          date,
  date             date,
  start_ms         bigint,
  end_ms           bigint,
  duration_seconds integer default 0,
  active_seconds   integer default 0,   -- now actually populated (see app fix)
  keystrokes       integer default 0,
  clicks           integer default 0,
  lunch_seconds    integer default 0,
  break_seconds    integer default 0,
  break_events     jsonb   default '[]'::jsonb,
  manual           boolean default false,
  source           text    default 'timer',
  is_live          boolean default false,  -- lets us detect/finalize abandoned sessions
  created_at       timestamptz not null default now()
);
create index if not exists sessions_emp_week_idx on public.sessions (employee_uid, week_of);

-- ---------------------------------------------------------------------
-- requests — employee-initiated adjust / add / delete, manager approves
-- ---------------------------------------------------------------------
create table if not exists public.requests (
  id           uuid primary key default gen_random_uuid(),
  employee_uid uuid not null references public.profiles(id) on delete cascade,
  type         text,
  payload      jsonb default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles(id)
);

-- ---------------------------------------------------------------------
-- payrolls — one batch per employee per week
-- ---------------------------------------------------------------------
create table if not exists public.payrolls (
  id           uuid primary key default gen_random_uuid(),
  employee_uid uuid not null references public.profiles(id) on delete cascade,
  week_of      date,
  method       text,
  lines        jsonb default '[]'::jsonb,
  adjustments  jsonb default '[]'::jsonb,
  total        numeric default 0,
  paid         boolean default false,
  paid_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- settings — single 'app' row holding all configurable options
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id         text primary key default 'app',
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.settings (id, data) values (
  'app',
  '{
    "currency": "$",
    "weekStartDay": 6,
    "payPeriod": "weekly",
    "paymentMethods": ["Cash", "Bank transfer", "PayPal"],
    "defaultWorkerType": "remote",
    "defaultTrackMode": "activity",
    "defaultBreaksEnabled": true,
    "adjustmentTypes": ["Bonus", "Advance", "Deduction"],
    "screenshotIntervalMin": 10,
    "companyName": "", "companyAddress": "", "companyTaxId": "",
    "companyPhone": "", "companyEmail": ""
  }'::jsonb
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- audit, screenshots
-- ---------------------------------------------------------------------
create table if not exists public.audit (
  id     uuid primary key default gen_random_uuid(),
  who    uuid,
  action text,
  detail text,
  at     timestamptz not null default now()
);

create table if not exists public.screenshots (
  id           uuid primary key default gen_random_uuid(),
  employee_uid uuid not null references public.profiles(id) on delete cascade,
  session_id   uuid references public.sessions(id) on delete cascade,
  path         text,
  url          text,
  taken_at     timestamptz not null default now(),
  date         date
);
create index if not exists screenshots_emp_idx on public.screenshots (employee_uid, taken_at);

-- =====================================================================
--  ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles    enable row level security;
alter table public.projects    enable row level security;
alter table public.assignments enable row level security;
alter table public.sessions    enable row level security;
alter table public.requests    enable row level security;
alter table public.payrolls    enable row level security;
alter table public.settings    enable row level security;
alter table public.audit       enable row level security;
alter table public.screenshots enable row level security;

-- profiles: everyone signed-in can read (needed to show names); update self or admin
create policy "profiles read"        on public.profiles for select to authenticated using (true);
create policy "profiles insert self" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles update"      on public.profiles for update to authenticated using (public.is_admin() or auth.uid() = id);
create policy "profiles delete"      on public.profiles for delete to authenticated using (public.is_admin());

-- projects / assignments / settings: read all, write admin only
create policy "projects read"  on public.projects  for select to authenticated using (true);
create policy "projects write" on public.projects  for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "assignments read"  on public.assignments for select to authenticated using (true);
create policy "assignments write" on public.assignments for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "settings read"  on public.settings for select to authenticated using (true);
create policy "settings write" on public.settings for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- sessions: own or admin to read/insert/update; only admin can delete
create policy "sessions read"   on public.sessions for select to authenticated using (public.is_admin() or employee_uid = auth.uid());
create policy "sessions insert" on public.sessions for insert to authenticated with check (public.is_admin() or employee_uid = auth.uid());
create policy "sessions update" on public.sessions for update to authenticated using (public.is_admin() or employee_uid = auth.uid());
create policy "sessions delete" on public.sessions for delete to authenticated using (public.is_admin());

-- requests: employee reads/creates own; only admin updates (approve/reject)
create policy "requests read"   on public.requests for select to authenticated using (public.is_admin() or employee_uid = auth.uid());
create policy "requests insert" on public.requests for insert to authenticated with check (employee_uid = auth.uid());
create policy "requests update" on public.requests for update to authenticated using (public.is_admin());

-- payrolls: employee reads OWN only (privacy fix vs. old rules); admin does everything
create policy "payrolls read"  on public.payrolls for select to authenticated using (public.is_admin() or employee_uid = auth.uid());
create policy "payrolls write" on public.payrolls for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- audit: admin only
create policy "audit read"   on public.audit for select to authenticated using (public.is_admin());
create policy "audit insert" on public.audit for insert to authenticated with check (public.is_admin());

-- screenshots: employee reads own, admin reads all; owner can insert
create policy "screenshots read"   on public.screenshots for select to authenticated using (public.is_admin() or employee_uid = auth.uid());
create policy "screenshots insert" on public.screenshots for insert to authenticated with check (employee_uid = auth.uid());
create policy "screenshots delete" on public.screenshots for delete to authenticated using (public.is_admin());

-- =====================================================================
--  STORAGE — private bucket for desktop screenshots
--  Path convention: <employee_uid>/<session_id>/<timestamp>.jpg
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

create policy "shots upload own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "shots read own or admin"
  on storage.objects for select to authenticated
  using (bucket_id = 'screenshots'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create policy "shots delete admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'screenshots' and public.is_admin());

-- =====================================================================
--  MIGRATIONS — columns the ported UI needs that weren't in the first cut.
--  Idempotent; safe to re-run.
-- =====================================================================
alter table public.projects    add column if not exists client     text default '';
alter table public.projects    add column if not exists category   text default '';
alter table public.projects    add column if not exists positions  jsonb default '[]'::jsonb;
alter table public.projects    add column if not exists pay_period  text default 'weekly';
alter table public.projects    add column if not exists archived    boolean default false;

alter table public.assignments add column if not exists payment_method text;

alter table public.profiles    add column if not exists active      boolean default true;

alter table public.sessions    add column if not exists payroll_id  uuid references public.payrolls(id) on delete set null;

-- payroll batches: drafts hold pending adjustments before a payment is created
alter table public.payrolls    add column if not exists draft         boolean default false;
alter table public.payrolls    add column if not exists employee_name text;
alter table public.payrolls    add column if not exists paid_by       uuid;
alter table public.payrolls    add column if not exists session_count integer default 0;

-- idle time excluded from a session's counted duration (Upwork-style)
alter table public.sessions    add column if not exists idle_seconds  integer default 0;

-- ---------------------------------------------------------------------
-- Close open registration: employees start INACTIVE (pending) and must be
-- activated by a manager. The first user (the manager) is active immediately.
-- Re-created here so it runs after the `active` column exists.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, email, name, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when is_first then 'admin' else 'employee' end,
    is_first  -- first user active; everyone else pending until a manager activates
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Let employees delete their OWN screenshots (review + discard), in addition
-- to the manager-delete policies already defined.
-- ---------------------------------------------------------------------
drop policy if exists "screenshots delete own" on public.screenshots;
create policy "screenshots delete own" on public.screenshots
  for delete to authenticated using (employee_uid = auth.uid());

drop policy if exists "shots delete own" on storage.objects;
create policy "shots delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
--  SCREENSHOT RETENTION — auto-delete shots older than N days so Storage
--  doesn't grow forever. Runs daily via pg_cron. Change '14 days' to taste.
--  Requires the pg_cron + pg_net extensions (available on Supabase).
-- =====================================================================
create extension if not exists pg_cron;

create or replace function public.purge_old_screenshots(older_than interval default '14 days')
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  n integer;
begin
  -- remove the storage objects (frees the actual files)
  delete from storage.objects
  where bucket_id = 'screenshots'
    and created_at < now() - older_than;
  -- remove the metadata rows
  with del as (
    delete from public.screenshots
    where taken_at < now() - older_than
    returning 1
  )
  select count(*) into n from del;
  return n;
end;
$$;

-- schedule it once, daily at 03:00 UTC (id-safe: unschedule any prior copy)
do $$
begin
  perform cron.unschedule('purge_old_screenshots')
    where exists (select 1 from cron.job where jobname = 'purge_old_screenshots');
  perform cron.schedule('purge_old_screenshots', '0 3 * * *',
    $cmd$ select public.purge_old_screenshots('14 days'); $cmd$);
end $$;

-- =====================================================================
--  REALTIME — the app relies on live updates (was Firestore onSnapshot).
--  Add every app table to the supabase_realtime publication so
--  supabase.channel().on('postgres_changes', ...) fires. RLS still applies
--  to realtime, so employees only receive their own rows.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','projects','assignments','sessions',
    'requests','payrolls','settings','audit','screenshots'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
