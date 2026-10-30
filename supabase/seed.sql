-- Local/dev sample data: the planner's demo classes and tasks for one demo user.
-- `supabase db reset` runs this after the migrations. Never run it against prod.
-- Sign in locally as demo@duckplan.test with a magic link (local emails appear in Inbucket/Mailpit).

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000000',
  'd0c0d0c0-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'demo@duckplan.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Duck"}', now(), now()
)
on conflict (id) do nothing;

insert into public.classes (id, user_id, name, teacher, period, color, code) values
  ('c1a55000-0000-4000-8000-000000000001', 'd0c0d0c0-0000-4000-8000-000000000001', 'Calculus', 'Ms. Nguyen', 'Period 2', '#538fc5', 'M'),
  ('c1a55000-0000-4000-8000-000000000002', 'd0c0d0c0-0000-4000-8000-000000000001', 'English', 'Mr. Ramirez', 'Period 4', '#d96f63', 'E'),
  ('c1a55000-0000-4000-8000-000000000003', 'd0c0d0c0-0000-4000-8000-000000000001', 'Physics', 'Dr. Shah', 'Period 5', '#7d6fbd', 'P'),
  ('c1a55000-0000-4000-8000-000000000004', 'd0c0d0c0-0000-4000-8000-000000000001', 'Computer Science', 'Ms. Chen', 'Period 7', '#3e946d', 'CS'),
  ('c1a55000-0000-4000-8000-000000000005', 'd0c0d0c0-0000-4000-8000-000000000001', 'Personal', 'Personal', 'Anytime', '#c48b34', '★')
on conflict (id) do nothing;

insert into public.items (id, user_id, class_id, type, title, priority, due_date, due_time, scheduled_start, duration_minutes, completed) values
  ('17e00000-0000-4000-8000-000000000001', 'd0c0d0c0-0000-4000-8000-000000000001', 'c1a55000-0000-4000-8000-000000000001', 'task', 'Finish calculus practice set', 'high', current_date, '17:00', current_date + time '15:30', 60, false),
  ('17e00000-0000-4000-8000-000000000002', 'd0c0d0c0-0000-4000-8000-000000000001', 'c1a55000-0000-4000-8000-000000000002', 'task', 'Submit reading response', 'medium', current_date, '20:00', null, 45, false),
  ('17e00000-0000-4000-8000-000000000003', 'd0c0d0c0-0000-4000-8000-000000000001', 'c1a55000-0000-4000-8000-000000000003', 'task', 'Organize lab notes', 'medium', current_date + 1, '09:00', (current_date + 1) + time '07:45', 45, false),
  ('17e00000-0000-4000-8000-000000000004', 'd0c0d0c0-0000-4000-8000-000000000001', 'c1a55000-0000-4000-8000-000000000004', 'task', 'Review app wireframe', 'low', current_date + 2, '14:15', (current_date + 1) + time '16:00', 60, false),
  ('17e00000-0000-4000-8000-000000000005', 'd0c0d0c0-0000-4000-8000-000000000001', 'c1a55000-0000-4000-8000-000000000002', 'task', 'Study vocabulary cards', 'medium', current_date + 3, '16:00', null, 30, false),
  ('17e00000-0000-4000-8000-000000000006', 'd0c0d0c0-0000-4000-8000-000000000001', 'c1a55000-0000-4000-8000-000000000003', 'test', 'Complete motion quiz', 'high', current_date - 1, '12:30', null, 45, false),
  ('17e00000-0000-4000-8000-000000000007', 'd0c0d0c0-0000-4000-8000-000000000001', 'c1a55000-0000-4000-8000-000000000005', 'task', 'Pack materials for Monday', 'low', current_date, '20:00', null, 30, true)
on conflict (id) do nothing;
