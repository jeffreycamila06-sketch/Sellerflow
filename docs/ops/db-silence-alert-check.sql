-- READ ONLY. Run on production right after applying sql/195 (and again after creating the two Vault secrets).
-- Every row should have ok = true. It reads catalog rows and names only — never a secret value.
--   1. nothing of pg_net exists, so anon / authenticated cannot read net.http_request_queue / net._http_response
--      (the tables do not exist at all)
--   2. the http extension is in schema extensions and postgres (the cron job) may run it
--   3. the two new tables and the check / send functions are closed to anon, authenticated and service_role;
--      authenticated may only call the test function (admins only inside) and read the log (admins only, RLS)
--   4. Vault is closed to anon / authenticated; the cron job is there
begin;
set local statement_timeout = '5s';
select check_name, value, expected, value = expected as ok
from (values
  ('pg_net installed',
     (select count(*) from pg_extension where extname = 'pg_net')::text, '0'),
  ('schema net exists',
     (select count(*) from pg_namespace where nspname = 'net')::text, '0'),
  ('anon can read net.http_request_queue',
     coalesce((select has_table_privilege('anon', c.oid, 'SELECT')::text from pg_class c where c.oid = to_regclass('net.http_request_queue')), 'no such table'), 'no such table'),
  ('authenticated can read net.http_request_queue',
     coalesce((select has_table_privilege('authenticated', c.oid, 'SELECT')::text from pg_class c where c.oid = to_regclass('net.http_request_queue')), 'no such table'), 'no such table'),
  ('anon can read net._http_response',
     coalesce((select has_table_privilege('anon', c.oid, 'SELECT')::text from pg_class c where c.oid = to_regclass('net._http_response')), 'no such table'), 'no such table'),
  ('authenticated can read net._http_response',
     coalesce((select has_table_privilege('authenticated', c.oid, 'SELECT')::text from pg_class c where c.oid = to_regclass('net._http_response')), 'no such table'), 'no such table'),
  ('http extension schema',
     coalesce((select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'http'), 'not installed'), 'extensions'),
  ('postgres can run extensions.http',
     coalesce((select has_function_privilege('postgres', p.oid, 'EXECUTE')::text from pg_proc p where p.oid = to_regprocedure('extensions.http(extensions.http_request)')), 'no such function'), 'true'),
  ('anon / authenticated / service_role can touch parcel_silence_state',
     (select bool_or(has_table_privilege(r, 'public.parcel_silence_state', w))
        from unnest(array['anon','authenticated','service_role']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) w)::text, 'false'),
  ('anon / service_role can read parcel_silence_log',
     (select bool_or(has_table_privilege(r, 'public.parcel_silence_log', 'SELECT')) from unnest(array['anon','service_role']) r)::text, 'false'),
  ('anon / authenticated / service_role can write parcel_silence_log',
     (select bool_or(has_table_privilege(r, 'public.parcel_silence_log', w))
        from unnest(array['anon','authenticated','service_role']) r, unnest(array['INSERT','UPDATE','DELETE']) w)::text, 'false'),
  ('row level security on both tables',
     (select bool_and(relrowsecurity) from pg_class where oid in ('public.parcel_silence_state'::regclass, 'public.parcel_silence_log'::regclass))::text, 'true'),
  ('anon / authenticated / service_role can run the check or the send',
     (select bool_or(has_function_privilege(r, f, 'EXECUTE'))
        from unnest(array['anon','authenticated','service_role']) r,
             unnest(array['public.parcel_silence_check(timestamp with time zone)','public.parcel_silence_send(text,integer)']) f)::text, 'false'),
  ('anon / service_role can run the test',
     (select bool_or(has_function_privilege(r, 'public.admin_parcel_silence_test()', 'EXECUTE')) from unnest(array['anon','service_role']) r)::text, 'false'),
  ('authenticated can call the test (admins only inside)',
     has_function_privilege('authenticated', 'public.admin_parcel_silence_test()', 'EXECUTE')::text, 'true'),
  ('anon / authenticated can use schema vault',
     (has_schema_privilege('anon', 'vault', 'USAGE') or has_schema_privilege('authenticated', 'vault', 'USAGE'))::text, 'false'),
  ('cron job',
     coalesce((select schedule || ' | ' || command || ' | active=' || active::text from cron.job where jobname = 'parcel-silence-alert'), 'missing'),
     '3-59/10 * * * * | select public.parcel_silence_check() | active=true'),
  ('Vault secret names present (before Jeff creates them: none)',
     (select coalesce(string_agg(name::text, ',' order by name), 'none') from vault.secrets where name in ('telegram_bot_token','telegram_chat_id')),
     'telegram_bot_token,telegram_chat_id')
) v(check_name, value, expected);
commit;

-- After Jeff's test (select public.admin_parcel_silence_test(); in the SQL editor) — the last log rows (words only):
-- select to_char(at at time zone 'Asia/Taipei', 'MM-DD HH24:MI') as taipei, kind, try, waiting, sellers, silent_min, result
--   from public.parcel_silence_log order by id desc limit 10;
