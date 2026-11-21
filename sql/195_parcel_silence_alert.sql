-- ════════════════════════════════════════════════════════════════════════════
-- 195 — Telegram alert from the DATABASE when nobody is checking parcels (2026-11-21, Jeff: option A).
-- NOT APPLIED. chat-Claude applies it after Jeff's go. Rollback: 195_parcel_silence_alert_rollback.sql.
--
-- Covers "the Lenovo AND the server are both dead": Supabase itself sends the alert, independent of Render and the
-- Lenovo. Replaces the Claude scheduled task "SFL parcel checker silence alert" (turned off after Jeff's test).
--
-- THE RULE (checked every 10 minutes by pg_cron, at minutes 3, 13, 23, …):
--   waiting = parcels of sellers with the check (parcel_check_access.enabled) that are not exported, still miss a
--             phone or a store answer, and were saved 30 minutes to 2 days ago — the same parcels the checker's own
--             queue (admin_parcel_checks_pending) would hand out
--   answer  = the newest of: a live store answer (store_check_log), a phone answer (parcel_scans.phone_check_at — set
--             live or copied while a checker reads the queue), a frozen answer from a checker
--             (store_frozen_check_log, sources live / cache / warmup — NOT 'instant', the copy on save)
--   alert when waiting > 0 AND no answer in the last 30 minutes, never 01:00–05:00 Taipei (the checker's rest).
--   Repeat at most once per 60 minutes while it stays like that. "Back" only when a real answer arrives after the
--   alert (and only if an alert of that episode reached Telegram). A failed send is sent again at the next runs,
--   up to 3 tries, ending with " (sent again)" — as the server's alerts do.
--
-- SECRETS: Telegram's bot token + chat id are read from Supabase Vault (names telegram_bot_token, telegram_chat_id),
-- which JEFF creates himself. Missing or wrongly shaped → nothing is sent, one word in the log.
--   They are sent with the `http` extension (pgsql-http 1.6): ONE synchronous HTTPS request inside the run. The
--   address that holds the token exists only in that request — it is never written to a table, a log row, the state
--   row, a return value or a notice (pg_net would keep it in net.http_request_queue, a table its install script opens
--   to PUBLIC; on this project postgres cannot take that back — Jeff's choice 2026-11-21: http extension).
--   Every error inside the send is caught and turned into one fixed word; an error text is never stored.
--
-- TEST: select public.admin_parcel_silence_test();  — from the SQL editor (session user postgres) or by an app admin.
--   Answers one word at once: sent / no_secrets / bad_secrets / http_missing / http_<code> / timeout / net_error /
--   too_soon (one test a minute) / busy / forbidden.
--
-- OFF: select cron.unschedule('parcel-silence-alert');  — or delete the two Vault secrets. No app_settings change,
-- no server / Render / extension change.
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '2s';

create extension if not exists http with schema extensions;

do $guard$
begin
  if to_regprocedure('extensions.http(extensions.http_request)') is null then
    raise exception 'sql/195: the http extension is not in schema extensions — nothing was changed';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'sql/195: pg_cron is missing — nothing was changed';
  end if;
  if to_regclass('public.parcel_silence_state') is not null or to_regclass('public.parcel_silence_log') is not null then
    raise exception 'sql/195: parcel_silence tables already exist — nothing was changed';
  end if;
end
$guard$;

-- ── one-row state (no browser access at all) ───────────────────────────────
create table public.parcel_silence_state (
  id            boolean primary key default true check (id),
  open          boolean not null default false,   -- an alert episode is open
  opened_at     timestamptz,                      -- its first alert (an answer after it = "back")
  delivered     boolean not null default false,   -- an alert of this episode reached Telegram
  last_alert_at timestamptz,                      -- the 60-minute repeat clock
  retry_kind    text check (retry_kind in ('alert','repeat','back')),
  retry_text    text,                             -- the text to send again: counts and times only
  retry_try     smallint check (retry_try between 1 and 2),
  log_purged_on date,
  updated_at    timestamptz not null default now()
);
insert into public.parcel_silence_state (id) values (true);

-- ── the log: time, kind, counts, one result word (admins can read; nobody writes from the browser) ──
create table public.parcel_silence_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  kind       text not null check (kind in ('alert','repeat','back','test','error')),
  try        smallint not null default 1 check (try between 1 and 3),
  waiting    integer,
  sellers    integer,
  silent_min integer,
  result     text not null check (result ~ '^[a-z0-9_]{1,24}$')
);
create index parcel_silence_log_at_idx on public.parcel_silence_log (at);

alter table public.parcel_silence_state enable row level security;
alter table public.parcel_silence_log   enable row level security;
revoke all on public.parcel_silence_state from public, anon, authenticated, service_role;
revoke all on public.parcel_silence_log   from public, anon, authenticated, service_role;
revoke all on sequence public.parcel_silence_log_id_seq from public, anon, authenticated, service_role;
grant select on public.parcel_silence_log to authenticated;
create policy parcel_silence_log_admin_select on public.parcel_silence_log
  for select to authenticated using (public.is_admin());

-- ── ONE send: Vault → shape check → one synchronous HTTPS POST → one fixed word ──
-- SECURITY INVOKER and callable by nobody but its owner (postgres): the cron job and the test function only.
create or replace function public.parcel_silence_send(p_text text, p_timeout_ms integer)
returns text
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_token   text;
  v_chat    text;
  v_status  integer;
  v_content text;
  v_ok      boolean := false;
begin
  if to_regclass('vault.decrypted_secrets') is null then return 'no_secrets'; end if;
  begin
    select s.decrypted_secret into v_token from vault.decrypted_secrets s
     where s.name = 'telegram_bot_token' order by s.created_at desc limit 1;
    select s.decrypted_secret into v_chat from vault.decrypted_secrets s
     where s.name = 'telegram_chat_id' order by s.created_at desc limit 1;
  exception when others then
    return 'no_secrets';
  end;
  v_token := btrim(coalesce(v_token, ''));
  v_chat  := btrim(coalesce(v_chat, ''));
  if v_token = '' or v_chat = '' then return 'no_secrets'; end if;
  -- the same shapes the server accepts (server/telegramAlert.js)
  if v_token !~ '^[0-9]{3,20}:[A-Za-z0-9_-]{10,100}$' or v_chat !~ '^(-?[0-9]{1,20}|@[A-Za-z0-9_]{3,64})$' then
    return 'bad_secrets';
  end if;
  if to_regprocedure('extensions.http(extensions.http_request)') is null then return 'http_missing'; end if;
  begin
    perform set_config('http.timeout_msec', greatest(1000, least(coalesce(p_timeout_ms, 20000), 20000))::text, true);
    select r.status, r.content into v_status, v_content
      from extensions.http((
             'POST',
             'https://api.telegram.org/bot' || v_token || '/sendMessage',
             null,
             'application/json',
             jsonb_build_object('chat_id', v_chat, 'text', p_text, 'disable_web_page_preview', true)::text
           )::extensions.http_request) r;
  exception when others then
    -- the error text is only looked at here, never kept
    return case when sqlerrm ~* 'time[ds]? ?out|timeout' then 'timeout' else 'net_error' end;
  end;
  if v_status is null then return 'net_error'; end if;
  if v_status between 200 and 299 then
    begin
      v_ok := coalesce((v_content::jsonb ->> 'ok') = 'true', false);
    exception when others then
      v_ok := false;
    end;
    return case when v_ok then 'sent' else 'not_ok' end;
  end if;
  return 'http_' || least(greatest(v_status, 0), 999)::text;
end
$function$;

-- ── the check (pg_cron, every 10 minutes). p_now exists for the tests only; cron calls it without arguments ──
create or replace function public.parcel_silence_check(p_now timestamptz default now())
returns text
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  c_quiet   constant interval := interval '30 minutes';  -- no answer this long = nobody is checking
  c_young   constant interval := interval '30 minutes';  -- a parcel counts once it waited this long …
  c_old     constant interval := interval '2 days';      -- … and until it is this old
  c_repeat  constant interval := interval '60 minutes';
  c_tries   constant integer  := 3;
  c_send_ms constant integer  := 20000;                  -- = the server's 20 s
  c_again   constant text     := ' (sent again)';
  v_now     timestamptz := coalesce(p_now, now());
  st        public.parcel_silence_state;
  v_pool_n  integer := 0;
  v_waiting integer := 0;
  v_sellers integer := 0;
  v_last    timestamptz;
  v_min     integer;
  v_fire    boolean;
  v_kind    text;
  v_text    text;
  v_word    text;
  v_try     integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('parcel_silence_alert')) then return 'busy'; end if;
  begin
    insert into parcel_silence_state (id) values (true) on conflict (id) do nothing;
    select * into st from parcel_silence_state where id;

    -- the log keeps 30 days (cleared once a Taipei day, here — no other cron job)
    if st.log_purged_on is distinct from (v_now at time zone 'Asia/Taipei')::date then
      delete from parcel_silence_log where at < v_now - interval '30 days';
      update parcel_silence_state set log_purged_on = (v_now at time zone 'Asia/Taipei')::date, updated_at = v_now where id;
    end if;

    -- 01:00–05:00 Taipei: nothing is sent (a waiting retry is dropped, the episode stays as it is)
    if extract(hour from v_now at time zone 'Asia/Taipei')::int between 1 and 4 then
      if st.retry_kind is not null then
        insert into parcel_silence_log (at, kind, try, result) values (v_now, st.retry_kind, st.retry_try + 1, 'night_dropped');
        update parcel_silence_state set retry_kind = null, retry_text = null, retry_try = null, updated_at = v_now where id;
      end if;
      return 'night';
    end if;

    -- waiting parcels = what the checker's queue would hand out (the shared shop pool, else the seller's own shop)
    begin
      select count(*) into v_pool_n
        from jsonb_array_elements_text((select s.value::jsonb from app_settings s where s.key = 'parcel_check_shared_gms')) t(g)
       where t.g ~ '^GM[0-9]{6,20}$';
    exception when others then
      v_pool_n := 0;
    end;
    select count(*), count(distinct ps.user_id) into v_waiting, v_sellers
      from parcel_scans ps
      join parcel_check_access acc on acc.user_id = ps.user_id and acc.enabled
     where ps.status <> 'exported'
       and (ps.store_full_status is null or ps.phone_check_status is null)
       and ps.created_at <= v_now - c_young
       and ps.created_at >  v_now - c_old
       and (v_pool_n > 0 or exists (select 1 from seller_myship_config cfg
                                      where cfg.user_id = ps.user_id and coalesce(cfg.gm_id, '') <> ''));

    -- the newest answer from a checker
    select greatest(
             (select l.checked_at from store_check_log l where l.checked_at <= v_now order by l.id desc limit 1),
             (select max(p.phone_check_at) from parcel_scans p where p.phone_check_status is not null and p.phone_check_at <= v_now),
             (select f.checked_at from store_frozen_check_log f
               where f.source in ('live','cache','warmup') and f.checked_at <= v_now order by f.id desc limit 1))
      into v_last;
    v_min  := case when v_last is null then null else floor(extract(epoch from (v_now - v_last)) / 60)::int end;
    v_fire := v_waiting > 0 and (v_last is null or v_last < v_now - c_quiet);

    -- a failed send from an earlier run: sent again while it still holds, else dropped
    if st.retry_kind is not null then
      if (st.retry_kind in ('alert','repeat') and v_fire) or (st.retry_kind = 'back' and not v_fire) then
        v_try  := st.retry_try + 1;
        v_word := public.parcel_silence_send(st.retry_text || c_again, c_send_ms);
        insert into parcel_silence_log (at, kind, try, waiting, sellers, silent_min, result)
             values (v_now, st.retry_kind, v_try, v_waiting, v_sellers, v_min, v_word);
        if v_word = 'sent' and st.retry_kind in ('alert','repeat') then
          update parcel_silence_state set delivered = true where id;
        end if;
        if v_word = 'sent' or v_try >= c_tries
           or not (v_word in ('timeout','net_error','not_ok','http_429') or v_word ~ '^http_5[0-9][0-9]$') then
          update parcel_silence_state set retry_kind = null, retry_text = null, retry_try = null, updated_at = v_now where id;
        else
          update parcel_silence_state set retry_try = v_try, updated_at = v_now where id;
        end if;
        return 'retry_' || v_word;
      end if;
      insert into parcel_silence_log (at, kind, try, waiting, sellers, silent_min, result)
           values (v_now, st.retry_kind, st.retry_try + 1, v_waiting, v_sellers, v_min, 'dropped');
      update parcel_silence_state set retry_kind = null, retry_text = null, retry_try = null, updated_at = v_now where id;
    end if;

    if v_fire then
      if not st.open then
        v_kind := 'alert';
        update parcel_silence_state
           set open = true, opened_at = v_now, delivered = false, last_alert_at = v_now, updated_at = v_now where id;
      elsif st.last_alert_at is null or st.last_alert_at <= v_now - c_repeat then
        v_kind := 'repeat';
        update parcel_silence_state set last_alert_at = v_now, updated_at = v_now where id;
      else
        return 'alert_open';
      end if;
      v_text := format('⚠️ Walang nagche-check ng parcel nang %s min — %s parcels naghihintay (%s sellers). Tingnan ang Lenovo at ang server.',
                       coalesce(v_min::text, '30+'), v_waiting, v_sellers);
    elsif st.open then
      if v_last is null or v_last <= st.opened_at then
        return 'alert_open';                 -- nothing waits now, but no checker has answered since the alert
      end if;
      update parcel_silence_state
         set open = false, opened_at = null, delivered = false, last_alert_at = null, updated_at = v_now where id;
      if not st.delivered then
        return 'closed';                     -- the alert never reached Telegram: no "back" either
      end if;
      v_kind := 'back';
      v_text := '✅ May nagche-check na ulit.';
    else
      return 'quiet';
    end if;

    v_word := public.parcel_silence_send(v_text, c_send_ms);
    insert into parcel_silence_log (at, kind, try, waiting, sellers, silent_min, result)
         values (v_now, v_kind, 1, v_waiting, v_sellers, v_min, v_word);
    if v_word = 'sent' and v_kind in ('alert','repeat') then
      update parcel_silence_state set delivered = true where id;
    end if;
    if v_word <> 'sent' and (v_word in ('timeout','net_error','not_ok','http_429') or v_word ~ '^http_5[0-9][0-9]$') then
      update parcel_silence_state set retry_kind = v_kind, retry_text = v_text, retry_try = 1, updated_at = v_now where id;
    end if;
    return v_kind || '_' || v_word;
  exception when others then
    -- never an error text: one word
    insert into parcel_silence_log (at, kind, result) values (v_now, 'error', 'error');
    return 'error';
  end;
end
$function$;

-- ── the test: SQL editor (session user postgres) or an app admin; one try, one word ──
create or replace function public.admin_parcel_silence_test()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_pg   boolean := (session_user = 'postgres');
  v_word text;
begin
  if not v_pg then
    begin
      if not coalesce(public.is_admin(), false) then return 'forbidden'; end if;
    exception when others then
      return 'forbidden';
    end;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('parcel_silence_alert')) then return 'busy'; end if;
  begin
    if exists (select 1 from parcel_silence_log where kind = 'test' and at > now() - interval '1 minute') then
      return 'too_soon';
    end if;
    -- an app request may run 8 s at most (authenticated statement_timeout) → 6 s there, 20 s from the SQL editor
    v_word := public.parcel_silence_send('SellerFlowLive test alert (database). Alerts are working.',
                                         case when v_pg then 20000 else 6000 end);
    insert into parcel_silence_log (at, kind, result) values (now(), 'test', v_word);
    return v_word;
  exception when others then
    return 'error';
  end;
end
$function$;

revoke all on function public.parcel_silence_send(text, integer)      from public, anon, authenticated, service_role;
revoke all on function public.parcel_silence_check(timestamptz)       from public, anon, authenticated, service_role;
revoke all on function public.admin_parcel_silence_test()             from public, anon, service_role;
grant execute on function public.admin_parcel_silence_test() to authenticated;

select cron.schedule('parcel-silence-alert', '3-59/10 * * * *', 'select public.parcel_silence_check()');

commit;
