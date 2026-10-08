-- ============================================================================
-- sql/105 — switch for Build 3 "Comment paging" (fb_comment_paging). Seeded OFF.
-- ============================================================================
-- NOT APPLIED. Independent of every other file. Only the exact string 'true' turns it on;
-- anything else = off, and the server reads one comments page per poll, as before. Server-only:
-- nothing in the app changes. Needs a Render deploy BEFORE the switch is turned on. An existing
-- row is left as it is. Rollback: sql/105_fb_comment_paging_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values ('fb_comment_paging', 'false')
on conflict (key) do nothing;
