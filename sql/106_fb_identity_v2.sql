-- ============================================================================
-- sql/106 — switch for Build 4 "Facebook identity v2" (fb_identity_v2). Seeded OFF.
-- ============================================================================
-- NOT APPLIED. Independent of every other file. Only the exact string 'true' turns it on;
-- anything else = off. Server: a Facebook buyer is keyed by the commenter's id (not the display
-- name) for every poller STARTED while it is on; a poller keeps its mode until it stops. App: the
-- buyer tag matches a Facebook buyer by id first, then by name (needs sql/108 for the ids).
-- Needs a Render deploy BEFORE the switch is turned on. An existing row is left as it is.
-- Rollback: sql/106_fb_identity_v2_rollback.sql.
-- ============================================================================
insert into public.app_settings (key, value) values ('fb_identity_v2', 'false')
on conflict (key) do nothing;
