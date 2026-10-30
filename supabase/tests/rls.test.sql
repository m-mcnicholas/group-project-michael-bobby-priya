-- Row-level security checks: user A can never read or change user B's rows,
-- and nobody but the service role can read an Axis feed link.
-- Runs in one transaction and rolls back. See supabase/tests/run-local.sh.
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@duckplan.test', '{"full_name":"Ann"}'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@duckplan.test', '{}');

do $$ begin
  assert (select display_name from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001') = 'Ann', 'profile trigger uses full_name';
  assert (select display_name from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002') = 'b', 'profile trigger falls back to email name';
end $$;

insert into public.classes (id, user_id, name) values
  ('aaaaaaaa-c000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'A class'),
  ('bbbbbbbb-c000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'B class');
insert into public.items (id, user_id, class_id, title) values
  ('aaaaaaaa-1000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-c000-4000-8000-000000000001', 'A item'),
  ('bbbbbbbb-1000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-c000-4000-8000-000000000002', 'B item');
insert into public.reminders (item_id) values ('bbbbbbbb-1000-4000-8000-000000000002');
insert into public.sync_runs (user_id, status) values ('bbbbbbbb-0000-4000-8000-000000000002', 'ok');
insert into public.axis_connections (user_id, ical_url) values ('aaaaaaaa-0000-4000-8000-000000000001', 'https://example.myschoolapp.com/podium/feed/iCal.aspx?z=secret');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';

do $$
declare changed integer;
begin
  assert (select count(*) from public.profiles) = 1, 'A sees only their own profile';
  assert (select count(*) from public.classes) = 1, 'A sees only their own classes';
  assert (select array_agg(title) from public.items) = array['A item'], 'A sees only their own items';
  assert (select count(*) from public.reminders) = 0, 'A cannot see B''s reminders';
  assert (select count(*) from public.sync_runs) = 0, 'A cannot see B''s sync runs';

  update public.items set title = 'hacked' where id = 'bbbbbbbb-1000-4000-8000-000000000002';
  get diagnostics changed = row_count;
  assert changed = 0, 'A cannot update B''s item';
  delete from public.classes where id = 'bbbbbbbb-c000-4000-8000-000000000002';
  get diagnostics changed = row_count;
  assert changed = 0, 'A cannot delete B''s class';

  begin
    insert into public.items (user_id, title) values ('bbbbbbbb-0000-4000-8000-000000000002', 'planted');
    raise exception 'A inserted a row owned by B';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.items (title, class_id) values ('points at B class', 'bbbbbbbb-c000-4000-8000-000000000002');
    raise exception 'A attached an item to B''s class';
  exception when foreign_key_violation then null;
  end;

  begin
    perform ical_url from public.axis_connections;
    raise exception 'A read the axis_connections table';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.sync_runs (user_id) values ('aaaaaaaa-0000-4000-8000-000000000001');
    raise exception 'A wrote a sync run';
  exception when insufficient_privilege then null;
  end;

  assert (select connected from public.axis_connection_status()) = true, 'A sees that Axis is connected';

  -- Defaults fill user_id from the session, and the completion timestamp is managed by the trigger.
  insert into public.items (id, title, completed) values ('aaaaaaaa-1000-4000-8000-000000000003', 'done already', true);
  assert (select completed_at is not null from public.items where id = 'aaaaaaaa-1000-4000-8000-000000000003'), 'completed_at set on insert';
  update public.items set title = 'renamed' where id = 'aaaaaaaa-1000-4000-8000-000000000003';
  assert (select completed_at is not null from public.items where id = 'aaaaaaaa-1000-4000-8000-000000000003'), 'completed_at kept on edit';
  update public.items set completed = false where id = 'aaaaaaaa-1000-4000-8000-000000000003';
  assert (select completed_at is null from public.items where id = 'aaaaaaaa-1000-4000-8000-000000000003'), 'completed_at cleared on reopen';
end $$;

set local request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
do $$ begin
  assert (select array_agg(title) from public.items) = array['B item'], 'B still has an untouched item';
  assert (select connected from public.axis_connection_status()) = false, 'B has no Axis connection';
  assert (select count(*) from public.reminders) = 1, 'B sees their own reminder';
end $$;

set local role anon;
do $$ begin
  assert (select count(*) from public.items) = 0, 'signed-out visitors see no items';
  assert (select count(*) from public.classes) = 0, 'signed-out visitors see no classes';
end $$;

reset role;
\echo 'rls.test.sql: all row-level security checks passed'
rollback;
