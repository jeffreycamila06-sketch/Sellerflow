-- Rollback of sql/188 — puts back the three functions EXACTLY as they are live (read 2026-11-20 with
-- pg_get_functiondef; md5 fb_post_sale_create 852273a1…, fb_post_order_claim 4849c8e4…,
-- fb_post_waitlist_give d1c09d91… — checked by scripts/sql188-behaviour.mjs), puts back the end
-- date of every sale sql/188 cut to 14 days, and removes everything sql/188 added (the two rule
-- functions, fb_waitlist.sale_id, the note table). One transaction.
begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fb_post_sale_create(p_page_id text, p_post_id text, p_post_message text, p_post_picture text, p_mode text, p_ends_at timestamp with time zone, p_items jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id bigint;
  v_item jsonb;
  v_code text;
  v_n int;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if coalesce((select a.value from public.app_settings a where a.key = 'fb_post_sales_enabled'), '') <> 'true' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not (public.is_admin() or coalesce((public.my_feature_access()->>'fb_post_sales')::boolean, false)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fb_pages p where p.user_id = v_uid and p.page_id = p_page_id) then
    raise exception 'page_not_yours' using errcode = '42501';
  end if;
  if p_mode not in ('code', 'plus_one') then raise exception 'bad_mode'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'no_items'; end if;
  if p_mode = 'plus_one' and jsonb_array_length(p_items) <> 1 then raise exception 'plus_one_one_item'; end if;
  if (select count(*) from public.fb_post_sales s where s.user_id = v_uid and s.status = 'selling') >= 20 then
    raise exception 'too_many_sales';
  end if;
  perform pg_advisory_xact_lock(hashtext('fb_post_sale_' || v_uid::text));
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_code := case when p_mode = 'plus_one' then '+1' else btrim(coalesce(v_item->>'code', '')) end;
    if v_code = '' then raise exception 'empty_code'; end if;
    select count(*) into v_n from public.fb_post_sale_items i join public.fb_post_sales s on s.id = i.sale_id
     where s.user_id = v_uid and s.status = 'selling' and lower(i.code) = lower(v_code);
    if v_n > 0 then raise exception 'code_in_use:%', v_code; end if;
  end loop;
  insert into public.fb_post_sales (user_id, page_id, post_id, post_message, post_picture, mode, ends_at)
  values (v_uid, p_page_id, p_post_id, left(coalesce(p_post_message, ''), 300), nullif(p_post_picture, ''), p_mode,
          coalesce(p_ends_at, now() + interval '7 days'))
  returning id into v_id;
  insert into public.fb_post_sale_items (sale_id, product_id, name, code, price, stock)
  select v_id, nullif(x->>'product_id', '')::bigint, left(btrim(x->>'name'), 120),
         case when p_mode = 'plus_one' then '+1' else btrim(x->>'code') end,
         greatest(0, coalesce((x->>'price')::numeric, 0)), nullif(x->>'stock', '')::int
  from jsonb_array_elements(p_items) x;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fb_post_order_claim(p_sale_id bigint, p_item_id bigint, p_buyer_fb_id text, p_buyer_name text, p_qty integer, p_comment_id text, p_comment_text text, p_created_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sale public.fb_post_sales;
  v_item public.fb_post_sale_items;
  v_qty int := greatest(1, least(99, coalesce(p_qty, 1)));
begin
  select * into v_sale from public.fb_post_sales where id = p_sale_id;
  if v_sale.id is null or v_sale.status <> 'selling' or now() < v_sale.starts_at or now() > v_sale.ends_at then return 'ended'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.fb_post_waitlist_give(p_waitlist_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  w public.fb_waitlist;
  v_item public.fb_post_sale_items;
  v_sale public.fb_post_sales;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select * into w from public.fb_waitlist where id = p_waitlist_id and user_id = v_uid and status = 'waiting' and source = 'post';
  if w.id is null then return 'not_found'; end if;
  select i.* into v_item from public.fb_post_sale_items i join public.fb_post_sales s on s.id = i.sale_id
   where s.user_id = v_uid and s.status = 'selling' and lower(i.code) = lower(w.code)
   order by s.created_at desc limit 1 for update of i;
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
$function$;

-- the end dates sql/188 cut (only while the sale still has the date sql/188 gave it)
update public.fb_post_sales s set ends_at = n.old_ends_at
  from public.fb_post_sales_ends_188 n
 where s.id = n.sale_id and s.ends_at = s.starts_at + interval '14 days';
drop table if exists public.fb_post_sales_ends_188;

drop index if exists public.fb_waitlist_sale;
alter table public.fb_waitlist drop constraint if exists fb_waitlist_sale_post;
alter table public.fb_waitlist drop column if exists sale_id;

drop function if exists public.fb_post_sellers_allowed(uuid[]);
drop function if exists public.fb_post_seller_allowed(uuid);

commit;
