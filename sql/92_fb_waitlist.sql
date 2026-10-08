-- ============================================================================
-- sql/92 — fb_waitlist: Facebook sold-out comments waiting for a restock (F3).
-- ============================================================================
-- NOT APPLIED. Jeff applies via Supabase MCP after review. Needs sql/90 first (stock_movements).
-- One row per sold-out Facebook comment (unique per seller + comment id). Written by the
-- seller's app at the Auto-mode sold-out moment through fb_waitlist_join (returns the buyer's
-- place in line). Read / marked given or skipped from the Orders screen. Nothing here creates
-- an order: "Give" in the app uses the existing order path. Rows older than 10 days are purged
-- (01:50 Taipei), like live_session_orders.
-- RLS: own rows only (select / insert / update); no delete from the app.
-- Also: stock_movements gets the reason 'waitlist' (a piece handed out from the waitlist).
-- Rollback: sql/92_fb_waitlist_rollback.sql.
-- ============================================================================

create table if not exists public.fb_waitlist (
  id               bigserial primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  session_id       uuid,
  code             text not null,
  product_local_id bigint,
  comment_id       text not null,
  page_id          text not null,
  live_video_id    text,
  commenter_id     text,
  commenter_name   text not null default '',
  handle           text not null default '',
  created_at       timestamptz not null default now(),
  status           text not null default 'waiting',
  constraint fb_waitlist_status check (status in ('waiting', 'given', 'skipped')),
  constraint fb_waitlist_code_len check (char_length(code) between 1 and 40),
  constraint fb_waitlist_text_len check (char_length(comment_id) <= 80 and char_length(page_id) <= 40
    and char_length(commenter_name) <= 200 and char_length(handle) <= 200)
);
create unique index if not exists fb_waitlist_user_comment on public.fb_waitlist (user_id, comment_id);
create index if not exists fb_waitlist_user_session on public.fb_waitlist (user_id, session_id, code, created_at);

alter table public.fb_waitlist enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fb_waitlist' and policyname = 'fb_waitlist_select_own') then
    create policy fb_waitlist_select_own on public.fb_waitlist for select using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fb_waitlist' and policyname = 'fb_waitlist_insert_own') then
    create policy fb_waitlist_insert_own on public.fb_waitlist for insert with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fb_waitlist' and policyname = 'fb_waitlist_update_own') then
    create policy fb_waitlist_update_own on public.fb_waitlist for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.fb_waitlist from anon;
revoke all on public.fb_waitlist from authenticated;
grant select, insert on public.fb_waitlist to authenticated;
grant update (status) on public.fb_waitlist to authenticated;
grant usage on sequence public.fb_waitlist_id_seq to authenticated;

-- Join the line (idempotent per comment) → the place in line among this session's waiting rows
-- for the same code (1 = next). SECURITY INVOKER: RLS applies; everything is the caller's own.
create or replace function public.fb_waitlist_join(
  p_session_id       uuid,
  p_code             text,
  p_product_local_id bigint,
  p_comment_id       text,
  p_page_id          text,
  p_live_video_id    text,
  p_commenter_id     text,
  p_commenter_name   text,
  p_handle           text
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  insert into public.fb_waitlist (user_id, session_id, code, product_local_id, comment_id, page_id, live_video_id, commenter_id, commenter_name, handle)
  values ((select auth.uid()), p_session_id, btrim(p_code), p_product_local_id, p_comment_id, p_page_id, nullif(p_live_video_id, ''),
          nullif(p_commenter_id, ''), coalesce(p_commenter_name, ''), coalesce(p_handle, ''))
  on conflict (user_id, comment_id) do nothing;
  select created_at into v_at from public.fb_waitlist
   where user_id = (select auth.uid()) and comment_id = p_comment_id and status = 'waiting';
  if v_at is null then
    return null;
  end if;
  return (select count(*)::int from public.fb_waitlist w
           where w.user_id = (select auth.uid())
             and w.session_id is not distinct from p_session_id
             and lower(w.code) = lower(btrim(p_code))
             and w.status = 'waiting'
             and w.created_at <= v_at);
end;
$$;
revoke execute on function public.fb_waitlist_join(uuid, text, bigint, text, text, text, text, text, text) from public, anon;
grant  execute on function public.fb_waitlist_join(uuid, text, bigint, text, text, text, text, text, text) to authenticated;

select cron.schedule('purge-old-fb-waitlist', '50 17 * * *',
  $$delete from public.fb_waitlist where created_at < now() - interval '10 days'$$);

-- stock_movements (sql/90): add the reason 'waitlist'.
alter table public.stock_movements drop constraint stock_movements_reason;
alter table public.stock_movements add constraint stock_movements_reason
  check (reason in ('auto_order', 'oneclick', 'restock', 'manual_edit', 'waitlist'));
