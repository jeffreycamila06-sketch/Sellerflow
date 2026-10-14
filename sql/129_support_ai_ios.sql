-- 129 — Help chat on iPhone: its own switch + the 'blocked' reason.
-- NOT APPLIED — chat-Claude applies it BEFORE the Render deploy of claude/helpbot-ios-safe
-- (the new server saves needs_admin = 'blocked'; without this the save fails).
-- Rollback: sql/129_support_ai_ios_rollback.sql.
--
-- 1) app_settings 'support_ai_ios' = 'false' — the help chat shows on iPhone only when this is
--    'true' (app: helpBotVisible; server: POST /support/ask answers 403 for platform 'ios'
--    otherwise). Fail closed: missing row / anything but 'true' = off. To switch on:
--      update public.app_settings set value = 'true', updated_at = now() where key = 'support_ai_ios';
-- 2) support_chats.needs_admin also allows 'blocked' — a question the bot does not answer
--    (how the app works inside, copying the app, bypassing platform rules, hidden instructions).
begin;
set local lock_timeout = '5s';

insert into public.app_settings (key, value) values ('support_ai_ios', 'false')
on conflict (key) do nothing;

alter table public.support_chats drop constraint support_chats_needs_admin_check;
alter table public.support_chats add constraint support_chats_needs_admin_check
  check (needs_admin in ('billing', 'not_covered', 'ai_error', 'blocked'));

commit;
