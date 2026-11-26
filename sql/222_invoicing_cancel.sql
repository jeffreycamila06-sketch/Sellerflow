-- 222 — INVOICING: "Buyer cancelled" + cancel one item from the invoice (Jeff, 2026-11-26).
-- NOT APPLIED by the repo — apply by hand (chat-Claude / Jeff). Rollback: sql/222_invoicing_cancel_rollback.sql.
-- Needs sql/220 (live). Proof: scripts/sql222-behaviour.mjs (PGlite). No Render deploy.
-- Either order with the web is safe: before this file a "Buyer cancelled" or a cancelled line is refused by the
-- database → the app shows it, counts it in "N not saved yet" and tries again; nothing else changes.
--
-- WHAT IT CHANGES (no order row, no buyer number, no setting is touched):
--   invoice_sends.status            may also be 'cancelled' (the check: sent | skipped | cancelled).
--   invoice_sends_stamp()           = sql/220's text + ONE rule: a 'cancelled' row keeps the time the buyer
--                                   was sent before the cancel; "Undo cancel" back to 'sent' gives it back.
--   public.invoice_line_cancels     NEW: one row per order line the seller cancelled from an invoice —
--                                   seller + session + platform + the ORDER'S DATABASE ID
--                                   (live_session_orders.id). No name, no username, no item text, no price.
--                                   No link to live_session_orders (no foreign key: that table is cleaned
--                                   after its session, and this file must not lock or depend on it).
--                                   RLS = invoice_sends' shape: a seller reads / adds / changes / deletes ONLY
--                                   own rows; a visitor has no access.
--   privacy_retention_purge()       = sql/220's text + ONE more loop: invoice_line_cancels rows go 3 months
--                                   after they were made (the nightly job itself is not touched).
-- WHY A TABLE, NOT A COLUMN: an array of ids on invoice_sends would need read-change-write, so two phones
-- cancelling two different lines at once would overwrite each other. One row per line = one insert to
-- cancel, one delete to undo — nothing to merge.
begin;
set local lock_timeout = '3s';

-- ── 0) the live texts this file replaces (a = live 2026-11-26 = sql/220, b = this file) ───────────────
do $guard$
begin
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'invoice_sends_stamp'
                    and md5(p.prosrc) in ('a9e642e42589c52860aa2c6d3695361e', '9c9174b63a3ad3a313b84dee6f98011d')) then
    raise exception 'sql/222: public.invoice_sends_stamp is not the text this file was made from — nothing was changed';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'privacy_retention_purge'
                    and md5(p.prosrc) in ('be07f0fefb29068fe43482ed5babd71b', '365b824b8f2c47814f50d3b285d0955a')) then
    raise exception 'sql/222: public.privacy_retention_purge is not the text this file was made from — nothing was changed';
  end if;
end $guard$;

-- ── 1) a buyer can be 'cancelled' ────────────────────────────────────────────────────────────────────
alter table public.invoice_sends drop constraint if exists invoice_sends_status;
alter table public.invoice_sends add constraint invoice_sends_status check (status in ('sent', 'skipped', 'cancelled'));

create or replace function public.invoice_sends_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  -- sql/222: a 'cancelled' row keeps the time the buyer was sent before the cancel (null = never sent);
  -- "Undo cancel" back to 'sent' gives that time back. Every other case = sql/220.
  if new.status = 'cancelled' then
    new.sent_at := case when tg_op = 'UPDATE' and old.status in ('sent', 'cancelled') then old.sent_at else null end;
  elsif new.status = 'sent' and tg_op = 'UPDATE' and old.status = 'cancelled' and old.sent_at is not null then
    new.sent_at := old.sent_at;
  else
    new.sent_at := case when new.status = 'sent' then now() else null end;
  end if;
  return new;
end;
$$;

-- ── 2) the cancelled lines ───────────────────────────────────────────────────────────────────────────
create table if not exists public.invoice_line_cancels (
  user_id      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  session_key  text        not null,
  platform     text        not null,
  order_id     bigint      not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, session_key, platform, order_id),
  constraint invoice_line_cancels_session_len check (char_length(session_key) between 1 and 80),
  constraint invoice_line_cancels_platform    check (platform in ('tiktok', 'facebook', 'instagram', 'shopee')),
  constraint invoice_line_cancels_order       check (order_id > 0)
);
create index if not exists invoice_line_cancels_created_idx on public.invoice_line_cancels (created_at);
alter table public.invoice_line_cancels enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_line_cancels' and policyname = 'invoice_line_cancels_select') then
    create policy invoice_line_cancels_select on public.invoice_line_cancels for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_line_cancels' and policyname = 'invoice_line_cancels_insert') then
    create policy invoice_line_cancels_insert on public.invoice_line_cancels for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_line_cancels' and policyname = 'invoice_line_cancels_update') then
    create policy invoice_line_cancels_update on public.invoice_line_cancels for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_line_cancels' and policyname = 'invoice_line_cancels_delete') then
    create policy invoice_line_cancels_delete on public.invoice_line_cancels for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.invoice_line_cancels from public, anon;
grant select, insert, update, delete on public.invoice_line_cancels to authenticated;

-- the time is the database's, never the phone's (the 3-month clean-up reads it)
create or replace function public.invoice_line_cancels_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.created_at := case when tg_op = 'INSERT' then now() else old.created_at end;
  return new;
end;
$$;
drop trigger if exists trg_invoice_line_cancels_stamp on public.invoice_line_cancels;
create trigger trg_invoice_line_cancels_stamp before insert or update on public.invoice_line_cancels
  for each row execute function public.invoice_line_cancels_stamp();

-- ── 3) the nightly privacy clean-up: sql/220's text + the invoice_line_cancels loop ──────────────────
create or replace function public.privacy_retention_purge(p_batch integer default 5000)
returns jsonb language plpgsql set search_path = public as $$
declare
  n integer;
  v_orders integer := 0;
  v_scans integer := 0;
  v_tracking integer := 0;
  v_invoices integer := 0;   -- sql/220
  v_lines integer := 0;      -- sql/222
begin
  loop
    delete from public.orders
     where id in (select id from public.orders
                   where created_at < now() - interval '3 months'
                   limit p_batch);
    get diagnostics n = row_count;
    v_orders := v_orders + n;
    exit when n < p_batch;
  end loop;

  loop
    delete from public.parcel_scans
     where id in (select id from public.parcel_scans
                   where (exported_at is not null and exported_at < now() - interval '90 days')
                      or (exported_at is null and created_at < now() - interval '180 days')
                   limit p_batch);
    get diagnostics n = row_count;
    v_scans := v_scans + n;
    exit when n < p_batch;
  end loop;

  loop
    delete from public.parcel_tracking
     where id in (select id from public.parcel_tracking
                   where (status = 'picked_up' and coalesce(picked_up_at, updated_at) < now() - interval '7 days')
                      or (status = 'returned'  and coalesce(returned_at,  updated_at) < now() - interval '365 days')
                   limit p_batch);
    get diagnostics n = row_count;
    v_tracking := v_tracking + n;
    exit when n < p_batch;
  end loop;

  -- sql/220: Invoicing send status, 3 months after its last change
  loop
    delete from public.invoice_sends
     where ctid in (select ctid from public.invoice_sends
                     where updated_at < now() - interval '3 months'
                     limit p_batch);
    get diagnostics n = row_count;
    v_invoices := v_invoices + n;
    exit when n < p_batch;
  end loop;

  -- sql/222: Invoicing cancelled lines, 3 months after they were cancelled
  loop
    delete from public.invoice_line_cancels
     where ctid in (select ctid from public.invoice_line_cancels
                     where created_at < now() - interval '3 months'
                     limit p_batch);
    get diagnostics n = row_count;
    v_lines := v_lines + n;
    exit when n < p_batch;
  end loop;

  return jsonb_build_object('orders', v_orders, 'parcel_scans', v_scans, 'parcel_tracking', v_tracking, 'invoice_sends', v_invoices, 'invoice_line_cancels', v_lines);
end;
$$;
revoke all on function public.privacy_retention_purge(integer) from public, anon, authenticated;

commit;

-- Apply check (each true):
--   select pg_get_constraintdef(oid) like '%cancelled%' from pg_constraint where conname = 'invoice_sends_status';
--   select relrowsecurity from pg_class where oid = 'public.invoice_line_cancels'::regclass;
--   select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'invoice_line_cancels';
--   select not has_table_privilege('anon', 'public.invoice_line_cancels', 'select');
