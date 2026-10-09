-- sql/105 ROLLBACK — removes the switch row (the server then treats it as off).
delete from public.app_settings where key = 'fb_comment_paging';
