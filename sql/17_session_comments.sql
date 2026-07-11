-- 17 — COMMENT PERSISTENCE (Chotdon-parity session history)
-- Table + RLS + restore RPC + window-close purge cron (expected jobid 5).
-- ⚠️ Apply via Supabase MCP (chat-Claude). This repo copy is the doc MIRROR.
--
-- Design (final spec, 2026-07-11):
--   • One row = ONE FLUSHED BATCH of ≤100 comments as a compact jsonb
--     {v:1, t:[[platform, sourceUsername, sessionId, handle, timestamp,
--     comment, name, isBuy(0/1), time], ...]} — batch-blob keeps storage AND
--     read egress ~3× cheaper than per-comment rows (audit §1.2).
--   • session_key = the client's sessionKeyFor(...) bucket (SAME format the
--     shipping feature uses): "YYYY-MM-DD" for 1-day sessions, or
--     "YYYY-MM-DD~Nd" (N ∈ 1..3) for an active multi-day window.
--   • RETENTION (Jeff decision): comments live only while their session
--     window is OPEN; the daily cron deletes every CLOSED window outright.
--   • RESTORE (audit F1 — structural 500 cap): reads go through the RPC
--     below, which flattens batches and returns EXACTLY the newest ≤500
--     tuples SERVER-SIDE. Egress per app open is therefore a fixed ~≤100KB,
--     fully decoupled from comment volume; no client refactor can un-cap it.
--   • Rows are IMMUTABLE to clients: select/insert own ONLY — no update, no
--     delete policy (RLS enabled + absent policy = denied). The purge cron
--     runs as postgres (BYPASSRLS), the verified jobid-1 pattern.
--   • Duplicates (dual-device sellers / resend-after-kill) are TOLERATED in
--     storage and collapsed at read time by commentKey dedup on the client.

-- ── A. table ─────────────────────────────────────────────────────────────────
create table public.session_comment_batches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  session_key   text not null,
  comments      jsonb not null,          -- {v:1, t:[ ...tuples ]}  (≤100 tuples)
  comment_count smallint not null,
  created_at    timestamptz not null default now()
);

create index scb_read_idx
  on public.session_comment_batches (user_id, session_key, created_at desc);

-- ── B. RLS — select/insert own ONLY (immutable rows; no update/delete) ───────
alter table public.session_comment_batches enable row level security;

create policy scb_select on public.session_comment_batches
  for select using (user_id = (select auth.uid()));

create policy scb_insert on public.session_comment_batches
  for insert with check (user_id = (select auth.uid()));

-- ── C. restore RPC — the STRUCTURAL 500-comment cap (audit F1) ───────────────
-- SECURITY INVOKER + explicit auth.uid() filter (miners_stats pattern): RLS
-- already scopes rows, the explicit filter is belt-and-braces. Scans only the
-- newest 30 batches (≤3,000 tuples), orders the flattened tuples by their
-- embedded ISO timestamp (tuple index 4 — ISO-8601 sorts lexicographically),
-- and returns EXACTLY the newest ≤500. Result = one jsonb array, newest first.
create or replace function public.session_comments_restore(p_session_key text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(z.tuple order by z.ts desc), '[]'::jsonb)
  from (
    select e.tuple, e.tuple->>4 as ts
    from (
      select jsonb_array_elements(b.comments->'t') as tuple
      from public.session_comment_batches b
      where b.user_id = (select auth.uid())
        and b.session_key = p_session_key
      order by b.created_at desc
      limit 30
    ) e
    order by e.tuple->>4 desc
    limit 500
  ) z;
$$;

revoke execute on function public.session_comments_restore(text) from public, anon;
grant execute on function public.session_comments_restore(text) to authenticated;

-- ── D. window-close purge cron (expected jobid 5) ────────────────────────────
-- Jeff decision: retention = SESSION WINDOW ONLY → on window close, TOTAL
-- delete (no archive, no 4-day horizon). Daily 17:00 UTC = 01:00 Taipei (one
-- hour after the midnight window boundary — same slot family as jobids 1-4;
-- runs as postgres so RLS is bypassed, the verified jobid-1 pattern).
--   • "YYYY-MM-DD" keys        → closed when key_date < today(Taipei).
--   • "YYYY-MM-DD~Nd" keys     → closed when start + N ≤ today(Taipei)
--     (mirrors computeWindowState: expired when daysBetween(start,today) ≥ N;
--     N is a single digit 1..3 — MUST track the client clampWindowDays max,
--     contract-tested in commentHistorySql.test.ts).
--   • malformed keys (safety net) → age out at 5 days (> max 3-day window, so
--     it can never touch a live window either).
-- CASE branches are evaluated lazily per row, so the ::date casts only run on
-- rows whose regex already guarantees the format.
select cron.schedule(
  'purge-closed-session-comments',
  '0 17 * * *',
  $$
  DELETE FROM public.session_comment_batches
  WHERE CASE
    WHEN session_key ~ '^\d{4}-\d{2}-\d{2}$'
      THEN session_key::date < (now() AT TIME ZONE 'Asia/Taipei')::date
    WHEN session_key ~ '^\d{4}-\d{2}-\d{2}~[1-3]d$'
      THEN split_part(session_key, '~', 1)::date
           + left(split_part(session_key, '~', 2), 1)::int
           <= (now() AT TIME ZONE 'Asia/Taipei')::date
    ELSE created_at < now() - interval '5 days'
  END
  $$
);

-- Verify after apply:
--   SELECT jobid, jobname, schedule FROM cron.job ORDER BY jobid;   -- expect jobid 5
--   SELECT * FROM pg_policies WHERE tablename = 'session_comment_batches';
--   -- expect scb_select + scb_insert ONLY (no update/delete policy)
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'session_comments_restore';
--   -- prosecdef = false (SECURITY INVOKER)
-- Rollback:
--   SELECT cron.unschedule('purge-closed-session-comments');
--   DROP FUNCTION public.session_comments_restore(text);
--   DROP TABLE public.session_comment_batches;
