-- 18 — ORDERABLE EARLIER COMMENTS: per-order TikTok message id.
-- ⚠️ Apply via Supabase MCP (chat-Claude). This repo copy is the doc MIRROR.
--
-- Purpose (final spec 2026-07-12): restored/initial ("Earlier comments") rows
-- are now ORDERABLE; the duplicate protection moves from "no buttons" to a
-- DB-BACKED ordered-check. The ONLY identity stable across a comment's live
-- copy and its later initial/restored copy is TikTok's per-message msgId
-- (commentKey is server-stamped → differs per relay — the F4/clientfix lesson).
-- Orders now store the source comment's msgId; at restore, comments whose
-- msgId matches a loaded window order render "Ordered ✓" with no buttons.
--
-- Additive + nullable:
--   • old rows / rollback-app writes / FB / synthetic comments → NULL → never
--     matched → the restored copy stays orderable (the SAFE failure direction:
--     a button too many is seller-judgment; a hidden button breaks the feature).
--   • existing RLS policies are column-agnostic (no new policy needed);
--     the A2 session_date trigger and the billing `orders` ledger are UNTOUCHED.
--   • no index: matching is client-side against the already-loaded window rows
--     (zero new queries — the Set rides the existing one-read-per-open load).

alter table public.live_session_orders
  add column comment_msg_id text null;

-- Verify after apply:
--   SELECT column_name, is_nullable FROM information_schema.columns
--   WHERE table_name = 'live_session_orders' AND column_name = 'comment_msg_id';
-- Rollback:
--   ALTER TABLE public.live_session_orders DROP COLUMN comment_msg_id;
