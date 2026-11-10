-- FROZEN WARM-UP 1.18.1 — post-deploy checks. READ-ONLY. Run in the Supabase SQL editor (or MCP execute_sql).
-- Both queries need `set statement_timeout` ≥ 50 s and finish in a few seconds (the CTEs are MATERIALIZED on
-- purpose — without it Postgres re-runs `wrong` for every row and the query times out).
--
-- ── WHAT THE TWO NUMBERS MEAN ─────────────────────────────────────────────────────────────────────────────
-- Q1 "first dry answer": for every parcel the dry lane really checked live, seconds from created_at to the
--    first store_check_log entry for its store. Left out:
--      · cached rows — the store had an answer inside its cache life before the row (open 10 min, full 1 h,
--        not_found / company 1 day), or the row's store_full_at is older than the row itself;
--      · wrong-code rows — a not_found / company answer for a code no parcel uses, within 15 s of the row
--        (the seller typed a wrong code first; the later answer is for the code they fixed it to).
--    ⚠️ A store EDITED later (no wrong-code answer logged) cannot be seen in the database — such a row shows
--    a long wait. Look at the rows over 10 min by hand before blaming the checker.
-- Q2 "warm-up sent while a real parcel waited": warm-up answers (store_frozen_check_log source='warmup')
--    logged while a Q1 row (waiting ≤ 10 min) had been waiting ≥ 13 s and had no answer yet. MUST be 0
--    after 1.18.1. The exact counter is in the extension console: every warm-up send logs
--      [PC-WARMUP] warm-up send store=<id> queue=<n> read=<ms>ms gaveUp=<n>
--    and every line must say queue=0 gaveUp=0 (filter the service-worker console by "warm-up send").
--
-- BASELINE (1.18.0, measured 2026-11-10 on production):
--   Q1 per Taipei day Nov 3–10: p50 3.4–3.9 s, p95 5.6–9.1 s, 0–14 rows > 20 s, 0–8 rows > 60 s.
--   Q2: Nov 9 = 1 of 1,090 warm-ups, Nov 10 = 1 of 952 (before the wrong-code filter: 16 pairs in 2 days,
--       all wrong code first → fixed 1.5–3 min later).
set statement_timeout = '50s';

-- ── Q1: first dry answer per day ──────────────────────────────────────────────────────────────────────────
with rows as materialized (
  select p.id, p.store_id, p.created_at, p.store_full_at from public.parcel_scans p
   where p.created_at >= now() - interval '7 days'
     and p.store_full_status in ('open','full','not_found','company') and p.store_id ~ '^\d{6}$'
     and p.store_full_at >= p.created_at - interval '2 seconds'          -- not filled from the cache at insert
), used as materialized (select distinct store_id from public.parcel_scans where created_at >= now() - interval '8 days'),
wrong as materialized (
  select l.checked_at from public.store_check_log l
   where l.checked_at >= now() - interval '7 days 1 minute' and l.status in ('not_found','company')
     and not exists (select 1 from used u where u.store_id = l.store_id)
), fa as materialized (
  select r.*, least(a.ans_at, r.store_full_at) ans_at from rows r
  left join lateral (select l.checked_at ans_at from public.store_check_log l
                      where l.store_id = r.store_id and l.checked_at >= r.created_at - interval '2 seconds'
                      order by l.checked_at limit 1) a on true
  where not exists (select 1 from public.store_check_log l where l.store_id = r.store_id
                       and l.checked_at < r.created_at - interval '2 seconds'
                       and l.checked_at >= r.created_at - case l.status when 'open' then interval '10 minutes'
                                                                        when 'full' then interval '1 hour' else interval '1 day' end)
    and not exists (select 1 from wrong w where w.checked_at between r.created_at - interval '2 seconds' and r.created_at + interval '15 seconds')
)
select (created_at at time zone 'Asia/Taipei')::date tpe_day, count(*) live_rows,
  count(*) filter (where ans_at - created_at > interval '20 seconds') slow_20s,
  count(*) filter (where ans_at - created_at > interval '60 seconds') slow_60s,
  count(*) filter (where ans_at - created_at > interval '10 minutes') over_10min_look_by_hand,
  round((percentile_cont(0.5)  within group (order by extract(epoch from ans_at - created_at)))::numeric, 1) p50_s,
  round((percentile_cont(0.95) within group (order by extract(epoch from ans_at - created_at)))::numeric, 1) p95_s
from fa group by 1 order by 1;

-- ── Q2: warm-up sent while a real parcel waited (must be 0) ───────────────────────────────────────────────
with rows as materialized (
  select p.id, p.store_id, p.created_at, p.store_full_at from public.parcel_scans p
   where p.created_at >= now() - interval '7 days'
     and p.store_full_status in ('open','full','not_found','company') and p.store_id ~ '^\d{6}$'
     and p.store_full_at >= p.created_at - interval '2 seconds'
), used as materialized (select distinct store_id from public.parcel_scans where created_at >= now() - interval '8 days'),
wrong as materialized (
  select l.checked_at from public.store_check_log l
   where l.checked_at >= now() - interval '7 days 1 minute' and l.status in ('not_found','company')
     and not exists (select 1 from used u where u.store_id = l.store_id)
), fa as materialized (
  select r.*, least(a.ans_at, r.store_full_at) ans_at from rows r
  left join lateral (select l.checked_at ans_at from public.store_check_log l
                      where l.store_id = r.store_id and l.checked_at >= r.created_at - interval '2 seconds'
                      order by l.checked_at limit 1) a on true
  where not exists (select 1 from public.store_check_log l where l.store_id = r.store_id
                       and l.checked_at < r.created_at - interval '2 seconds'
                       and l.checked_at >= r.created_at - case l.status when 'open' then interval '10 minutes'
                                                                        when 'full' then interval '1 hour' else interval '1 day' end)
    and not exists (select 1 from wrong w where w.checked_at between r.created_at - interval '2 seconds' and r.created_at + interval '15 seconds')
), warm as materialized (
  select checked_at, (checked_at at time zone 'Asia/Taipei')::date d from public.store_frozen_check_log
   where source = 'warmup' and checked_at >= now() - interval '7 days'
)
select w.d tpe_day, count(*) warmups,
  count(*) filter (where exists (select 1 from fa where fa.ans_at - fa.created_at <= interval '10 minutes'
                                   and fa.created_at <= w.checked_at - interval '13 seconds' and fa.ans_at > w.checked_at)) sent_while_waiting
from warm w group by 1 order by 1;

-- ── Q3: given-up rows right now (what gate (a) reads; = sql/147 admin_parcel_gave_up_count) ───────────────
select count(*) gave_up_waiting_for_requeue from public.parcel_scans
 where store_full_status = 'unknown' and status <> 'exported' and created_at >= now() - interval '6 hours';
