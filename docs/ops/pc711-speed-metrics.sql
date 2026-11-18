-- 7-11 server checker — speed numbers BEFORE / AFTER the deploy of claude/pc711-speed-keepalive.
-- Read-only. Every query returns counts, medians and words only — no phone, name, store number.
-- Replace :from with the deploy time (UTC). Baseline = 2026-11-18 04:13 → 09:42 UTC (12:13 → 17:42 Taipei).
--
-- Baseline to compare with:
--   Q1  server 5.1 s between two answers in a row (extension 2.3 s)  → work per parcel 3.1 s (extension 0.3 s)
--   Q2  store.byid  ~230 ms when the last request to E-Map was < 4 s before, ~1,070 ms after 4–60 s
--       phone.token ~390 ms / ~950 ms; "other" (the settings read) ~500–600 ms inside a phone check
--   Q3  parcels seen still waiting: store 4.1 s, phone 6.2 s (extension 4.2 / 4.3 s);
--       phone "read → check starts" 2.1 s; store end → phone start 0.24 s (0.48 s for an already-answered parcel)
--   Q4  pc711_session.last_ok_at: did not move between two E-Map opens

-- Q1. time between two answers in a row, same pass (2 s of it is the rest after a parcel)
with x as (
  select distinct scan_id, ext_at from pc711_shadow_evidence
  where at >= :from and kind = 'phone' and ext_source = 'fresh' and ext_at is not null and round = 1
), d as (select extract(epoch from (ext_at - lag(ext_at) over (order by ext_at))) gap from x),
s as (
  select distinct scan_id, srv_finished_at fin from pc711_shadow_evidence where at >= :from and kind = 'phone' and round = 1
), ds as (select extract(epoch from (fin - lag(fin) over (order by fin))) gap from s)
select 'extension' who, count(*) n, round((percentile_cont(0.5) within group (order by gap))::numeric, 2) median_s from d where gap between 1.5 and 6.5
union all
select 'server', count(*), round((percentile_cont(0.5) within group (order by gap))::numeric, 2) from ds where gap between 1.5 and 9.5;

-- Q2. does 7-11 leave the connection open? each check's own time, by the time since the last request to that host.
--     Kept open  → the "4-15s" and "15-60s" lines drop to about the "<4s" line.  Not kept → no change.
with e as (
  select kind, srv_started_at, srv_finished_at,
    (select (s->>'ms')::int from jsonb_array_elements(steps) s where s->>'s' = 'store.byid' limit 1) byid_ms,
    (select (s->>'ms')::int from jsonb_array_elements(steps) s where s->>'s' = 'phone.token' order by (s->>'ok') desc limit 1) token_ms,
    (select (s->>'ms')::int from jsonb_array_elements(steps) s where s->>'s' = 'phone.validate' limit 1) validate_ms,
    extract(epoch from (srv_finished_at - srv_started_at)) * 1000 total_ms
  from pc711_shadow_evidence where at >= :from and kind in ('store', 'phone') and fail_reason is null
), g as (
  select *, extract(epoch from (srv_started_at - lag(srv_finished_at) over (partition by kind order by srv_started_at))) gap from e
)
select kind,
  case when gap < 4 then 'a <4s' when gap < 15 then 'b 4-15s' when gap < 50 then 'c 15-50s' when gap < 120 then 'd 50-120s' else 'e >120s' end since_last_request,
  count(*) n,
  round((percentile_cont(0.5) within group (order by byid_ms))::numeric) store_byid_ms,
  round((percentile_cont(0.5) within group (order by token_ms))::numeric) phone_token_ms,
  round((percentile_cont(0.5) within group (order by validate_ms))::numeric) phone_validate_ms,
  round((percentile_cont(0.5) within group (order by total_ms - coalesce(token_ms, 0) - coalesce(validate_ms, 0) - coalesce(byid_ms, 0)))::numeric) other_ms
from g where gap is not null group by 1, 2 order by 1, 2;

-- Q3. parcels the server saw still waiting: where the seconds go
select kind, count(*) n,
  round((percentile_cont(0.5) within group (order by extract(epoch from (seen_waiting_at - parcel_created_at))))::numeric, 1) save_to_read_s,
  round((percentile_cont(0.5) within group (order by extract(epoch from (srv_started_at - seen_waiting_at))))::numeric, 1) read_to_start_s,
  round((percentile_cont(0.5) within group (order by extract(epoch from (srv_finished_at - srv_started_at))))::numeric, 1) check_s,
  round((percentile_cont(0.5) within group (order by extract(epoch from (srv_finished_at - parcel_created_at))))::numeric, 1) save_to_server_answer_s,
  round((percentile_cont(0.5) within group (order by extract(epoch from (ext_at - parcel_created_at))))::numeric, 1) save_to_extension_answer_s
from pc711_shadow_evidence
where at >= :from and mode = 'mirror' and round = 1 and ext_source = 'fresh' and kind in ('store', 'phone')
group by kind;
-- … and the wait of the phone half behind the store half of the same parcel (was 0.24 s / 0.48 s; now about 0)
select p.mode, count(*) n,
  round((percentile_cont(0.5) within group (order by extract(epoch from (p.srv_started_at - s.srv_finished_at))))::numeric, 2) store_end_to_phone_start_s
from pc711_shadow_evidence p join pc711_shadow_evidence s on s.scan_id = p.scan_id and s.kind = 'store' and s.mode = p.mode
where p.at >= :from and p.kind = 'phone' and p.round = 1 and s.round = 1
  and abs(extract(epoch from (p.srv_started_at - s.srv_finished_at))) < 5
group by p.mode;

-- Q4. the saved 賣貨便 login: state and times only (never the stored login itself)
select state, since, last_ok_at, auto_logins, last_quick_at, quick_day_count, last_problem,
       round(extract(epoch from (now() - last_ok_at)) / 60) minutes_since_last_use
from pc711_session;
