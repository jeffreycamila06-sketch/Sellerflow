-- sql/111 ROLLBACK — removes the index and the column (the callback then finds nothing).
drop index public.fb_pages_fb_user_id;
alter table public.fb_pages drop column fb_user_id;
