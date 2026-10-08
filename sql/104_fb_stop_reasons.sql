-- ============================================================================
-- sql/104 — switch for Build 2 "Stop reasons" (fb_stop_reasons). Seeded OFF.
-- ============================================================================
-- NOT APPLIED. Independent of every other file. Only the exact string 'true' turns it on;
-- anything else = off. Off: the app shows nothing new, and the server makes no extra Facebook
-- call and queues no extra automatic receipt (it does send the stop reason on the status — an
-- extra field old app versions ignore). The server half needs a Render deploy BEFORE the switch
-- is turned on. An existing row is left as it is. Rollback: sql/104_fb_stop_reasons_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values ('fb_stop_reasons', 'false')
on conflict (key) do nothing;
