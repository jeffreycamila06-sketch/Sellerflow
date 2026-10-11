-- ============================================================================
-- sql/116 — Help bot (in-app help chat on the Settings screen). NOT APPLIED.
-- ============================================================================
-- Two tables + small RPCs. The server (POST /support/ask, service role) is the ONLY writer of
-- support_chats. No browser role can select either table. A seller sees only Admin's answers
-- to their own questions (support_admin_answers) and rates through support_rate(). Admin reads
-- and reviews through admin_support_* RPCs (each guarded by is_admin() inside the function).
--
-- Switches (app_settings — readable by every signed-in seller, so NO emails here):
--   support_ai_enabled          'false'  only the exact string 'true' turns the bot on
--   support_ai_monthly_cap_usd  '15'     all sellers together, Taipei calendar month
--   support_ai_daily_per_seller '20'     AI-answered questions per seller per Taipei day
--   support_guide_checked       '{}'     server-owned map {section_id: "last checked" date}
-- Preview list = feature_access_emails, feature 'support_ai_preview' (the sql/112 list; the
-- app and the server both read it; admins always pass). my_feature_access() gains the key.
--
-- pg_trgm lives in schema `extensions` in production (checked 2026-10-11, v1.6).
-- Rollback: sql/116_help_bot_rollback.sql.
-- ============================================================================

-- Normalized question text for matching (lowercase, punctuation → space, one space).
create function public.support_norm(t text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(t, '')),
    '[[:punct:]？！，。、：；「」『』（）【】～…]', ' ', 'g'), '\s+', ' ', 'g'));
$$;

create table public.support_faq (
  id             bigint generated always as identity primary key,
  question       text not null check (length(question) between 1 and 500),
  answer         text not null check (length(answer) between 1 and 4000),
  lang           text,
  guide_sections text[] not null default '{}',
  from_chat_id   uuid,
  enabled        boolean not null default true,
  needs_recheck  boolean not null default false,
  approved_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index support_faq_question_trgm on public.support_faq
  using gin (public.support_norm(question) extensions.gin_trgm_ops);

create table public.support_chats (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  question          text not null check (length(question) between 1 and 500),
  answer            text,
  source            text not null check (source in ('faq', 'faq_ai_match', 'ai', 'handoff', 'limit')),
  faq_id            bigint references public.support_faq(id) on delete set null,
  model             text,
  lang              text,
  guide_sections    text[] not null default '{}',
  tokens_in         integer not null default 0,
  tokens_out        integer not null default 0,
  cache_read_tokens integer not null default 0,
  cost_usd          numeric(12, 6) not null default 0,
  seller_rating     smallint not null default 0 check (seller_rating in (-1, 0, 1)),
  review_status     text not null default 'new' check (review_status in ('new', 'approved', 'edited', 'wrong')),
  review_note       text,
  -- Why this question needs an answer from Admin: 'billing' (handoff on billing/plan/refund/
  -- payment/account deletion), 'not_covered' (the guide doesn't cover it), 'ai_error'.
  needs_admin       text check (needs_admin in ('billing', 'not_covered', 'ai_error')),
  admin_answer      text check (admin_answer is null or length(admin_answer) between 1 and 4000),
  admin_answered_at timestamptz,
  admin_seen_at     timestamptz,
  created_at        timestamptz not null default now()
);
create index support_chats_user_created on public.support_chats (user_id, created_at desc);
create index support_chats_created on public.support_chats (created_at desc);
create index support_chats_faq on public.support_chats (faq_id) where faq_id is not null;

alter table public.support_faq
  add constraint support_faq_from_chat_fk foreign key (from_chat_id)
  references public.support_chats(id) on delete set null;

alter table public.support_chats enable row level security;
alter table public.support_faq enable row level security;
revoke all on public.support_chats from anon, authenticated;
revoke all on public.support_faq from anon, authenticated;
-- No grants and no policies for browser roles: nobody signed in reads or writes these tables
-- directly (model, cost and review notes stay out of sight). The server writes with the
-- service role; sellers use support_admin_answers / support_quick_questions / support_rate;
-- admins use the admin_support_* functions below.

-- ── seller ────────────────────────────────────────────────────────────────────
create function public.support_rate(p_chat_id uuid, p_rating smallint)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  with u as (
    update public.support_chats set seller_rating = p_rating
    where id = p_chat_id and user_id = auth.uid() and p_rating in (-1, 0, 1)
      and source in ('faq', 'faq_ai_match', 'ai')
    returning 1
  )
  select exists (select 1 from u);
$$;

-- "Admin answered:" — this seller's answered questions (own rows only), newest first.
create function public.support_admin_answers()
returns table (id uuid, question text, admin_answer text, admin_answered_at timestamptz, seen boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.question, c.admin_answer, c.admin_answered_at, c.admin_seen_at is not null
  from public.support_chats c
  where c.user_id = auth.uid() and c.admin_answer is not null
  order by c.admin_answered_at desc
  limit 20;
$$;

create function public.support_admin_answers_seen()
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  with u as (
    update public.support_chats set admin_seen_at = now()
    where user_id = auth.uid() and admin_answer is not null and admin_seen_at is null
    returning 1
  )
  select count(*)::integer from u;
$$;

-- Quick questions: the most-used enabled FAQ questions (same language first). Empty = the
-- app shows its fixed starter set.
create function public.support_quick_questions(p_lang text, p_limit integer default 6)
returns table (question text)
language sql
stable
security definer
set search_path = public
as $$
  select f.question
  from public.support_faq f
  left join lateral (select count(*) as hits from public.support_chats c where c.faq_id = f.id) h on true
  where f.enabled and not f.needs_recheck
  order by (f.lang is not distinct from p_lang) desc, h.hits desc, f.id desc
  limit least(greatest(coalesce(p_limit, 6), 1), 6);
$$;

-- ── server (service role only) ────────────────────────────────────────────────
-- Best enabled FAQ with trigram similarity ≥ 0.6 (uses the gin index through %).
create function public.support_faq_match(p_q text)
returns table (id bigint, question text, answer text, guide_sections text[], sim real)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  perform set_config('pg_trgm.similarity_threshold', '0.6', true);
  return query
    select f.id, f.question, f.answer, f.guide_sections,
           similarity(public.support_norm(f.question), public.support_norm(p_q))
    from public.support_faq f
    where f.enabled and not f.needs_recheck
      and public.support_norm(f.question) % public.support_norm(p_q)
    order by 5 desc, f.id
    limit 1;
end;
$$;

-- Usage: this seller's AI-answered questions today + everyone's spend this month (Taipei).
create function public.support_usage(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'day_count', (select count(*) from public.support_chats c
                  where c.user_id = p_user and c.source in ('faq_ai_match', 'ai')
                    and c.created_at >= (date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei')),
    'month_cost', (select coalesce(sum(c.cost_usd), 0) from public.support_chats c
                   where c.created_at >= (date_trunc('month', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei'))
  );
$$;

-- Guide "last checked" dates changed → linked FAQs need a recheck (they stop being served).
create function public.support_mark_recheck(p_sections text[])
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  with u as (
    update public.support_faq set needs_recheck = true
    where guide_sections && coalesce(p_sections, '{}') and not needs_recheck
    returning 1
  )
  select count(*)::integer from u;
$$;

-- ── admin ─────────────────────────────────────────────────────────────────────
create function public.admin_support_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz := date_trunc('month', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
  v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'total', count(*),
    'faq', count(*) filter (where source = 'faq'),
    'faq_ai_match', count(*) filter (where source = 'faq_ai_match'),
    'ai', count(*) filter (where source = 'ai'),
    'handoff', count(*) filter (where source = 'handoff'),
    'limit', count(*) filter (where source = 'limit'),
    'cost_usd', coalesce(sum(cost_usd), 0),
    'cap_usd', coalesce((select nullif(s.value, '')::numeric from public.app_settings s where s.key = 'support_ai_monthly_cap_usd'), 15),
    'saved', count(*) filter (where source in ('faq', 'faq_ai_match', 'ai') and needs_admin is null)
  ) into v
  from public.support_chats where created_at >= v_start;
  return v;
end;
$$;

-- Review queues, batches of 10, numbered by the app.
--   'approve' (Tab A): answered by the bot, not flagged, not 👎, not reviewed yet —
--                      seller 👍 first, then newest first.
--   'answer'  (Tab B): needs Admin (billing / not covered / AI error) or 👎, no Admin answer
--                      yet, not marked wrong — newest first.
create function public.admin_support_queue(p_tab text, p_offset integer default 0)
returns table (id uuid, question text, answer text, source text, needs_admin text,
               seller_rating smallint, lang text, created_at timestamptz, total bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_tab = 'approve' then
    return query
      select c.id, c.question, c.answer, c.source, c.needs_admin, c.seller_rating, c.lang, c.created_at, count(*) over ()
      from public.support_chats c
      where c.review_status = 'new' and c.source in ('faq', 'faq_ai_match', 'ai')
        and c.needs_admin is null and c.seller_rating >= 0 and coalesce(btrim(c.answer), '') <> ''
      order by c.seller_rating desc, c.created_at desc, c.id
      offset greatest(coalesce(p_offset, 0), 0) limit 10;
  elsif p_tab = 'answer' then
    return query
      select c.id, c.question, c.answer, c.source, c.needs_admin, c.seller_rating, c.lang, c.created_at, count(*) over ()
      from public.support_chats c
      where c.admin_answer is null and c.review_status <> 'wrong'
        and (c.needs_admin is not null or c.seller_rating = -1)
      order by c.created_at desc, c.id
      offset greatest(coalesce(p_offset, 0), 0) limit 10;
  else
    raise exception 'bad_tab';
  end if;
end;
$$;

-- Tab A "Approve batch". p_items = [{id, ok, save_faq, question?, answer?}].
--   ok=false → 'wrong'. ok=true → 'approved' ('edited' when a text was changed);
--   save_faq=true → a new FAQ entry (skipped for an unedited answer that already came from an
--   FAQ). Only rows still 'new' are touched. Returns how many rows were reviewed.
create function public.admin_support_approve_batch(p_items jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  it jsonb; c public.support_chats; n integer := 0;
  v_q text; v_a text; v_edited boolean;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into c from public.support_chats where id = (it->>'id')::uuid and review_status = 'new';
    if not found then continue; end if;
    if coalesce((it->>'ok')::boolean, true) = false then
      update public.support_chats set review_status = 'wrong' where id = c.id;
      n := n + 1; continue;
    end if;
    v_q := coalesce(nullif(btrim(it->>'question'), ''), c.question);
    v_a := coalesce(nullif(btrim(it->>'answer'), ''), c.answer);
    if coalesce(btrim(v_a), '') = '' then continue; end if;
    v_edited := v_q is distinct from c.question or v_a is distinct from c.answer;
    if coalesce((it->>'save_faq')::boolean, true) and (v_edited or c.source = 'ai') then
      insert into public.support_faq (question, answer, lang, guide_sections, from_chat_id, approved_at)
      values (left(v_q, 500), left(v_a, 4000), c.lang, c.guide_sections, c.id, now());
    end if;
    update public.support_chats set review_status = case when v_edited then 'edited' else 'approved' end
    where id = c.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Tab B "Save answers". p_items = [{id, answer, save_faq}]. Empty answer = skip. The answer is
-- shown to THAT seller in their chat ("Admin answered:"); save_faq=true also makes an FAQ.
create function public.admin_support_answer_batch(p_items jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare it jsonb; c public.support_chats; v_a text; n integer := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_a := left(btrim(coalesce(it->>'answer', '')), 4000);
    if v_a = '' then continue; end if;
    select * into c from public.support_chats where id = (it->>'id')::uuid and admin_answer is null;
    if not found then continue; end if;
    update public.support_chats
      set admin_answer = v_a, admin_answered_at = now(), admin_seen_at = null,
          review_status = case when review_status = 'new' then 'edited' else review_status end
      where id = c.id;
    if coalesce((it->>'save_faq')::boolean, false) then
      insert into public.support_faq (question, answer, lang, guide_sections, from_chat_id, approved_at)
      values (c.question, v_a, c.lang, c.guide_sections, c.id, now());
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- FAQ list for the Admin screen (no direct table access).
create function public.admin_support_faq_list()
returns table (id bigint, question text, answer text, enabled boolean, needs_recheck boolean, lang text, guide_sections text[])
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
    select f.id, f.question, f.answer, f.enabled, f.needs_recheck, f.lang, f.guide_sections
    from public.support_faq f order by f.id desc limit 500;
end;
$$;

-- FAQ edit / on-off. null = keep. Saving text clears needs_recheck (the admin re-checked it).
create function public.admin_support_faq_update(p_id bigint, p_question text, p_answer text, p_enabled boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.support_faq set
    question = coalesce(nullif(btrim(p_question), ''), question),
    answer = coalesce(nullif(btrim(p_answer), ''), answer),
    enabled = coalesce(p_enabled, enabled),
    needs_recheck = case when p_question is not null or p_answer is not null then false else needs_recheck end
  where id = p_id;
  return found;
end;
$$;

revoke all on function public.support_norm(text) from public;
revoke all on function public.support_rate(uuid, smallint) from public, anon;
revoke all on function public.support_quick_questions(text, integer) from public, anon;
revoke all on function public.support_faq_match(text) from public, anon, authenticated;
revoke all on function public.support_usage(uuid) from public, anon, authenticated;
revoke all on function public.support_mark_recheck(text[]) from public, anon, authenticated;
revoke all on function public.admin_support_stats() from public, anon;
revoke all on function public.admin_support_queue(text, integer) from public, anon;
revoke all on function public.admin_support_approve_batch(jsonb) from public, anon;
revoke all on function public.admin_support_answer_batch(jsonb) from public, anon;
revoke all on function public.support_admin_answers() from public, anon;
revoke all on function public.support_admin_answers_seen() from public, anon;
revoke all on function public.admin_support_faq_list() from public, anon;
revoke all on function public.admin_support_faq_update(bigint, text, text, boolean) from public, anon;
grant execute on function public.support_norm(text) to authenticated, service_role;
grant execute on function public.support_rate(uuid, smallint) to authenticated;
grant execute on function public.support_quick_questions(text, integer) to authenticated;
grant execute on function public.support_faq_match(text) to service_role;
grant execute on function public.support_usage(uuid) to service_role;
grant execute on function public.support_mark_recheck(text[]) to service_role;
grant execute on function public.admin_support_stats() to authenticated;
grant execute on function public.admin_support_queue(text, integer) to authenticated;
grant execute on function public.admin_support_approve_batch(jsonb) to authenticated;
grant execute on function public.admin_support_answer_batch(jsonb) to authenticated;
grant execute on function public.support_admin_answers() to authenticated;
grant execute on function public.support_admin_answers_seen() to authenticated;
grant execute on function public.admin_support_faq_list() to authenticated;
grant execute on function public.admin_support_faq_update(bigint, text, text, boolean) to authenticated;

-- ── switches + preview list ──────────────────────────────────────────────────
insert into public.app_settings (key, value) values
  ('support_ai_enabled', 'false'),
  ('support_ai_monthly_cap_usd', '15'),
  ('support_ai_daily_per_seller', '20'),
  ('support_guide_checked', '{}')
on conflict (key) do nothing;

insert into public.feature_access_emails (feature, email, is_prefix) values
  ('support_ai_preview', 'googletest@gmail.com', false),
  ('support_ai_preview', 'googletest@sellerflowlive.com', false)
on conflict do nothing;

-- my_feature_access(): same as sql/112 (production checked 2026-10-11) + 'support_ai_preview'.
create or replace function public.my_feature_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select lower(btrim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) as e
  ), keys(k) as (
    values ('fb_preview'), ('kiosk_launcher'), ('parcel_check'), ('parcel_cap_tester'), ('pin_print'), ('sticker_v2'), ('sticker_spacing'), ('session_v2'), ('session_numbering_fix'), ('shopee_preview'), ('live_source'), ('classic_text'), ('support_ai_preview')
  )
  select jsonb_object_agg(keys.k, exists (
    select 1 from public.feature_access_emails f, me
    where f.feature = keys.k
      and me.e <> ''
      and (me.e = f.email or (f.is_prefix and left(me.e, length(f.email)) = f.email))
  ))
  from keys;
$$;
