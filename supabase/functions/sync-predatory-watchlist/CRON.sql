-- Daily refresh of predatory_watchlist. NOT a migration.
--
-- Apply this yourself in the Supabase SQL editor only after:
--   1. migration 014_predatory_watchlist.sql has been applied
--   2. `supabase functions deploy sync-predatory-watchlist` has succeeded
--
-- Configure the Vault entries referenced below before scheduling the job.
-- Dashboard alternative: Edge Functions → sync-predatory-watchlist → Schedules,
-- cron `0 6 * * *`, POST to the function URL.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-predatory-watchlist') THEN
    PERFORM cron.unschedule('sync-predatory-watchlist');
  END IF;
END $$;

SELECT cron.schedule(
  'sync-predatory-watchlist',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/sync-predatory-watchlist',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        COALESCE(
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'function_token'),
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
        )
      )
    ),
    body := '{"reason":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);