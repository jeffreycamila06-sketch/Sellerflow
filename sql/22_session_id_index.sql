-- 22 — EXPLICIT SESSION MODEL: index for the session_id feed load (sub-step 3).
-- ⚠️ Apply via Supabase MCP (chat-Claude). This repo copy is the doc MIRROR.
-- ⚠️ DB index only — NOT server.js/Render, NOT an RPC. The feed-load-by-session_id
--    is a client-side own-scoped SELECT; this index just makes it fast.
--
-- Depends on sql/20 (session_id column) being applied.
--
-- Purpose: sub-step 3 loads the current session's rows with
--   WHERE user_id = auth.uid() AND session_id = <current_session_id>
-- (see loadLiveSessionBySessionId, useSessionWindow.ts). This composite index
-- serves that predicate directly. Without it the query still works (RLS already
-- scopes to the user's rows and Postgres filters session_id in memory) — this is
-- a PERFORMANCE improvement, not a correctness requirement, so the client is
-- correct before it is applied.
--
-- SAFETY: CREATE INDEX CONCURRENTLY does NOT take a write-blocking lock, so it is
-- safe to run on the live 30k-row table with sellers active (it builds without
-- an ACCESS EXCLUSIVE lock; it just takes longer). IF NOT EXISTS makes re-running
-- a no-op. Additive — touches no rows, no numbering, no existing index.
-- ⚠️ CONCURRENTLY cannot run inside a transaction block — apply it as a single
--    standalone statement (not wrapped in BEGIN/COMMIT).

create index concurrently if not exists idx_lso_user_session
  on public.live_session_orders (user_id, session_id);

-- Verify after apply:
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE tablename = 'live_session_orders' AND indexname = 'idx_lso_user_session';
--   -- confirm it is VALID (a failed CONCURRENTLY build leaves an invalid index):
--   SELECT c.relname, i.indisvalid FROM pg_class c
--   JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE c.relname = 'idx_lso_user_session';   -- indisvalid = true
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_lso_user_session;
