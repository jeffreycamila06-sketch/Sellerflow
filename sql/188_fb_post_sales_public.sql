-- ============================================================================
-- sql/188 — FACEBOOK POST SALES for every paid seller (Plus / Pro / Master)
-- ============================================================================
-- NOT APPLIED. Needs sql/137 (applied in production). Additive except the six function bodies
-- below (same signatures, CREATE OR REPLACE). One transaction. Rollback:
-- sql/188_fb_post_sales_public_rollback.sql (puts back the LIVE definitions, read 2026-11-20).
--
-- What it changes
--   1. ONE rule for who may sell on posts: fb_post_seller_allowed(uid) = admin, OR on the
--      'fb_post_sales' tester list, OR plan Plus / Pro / Master with plan_status 'active' and no
--      plan_expiry or one still in the future (the app's isActivePaid rule). Server only.
--      fb_post_sellers_allowed(uids[]) = the same rule for a list (the poller and the posts route).
--   2. fb_post_sale_create — the rule above instead of "admin or tester"; the end date: none sent
--      = 7 days, must be in the future, at most 14 days from now (up to 10 minutes over — a phone
--      clock running a little fast — is set to exactly 14 days; more is refused: 'ends_too_late').
--      Several "+1" posts may sell at the same time; a code-mode code stays unique among the
--      seller's OPEN code-mode sales. "Open" now also needs the end date not passed (a sale whose
--      end date passed no longer blocks its codes or a place in the 20, also before the poller
--      marks it ended). The 20-sale count moved after the per-seller lock (two taps at once can
--      no longer make 21).
--   3. fb_post_order_claim — a seller who no longer passes the rule gets 'not_allowed' (no order;
--      the poller leaves that comment for the next minute — see server/fbPostSales.js).
--      The end date is judged by the COMMENT's time (fix round 1): a comment written before the
--      end date becomes an order also when it is read later (the Page was live, a slow minute,
--      End now); a comment written after it is 'ended'. A comment time in the future counts as now.
--   4. fb_waitlist.sale_id — the post sale a waiting comment belongs to (set by the poller).
--      fb_post_waitlist_give gives from THAT sale (a row without sale_id: as before, the newest
--      selling sale with the code). Give also follows the rule ('not_allowed').
--   5. An OPEN sale longer than 14 days is cut to 14 days from its start (0 rows on 2026-11-20).
--      The old end dates are kept in fb_post_sales_ends_188 so the rollback puts them back.
--   6. Read-only after a plan ends (fix round 1): fb_post_orders_mark_printed,
--      fb_post_sale_item_update and fb_post_sale_end refuse ('not_allowed') a seller who does not
--      pass the rule. End now moves the end date to now and leaves the sale 'selling': the
--      poller reads the comments written before it, then marks the sale ended. Give no longer
--      gives from a sale whose end date passed (as when End now set 'ended' at once).
-- Nothing here touches live_session_orders, buyer numbers, orders, or the live Facebook path.
-- ============================================================================
begin;
set local lock_timeout = '5s';

-- ── 1. who may sell on posts ────────────────────────────────────────────────
create or replace function public.fb_post_seller_allowed(p_uid uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null and (
    exists (
      select 1 from public.seller_profiles p
       where p.auth_user_id = p_uid
         and (lower(btrim(coalesce(p.role, ''))) = 'admin'
              or (lower(btrim(coalesce(p.plan, ''))) in ('plus', 'pro', 'master')
                  and p.plan_status = 'active'
                  and (p.plan_expiry is null or p.plan_expiry > now())))
    )
    or exists (
      select 1 from auth.users u
        join public.feature_access_emails f on f.feature = 'fb_post_sales'
       where u.id = p_uid
         and lower(btrim(coalesce(u.email, ''))) <> ''
         and (lower(btrim(u.email)) = f.email or (f.is_prefix and left(lower(btrim(u.email)), length(f.email)) = f.email))
    )
  );
$$;
revoke all on function public.fb_post_seller_allowed(uuid) from public, anon, authenticated;
grant execute on function public.fb_post_seller_allowed(uuid) to service_role;

-- The same rule for a list of sellers → the ones allowed (the poller asks once a pass).
create or replace function public.fb_post_sellers_allowed(p_uids uuid[]) returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(x.u), '{}'::uuid[])
    from (select distinct u from unnest(coalesce(p_uids, '{}'::uuid[])) as t(u) where u is not null) x
   where public.fb_post_seller_allowed(x.u);
$$;
revoke all on function public.fb_post_sellers_allowed(uuid[]) from public, anon, authenticated;
grant execute on function public.fb_post_sellers_allowed(uuid[]) to service_role;

-- ── 2. create a post sale ───────────────────────────────────────────────────
create or replace function public.fb_post_sale_create(
  p_page_id text, p_post_id text, p_post_message text, p_post_picture text,
  p_mode text, p_ends_at timestamptz, p_items jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id bigint;
  v_item jsonb;
  v_code text;
  v_n int;
  v_ends timestamptz;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if coalesce((select a.value from public.app_settings a where a.key = 'fb_post_sales_enabled'), '') <> 'true' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- sql/188: admin, a 'fb_post_sales' tester, or an active Plus / Pro / Master plan
  if not public.fb_post_seller_allowed(v_uid) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fb_pages p where p.user_id = v_uid and p.page_id = p_page_id) then
    raise exception 'page_not_yours' using errcode = '42501';
  end if;
  if p_mode not in ('code', 'plus_one') then raise exception 'bad_mode'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'no_items'; end if;
  if p_mode = 'plus_one' and jsonb_array_length(p_items) <> 1 then raise exception 'plus_one_one_item'; end if;
  -- sql/188: the end date — none sent = 7 days; in the future; at most 14 days from now
  v_ends := coalesce(p_ends_at, now() + interval '7 days');
  if v_ends <= now() then raise exception 'ends_in_past'; end if;
  if v_ends > now() + interval '14 days' + interval '10 minutes' then raise exception 'ends_too_late'; end if;
  v_ends := least(v_ends, now() + interval '14 days');
  perform pg_advisory_xact_lock(hashtext('fb_post_sale_' || v_uid::text));
  if (select count(*) from public.fb_post_sales s
       where s.user_id = v_uid and s.status = 'selling' and s.ends_at > now()) >= 20 then
    raise exception 'too_many_sales';
  end if;
  -- a code stays unique among the seller's OPEN code-mode sales; "+1" sales never block each other
  if p_mode = 'code' then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_code := btrim(coalesce(v_item->>'code', ''));
      if v_code = '' then raise exception 'empty_code'; end if;
      select count(*) into v_n from public.fb_post_sale_items i join public.fb_post_sales s on s.id = i.sale_id
       where s.user_id = v_uid and s.status = 'selling' and s.ends_at > now() and s.mode = 'code'
         and lower(i.code) = lower(v_code);
      if v_n > 0 then raise exception 'code_in_use:%', v_code; end if;
    end loop;
  end if;
  insert into public.fb_post_sales (user_id, page_id, post_id, post_message, post_picture, mode, ends_at)
  values (v_uid, p_page_id, p_post_id, left(coalesce(p_post_message, ''), 300), nullif(p_post_picture, ''), p_mode, v_ends)
  returning id into v_id;
  insert into public.fb_post_sale_items (sale_id, product_id, name, code, price, stock)
  select v_id, nullif(x->>'product_id', '')::bigint, left(btrim(x->>'name'), 120),
         case when p_mode = 'plus_one' then '+1' else btrim(x->>'code') end,
         greatest(0, coalesce((x->>'price')::numeric, 0)), nullif(x->>'stock', '')::int
  from jsonb_array_elements(p_items) x;
  return v_id;
end;
$$;
revoke all on function public.fb_post_sale_create(text, text, text, text, text, timestamptz, jsonb) from public, anon;
grant execute on function public.fb_post_sale_create(text, text, text, text, text, timestamptz, jsonb) to authenticated;

-- ── 3. the atomic claim (server only) ───────────────────────────────────────
-- 'ordered' | 'dup' | 'sold_out' | 'ended' | 'not_allowed' (sql/188: the seller's plan).
create or replace function public.fb_post_order_claim(
  p_sale_id bigint, p_item_id bigint, p_buyer_fb_id text, p_buyer_name text,
  p_qty integer, p_comment_id text, p_comment_text text, p_created_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.fb_post_sales;
  v_item public.fb_post_sale_items;
  v_qty int := greatest(1, least(99, coalesce(p_qty, 1)));
  v_at timestamptz := least(coalesce(p_created_at, now()), now()); -- when the comment was written
begin
  select * into v_sale from public.fb_post_sales where id = p_sale_id;
  if v_sale.id is null or v_sale.status <> 'selling' or now() < v_sale.starts_at or v_at > v_sale.ends_at then return 'ended'; end if;
  if not public.fb_post_seller_allowed(v_sale.user_id) then return 'not_allowed'; end if;
  if exists (select 1 from public.fb_post_orders where comment_id = p_comment_id) then return 'dup'; end if;
  select * into v_item from public.fb_post_sale_items where id = p_item_id and sale_id = p_sale_id for update;
  if v_item.id is null then return 'ended'; end if;
  if coalesce(p_buyer_fb_id, '') <> '' and exists (select 1 from public.fb_post_orders where item_id = p_item_id and buyer_fb_id = p_buyer_fb_id) then
    return 'dup';
  end if;
  if v_item.stock is not null and v_item.stock - v_item.sold < v_qty then return 'sold_out'; end if;
  insert into public.fb_post_orders (user_id, sale_id, item_id, buyer_fb_id, buyer_name, qty, price, comment_id, comment_text, created_at)
  values (v_sale.user_id, p_sale_id, p_item_id, coalesce(p_buyer_fb_id, ''), left(coalesce(p_buyer_name, ''), 200), v_qty, v_item.price,
          p_comment_id, left(coalesce(p_comment_text, ''), 500), coalesce(p_created_at, now()));
  update public.fb_post_sale_items set sold = sold + v_qty where id = p_item_id;
  return 'ordered';
exception when unique_violation then
  return 'dup';
end;
$$;
revoke all on function public.fb_post_order_claim(bigint, bigint, text, text, integer, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.fb_post_order_claim(bigint, bigint, text, text, integer, text, text, timestamptz) to service_role;

-- ── 4. the waiting line knows its post ──────────────────────────────────────
alter table public.fb_waitlist add column if not exists sale_id bigint references public.fb_post_sales(id) on delete set null;
alter table public.fb_waitlist drop constraint if exists fb_waitlist_sale_post;
alter table public.fb_waitlist add constraint fb_waitlist_sale_post check (sale_id is null or source = 'post');
create index if not exists fb_waitlist_sale on public.fb_waitlist (sale_id) where sale_id is not null;

-- Give: from the waiting comment's OWN sale (sale_id); a row without one = the newest selling sale
-- with the code, as before. 'ordered' | 'sold_out' | 'ended' | 'not_found' | 'dup' | 'not_allowed'.
create or replace function public.fb_post_waitlist_give(p_waitlist_id bigint) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  w public.fb_waitlist;
  v_item public.fb_post_sale_items;
  v_sale public.fb_post_sales;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select * into w from public.fb_waitlist where id = p_waitlist_id and user_id = v_uid and status = 'waiting' and source = 'post';
  if w.id is null then return 'not_found'; end if;
  if not public.fb_post_seller_allowed(v_uid) then return 'not_allowed'; end if;
  if w.sale_id is not null then
    select i.* into v_item from public.fb_post_sale_items i join public.fb_post_sales s on s.id = i.sale_id
     where s.id = w.sale_id and s.user_id = v_uid and s.status = 'selling' and s.ends_at > now() and lower(i.code) = lower(w.code)
     order by i.id limit 1 for update of i;
  else
    select i.* into v_item from public.fb_post_sale_items i join public.fb_post_sales s on s.id = i.sale_id
     where s.user_id = v_uid and s.status = 'selling' and s.ends_at > now() and lower(i.code) = lower(w.code)
     order by s.created_at desc limit 1 for update of i;
  end if;
  if v_item.id is null then return 'ended'; end if;
  select * into v_sale from public.fb_post_sales where id = v_item.sale_id;
  if exists (select 1 from public.fb_post_orders where comment_id = w.comment_id) then
    update public.fb_waitlist set status = 'given' where id = w.id;
    return 'dup';
  end if;
  if v_item.stock is not null and v_item.stock - v_item.sold < 1 then return 'sold_out'; end if;
  insert into public.fb_post_orders (user_id, sale_id, item_id, buyer_fb_id, buyer_name, qty, price, comment_id, comment_text, created_at)
  values (v_uid, v_sale.id, v_item.id, coalesce(w.commenter_id, ''), left(coalesce(w.commenter_name, w.handle, ''), 200), 1, v_item.price,
          w.comment_id, w.code, now());
  update public.fb_post_sale_items set sold = sold + 1 where id = v_item.id;
  update public.fb_waitlist set status = 'given' where id = w.id;
  return 'ordered';
exception when unique_violation then
  return 'dup';
end;
$$;
revoke all on function public.fb_post_waitlist_give(bigint) from public, anon;
grant execute on function public.fb_post_waitlist_give(bigint) to authenticated;

-- ── 5. open sales longer than 14 days → 14 days from their start ────────────
create table if not exists public.fb_post_sales_ends_188 (
  sale_id      bigint primary key,
  old_ends_at  timestamptz not null,
  capped_at    timestamptz not null default now()
);
alter table public.fb_post_sales_ends_188 enable row level security;
revoke all on public.fb_post_sales_ends_188 from anon, authenticated;
insert into public.fb_post_sales_ends_188 (sale_id, old_ends_at)
  select s.id, s.ends_at from public.fb_post_sales s
   where s.status = 'selling' and s.ends_at > s.starts_at + interval '14 days'
  on conflict (sale_id) do nothing;
update public.fb_post_sales s set ends_at = s.starts_at + interval '14 days'
 where s.status = 'selling' and s.ends_at > s.starts_at + interval '14 days';

-- ── 6. read-only after a plan ends ──────────────────────────────────────────
-- Print new marks the printed orders; refused without the plan (the app hides the button).
create or replace function public.fb_post_orders_mark_printed(p_ids bigint[]) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if not public.fb_post_seller_allowed(auth.uid()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.fb_post_orders set printed_at = now()
   where id = any(p_ids) and user_id = auth.uid() and printed_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.fb_post_orders_mark_printed(bigint[]) from public, anon;
grant execute on function public.fb_post_orders_mark_printed(bigint[]) to authenticated;

-- Edit price / stock of an item; refused without the plan.
create or replace function public.fb_post_sale_item_update(p_item_id bigint, p_price numeric, p_stock integer) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_ok boolean;
begin
  if auth.uid() is null then return null; end if;
  if not public.fb_post_seller_allowed(auth.uid()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.fb_post_sale_items i set price = greatest(0, p_price), stock = case when p_stock is null then null else greatest(0, p_stock) end
   where i.id = p_item_id
     and exists (select 1 from public.fb_post_sales s where s.id = i.sale_id and s.user_id = auth.uid())
  returning true into v_ok;
  return v_ok;
end;
$$;
revoke all on function public.fb_post_sale_item_update(bigint, numeric, integer) from public, anon;
grant execute on function public.fb_post_sale_item_update(bigint, numeric, integer) to authenticated;

-- End now: the end date becomes now; the sale stays 'selling' until the poller has read the
-- comments written before it (then it marks it ended). Refused without the plan.
create or replace function public.fb_post_sale_end(p_sale_id bigint) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_ok boolean;
begin
  if auth.uid() is null then return null; end if;
  if not public.fb_post_seller_allowed(auth.uid()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.fb_post_sales set ends_at = least(ends_at, now())
   where id = p_sale_id and user_id = auth.uid() and status = 'selling'
  returning true into v_ok;
  return v_ok;
end;
$$;
revoke all on function public.fb_post_sale_end(bigint) from public, anon;
grant execute on function public.fb_post_sale_end(bigint) to authenticated;

commit;
