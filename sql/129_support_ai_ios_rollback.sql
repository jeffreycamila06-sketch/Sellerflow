-- Rollback of 129 — removes the support_ai_ios switch (the app and server then treat the help
-- chat on iPhone as off) and puts back the three-value needs_admin check. Rows already saved as
-- 'blocked' become 'not_covered' first so the old check can be added.
-- Roll back the server (Render) BEFORE this, or new 'blocked' rows fail to save.
begin;
set local lock_timeout = '5s';

delete from public.app_settings where key = 'support_ai_ios';

update public.support_chats set needs_admin = 'not_covered' where needs_admin = 'blocked';
alter table public.support_chats drop constraint support_chats_needs_admin_check;
alter table public.support_chats add constraint support_chats_needs_admin_check
  check (needs_admin in ('billing', 'not_covered', 'ai_error'));

commit;
