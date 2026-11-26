-- 223 rollback — drops the three admin functions of sql/223. No row of fb_receipt_access is
-- touched (rows the admin added or removed with them stay as they are).
begin;
drop function if exists public.admin_receipt_addon_note(uuid, text);
drop function if exists public.admin_receipt_addon_set(text, boolean, text);
drop function if exists public.admin_receipt_addon_list();
commit;
