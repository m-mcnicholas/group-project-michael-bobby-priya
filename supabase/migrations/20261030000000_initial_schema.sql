-- DuckPlan initial schema: profiles, classes, items, Axis connections, sync runs, reminders.
-- Deadlines are local calendar values (date + time), never time-zone timestamps.
-- Every table has row-level security; the browser only ever sees its own rows.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  time_zone text not null default 'America/Los_Angeles',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  teacher text,
  period text,
  color text not null default '#c48b34' check (color ~ '^#[0-9a-fA-F]{6}$'),
  code text check (length(code) <= 4),
  axis_key text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, axis_key),
  -- Lets items reference (class_id, user_id) so an item can only point at its owner's class.
  unique (id, user_id)
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  class_id uuid,
  type text not null default 'task' check (type in ('assignment', 'test', 'task', 'event')),
  title text not null check (length(title) between 1 and 300),
  notes text not null default '',
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date date,
  due_time time,
  scheduled_start timestamp,
  duration_minutes integer not null default 45 check (duration_minutes between 5 and 1440),
  completed boolean not null default false,
  completed_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'axis')),
  axis_uid text,
  axis_missing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, axis_uid),
  foreign key (class_id, user_id) references public.classes (id, user_id) on delete set null (class_id)
);
create index items_user_due_idx on public.items (user_id, due_date) where deleted_at is null;
create index items_user_scheduled_idx on public.items (user_id, scheduled_start) where deleted_at is null;

-- The feed link works like a password, so only the service role (the axis-sync function) can read it.
create table public.axis_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  ical_url text not null,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  added integer not null default 0,
  updated integer not null default 0,
  removed integer not null default 0,
  error text
);
create index sync_runs_user_started_idx on public.sync_runs (user_id, started_at desc);

-- Created now so the shape is settled; delivery arrives in Phase 3.
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  offset_minutes integer not null default 60 check (offset_minutes >= 0),
  fire_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index reminders_unsent_idx on public.reminders (fire_at) where sent_at is null;

-- Timestamps --------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger classes_touch before update on public.classes for each row execute function public.touch_updated_at();
create trigger axis_connections_touch before update on public.axis_connections for each row execute function public.touch_updated_at();

create function public.items_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.completed and (tg_op = 'INSERT' or not old.completed) then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.completed then
    new.completed_at := coalesce(new.completed_at, old.completed_at);
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger items_before_write before insert or update on public.items for each row execute function public.items_before_write();

-- Profiles are created for every new sign-up -------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Row-level security -------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.items enable row level security;
alter table public.axis_connections enable row level security;
alter table public.sync_runs enable row level security;
alter table public.reminders enable row level security;

create policy "Own profile: read" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "Own profile: update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Own classes" on public.classes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Own items" on public.items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Own sync runs: read" on public.sync_runs for select to authenticated using (user_id = (select auth.uid()));

create policy "Own reminders" on public.reminders for all to authenticated
  using (exists (select 1 from public.items i where i.id = item_id and i.user_id = (select auth.uid())))
  with check (exists (select 1 from public.items i where i.id = item_id and i.user_id = (select auth.uid())));

-- axis_connections has no policies, and its grants are removed as a second lock.
revoke all on public.axis_connections from anon, authenticated;
revoke all on public.sync_runs from anon;
revoke insert, update, delete on public.sync_runs from authenticated;

-- The browser can see whether Axis is connected, but never the link itself.
create function public.axis_connection_status()
returns table (connected boolean, last_synced_at timestamptz, last_error text)
language sql stable security definer set search_path = '' as $$
  select true, c.last_synced_at, c.last_error from public.axis_connections c where c.user_id = auth.uid()
  union all
  select false, null, null where not exists (select 1 from public.axis_connections c where c.user_id = auth.uid());
$$;
revoke all on function public.axis_connection_status() from public, anon;
grant execute on function public.axis_connection_status() to authenticated;

create function public.disconnect_axis() returns void
language sql security definer set search_path = '' as $$
  delete from public.axis_connections where user_id = auth.uid();
$$;
revoke all on function public.disconnect_axis() from public, anon;
grant execute on function public.disconnect_axis() to authenticated;

-- Realtime keeps every signed-in device in sync.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.items, public.classes;
  end if;
end;
$$;
