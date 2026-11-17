-- sql/174 — 7-11 server checker, Admin evidence totals: "who finished first" counts only pairs where the
-- extension's answer was FRESH (it really checked just now). A remembered answer can be hours old (one row
-- showed the extension "first" by 16 hours), so it never counts as a win; remembered pairs are shown as
-- their own count ('remembered'). Jeff 2026-11-17.
--
-- Changes ONE existing function, pc711_evidence_totals (create or replace, same signature, same reads —
-- the extra filters are on the rows already read for [p_from, p_to)). Live definition checked 2026-11-17
-- (read only): md5(prosrc) = 45013eef59f43a9bd09d3d287dc64d31 = sql/172's text. The server (pairPatch) also
-- stops writing a winner for a non-fresh pair from now on.
--
-- Rollback: sql/174_pc711_first_fresh_rollback.sql (sql/172's text, word for word).
create or replace function public.pc711_evidence_totals(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with e as (
    select * from public.pc711_shadow_evidence where at >= p_from and at < p_to
  ), g as (
    select mode, kind, coalesce(ext_source, 'unknown') as source,
           count(*) filter (where match is not null) as compared,
           count(*) filter (where match) as agree
      from e group by 1, 2, 3
  ), r as (
    select srv_verdict from public.pc711_shadow
     where kind = 'phone' and ext_verdict = 'restricted' and at >= p_from and at < p_to and match is not null
    union all
    select srv_verdict from e where kind = 'phone' and ext_verdict = 'restricted' and round > 1 and match is not null
  )
  select jsonb_build_object(
    'rows', (select count(*) from e),
    'pairs', coalesce((select jsonb_agg(jsonb_build_object('mode', mode, 'kind', kind, 'source', source, 'compared', compared, 'agree', agree)
                                         order by mode, kind, source) from g), '[]'::jsonb),
    'errors', jsonb_build_object('after', (select count(*) from e where mode = 'after' and fail_reason is not null),
                                 'mirror', (select count(*) from e where mode = 'mirror' and fail_reason is not null)),
    'rechecks', (select count(*) from e where round > 1),
    'flags', (select count(*) from e where flag is not null),
    'mirror', jsonb_build_object(
       'n', (select count(*) from e where mode = 'mirror'),
       'serverFirst', (select count(*) from e where mode = 'mirror' and first = 'server' and ext_source = 'fresh'),
       'extensionFirst', (select count(*) from e where mode = 'mirror' and first = 'extension' and ext_source = 'fresh'),
       'avgFirstByMs', (select round(avg(first_by_ms)) from e where mode = 'mirror' and first_by_ms is not null and ext_source = 'fresh'),
       'remembered', (select count(*) from e where mode = 'mirror' and ext_at is not null and ext_source = 'remembered'),
       'late', (select count(*) from e where ext_late),
       'timeout', (select count(*) from e where ext_timeout and ext_at is null)),
    'storeAge', jsonb_build_object(
       'n', (select count(*) from e where kind = 'store' and ext_age_s is not null),
       'avgS', (select round(avg(ext_age_s)) from e where kind = 'store' and ext_age_s is not null),
       'maxS', (select max(ext_age_s) from e where kind = 'store' and ext_age_s is not null)),
    'reasked', (select count(*) from e where reask_n > 0),
    'lastStop', (select to_jsonb(x) from (select at, rule, value, window_from, parcels from public.pc711_mirror_stops
                                           order by at desc limit 1) x),
    'restricted', jsonb_build_object('agree', (select count(*) from r where srv_verdict = 'restricted'),
                                     'disagree', (select count(*) from r where srv_verdict is distinct from 'restricted')));
$$;
revoke all on function public.pc711_evidence_totals(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.pc711_evidence_totals(timestamptz, timestamptz) to service_role;
