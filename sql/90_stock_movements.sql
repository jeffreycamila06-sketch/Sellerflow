-- ============================================================================
-- sql/90 — stock_movements: a log of every stock change (F4 Inventory v2).
-- ============================================================================
-- NOT APPLIED. Jeff applies via Supabase MCP after review. Additive only.
-- Nothing here touches the order hub: Auto mode keeps decrementing with the LIVE
-- decrement_product_stock (inside useOrders, unchanged); the app writes an 'auto_order' log
-- row next to it. adjust_product_stock (sql/41) and decrement_product_stock are NOT changed.
--
-- stock_movements: one row per change. RLS: a seller reads and inserts only own rows; no
-- update / delete policy (the log cannot be edited from the app). Purged after 90 days
-- (pg_cron, 01:40 Taipei, same pattern as the other purges).
-- adjust_product_stock_logged / restock_product: SECURITY INVOKER (RLS applies), own row,
-- the same arithmetic as adjust_product_stock (stock = greatest(0, stock + delta), clamp at
-- 0, -1 when the product is not the caller's) — and they log the change that was really
-- applied, in the same transaction (a failed log insert rolls the stock change back).
-- The reason list is enforced by the table check (sql/92 adds 'waitlist').
-- Rollback: sql/90_stock_movements_rollback.sql.
-- ============================================================================

create table if not exists public.stock_movements (
  id               bigserial primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  product_local_id bigint not null,
  delta            int not null,
  reason           text not null,
  order_ref        text,
  created_at       timestamptz not null default now(),
  constraint stock_movements_reason check (reason in ('auto_order', 'oneclick', 'restock', 'manual_edit')),
  constraint stock_movements_order_ref_len check (order_ref is null or char_length(order_ref) <= 200)
);
create index if not exists stock_movements_user_product on public.stock_movements (user_id, product_local_id, created_at desc);

alter table public.stock_movements enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_movements' and policyname = 'stock_movements_select_own') then
    create policy stock_movements_select_own on public.stock_movements for select using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_movements' and policyname = 'stock_movements_insert_own') then
    create policy stock_movements_insert_own on public.stock_movements for insert with check (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.stock_movements from anon;
revoke all on public.stock_movements from authenticated;
grant select, insert on public.stock_movements to authenticated;
grant usage on sequence public.stock_movements_id_seq to authenticated;

create or replace function public.adjust_product_stock_logged(
  p_local_id  bigint,
  p_delta     int,
  p_reason    text,
  p_order_ref text default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old integer;
  v_new integer;
begin
  if p_delta is null or p_delta < -100000 or p_delta > 100000 then
    return -1;
  end if;
  select stock into v_old from public.products
   where user_id = (select auth.uid()) and local_id = p_local_id
   for update;
  if not found then
    return -1;
  end if;
  update public.products
     set stock = greatest(0, stock + p_delta),
         updated_at = now()
   where user_id = (select auth.uid()) and local_id = p_local_id
  returning stock into v_new;
  if v_new <> v_old then
    insert into public.stock_movements (user_id, product_local_id, delta, reason, order_ref)
    values ((select auth.uid()), p_local_id, v_new - v_old, p_reason, p_order_ref);
  end if;
  return v_new;
end;
$$;

create or replace function public.restock_product(p_local_id bigint, p_qty int)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    return -1;
  end if;
  return public.adjust_product_stock_logged(p_local_id, p_qty, 'restock', null);
end;
$$;

revoke execute on function public.adjust_product_stock_logged(bigint, int, text, text) from public, anon;
grant  execute on function public.adjust_product_stock_logged(bigint, int, text, text) to authenticated;
revoke execute on function public.restock_product(bigint, int) from public, anon;
grant  execute on function public.restock_product(bigint, int) to authenticated;

select cron.schedule('purge-old-stock-movements', '40 17 * * *',
  $$delete from public.stock_movements where created_at < now() - interval '90 days'$$);
