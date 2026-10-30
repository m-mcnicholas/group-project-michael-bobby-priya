-- Re-sync every connected Axis feed every 4 hours by calling the axis-sync Edge Function.
-- Before this runs, store two Vault secrets in each project (see supabase/README.md):
--   project_url       e.g. https://<project-ref>.supabase.co
--   axis_cron_secret  a long random string, also set as the AXIS_CRON_SECRET function secret
-- Applying this to prod counts as a deployment and needs explicit approval.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'axis-sync-all',
  '17 */4 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/axis-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'axis_cron_secret')
    ),
    body := jsonb_build_object('mode', 'all'),
    timeout_milliseconds := 60000
  );
  $$
);
