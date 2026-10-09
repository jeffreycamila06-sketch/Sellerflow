-- ============================================================================
-- sql/109 — switch for Builds 5 + 7 "Facebook polish" (fb_polish_v2). Seeded OFF.
-- ============================================================================
-- NOT APPLIED. Independent of every other file. Only the exact string 'true' turns it on;
-- anything else = off. App-only switch: it gates the app side of Build 5 (Authorize clarity)
-- and Build 7 (wording & receipts). The server parts of those builds are not switched (see
-- the report). An existing row is left as it is. Rollback: sql/109_fb_polish_v2_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values ('fb_polish_v2', 'false')
on conflict (key) do nothing;
