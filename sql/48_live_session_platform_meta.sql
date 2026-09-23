-- 48_live_session_platform_meta.sql
-- Additive, nullable platform metadata on live_session_orders — persists the IDs a future
-- Facebook Messenger Private Reply receipt needs to target an order's source comment.
-- APPLIED via Supabase MCP (chat/Claude Code); this file is the repo MIRROR.
--
-- WHAT: platform_meta jsonb NULL. Facebook orders write { "page_id": "...",
--   "live_video_id": "..." }; every other platform writes NULL. The comment id itself
--   stays in its OWN column (comment_msg_id, sql/18) — it is the dedup key
--   (ux_lso_user_msgid) and the Private Reply `recipient.comment_id`.
-- WHY page_id: a Private Reply is sent via /{page-id}/messages with that page's token.
--   The comment id's prefix is the POST/VIDEO object id, not the page id, and a seller can
--   authorize up to 5 pages (plan cap) — so the page must be stored, not derived.
-- WHY jsonb (not a page_id column): Shopee receipts will later need shop_id / session ids;
--   one column covers every platform with no further migration.
--
-- SAFETY:
--   • No backfill — existing rows stay NULL (only 4 FB orders existed at apply time).
--   • live_session_orders is NOT the billing ledger (public.orders is — untouched).
--   • authenticated holds a TABLE-level INSERT grant (verified) → the new column is
--     insertable with no grant change; RLS (user_id = auth.uid()) is column-agnostic.
--   • Covered by the existing 10-day retention purge (pg_cron jobid 1) — Private Replies
--     are only allowed within 7 days of the comment, so every eligible order keeps it.
--   • ⚠️ APPLY ORDER: this column must exist BEFORE the client that writes platform_meta
--     ships (PostgREST rejects an insert naming an unknown column → the FB session write
--     would fail). Then NOTIFY pgrst so the schema cache sees it.

alter table public.live_session_orders
  add column if not exists platform_meta jsonb;

notify pgrst, 'reload schema';
