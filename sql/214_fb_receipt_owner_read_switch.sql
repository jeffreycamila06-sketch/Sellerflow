-- ============================================================================
-- sql/214 — Messenger receipts: the switch for the "who holds this buyer's chat" read (2026-11-24).
--
-- app_settings.fb_receipt_owner_read_enabled, created 'false' = exactly today: the server makes no
-- extra request to Facebook. Only the exact text 'true' turns it on (a missing row, any other text or
-- a failed read = off). When on, the server asks Facebook who holds the buyer's conversation ONLY
-- after a receipt was refused with error 10 / 2018300, and only logs the answer (app ids and counts).
-- A sent receipt and every other refusal never reach that code.
--
-- A row that already exists is left as it is (running this twice, or after the switch was set, changes
-- nothing). The server reads the switch at most once a minute, so a change needs no deploy.
--   on : update public.app_settings set value = 'true'  where key = 'fb_receipt_owner_read_enabled';
--   off: update public.app_settings set value = 'false' where key = 'fb_receipt_owner_read_enabled';
--
-- NOT APPLIED. Rollback: sql/214_fb_receipt_owner_read_switch_rollback.sql
-- ============================================================================
begin;

insert into public.app_settings (key, value) values ('fb_receipt_owner_read_enabled', 'false')
on conflict (key) do nothing;

commit;
