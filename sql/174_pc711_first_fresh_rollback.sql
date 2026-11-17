-- Rollback of sql/174: pc711_evidence_totals back to sql/172's text, word for word.
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
       'serverFirst', (select count(*) from e where mode = 'mirror' and first = 'server'),
       'extensionFirst', (select count(*) from e where mode = 'mirror' and first = 'extension'),
       'avgFirstByMs', (select round(avg(first_by_ms)) from e where mode = 'mirror' and first_by_ms is not null),
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
