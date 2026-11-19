-- 182 — 全家 rows saved with the words of the Good-selling file ("全家店寄店取") → 'C2C'.
-- NOT APPLIED — chat-Claude applies. Rollback: sql/182_fm_ship_type_fix_rollback.sql.
--
-- 'C2C' is the word Pickup Status keeps for a store-pickup parcel (7-11 rows carry it too). Until
-- 2026-11-19 the reader of the 好賣+ file saved 'C2C' only when the 配送方式 text contained 店到店;
-- the Good-selling file says 全家店寄店取 for the same store pickup, so those rows were saved with
-- that text. The app shows and counts them correctly WITHOUT this file (it accepts both words);
-- this file only makes the saved value the one every new upload saves.
--
-- What it changes: ship_type of 全家 rows (carrier = 'fm') whose ship_type is exactly 全家店寄店取.
-- Nothing else: no 7-11 row, no status, no date. Each changed row's id and old value are kept in
-- parcel_tracking_fm_ship_type_182 so the rollback puts back exactly those rows (6 other 全家 rows
-- were 'C2C' from the start). The table's own trigger moves updated_at of the changed rows to now.
-- Read on 2026-11-19: 70 rows, 4 sellers (28 picked up — all have a pickup time, so the 7-day
-- clean-up of picked-up rows is not moved).
begin;
set local lock_timeout = '5s';

create table public.parcel_tracking_fm_ship_type_182 (
  id            uuid primary key,
  old_ship_type text not null,
  changed_at    timestamptz not null default now()
);
alter table public.parcel_tracking_fm_ship_type_182 enable row level security; -- no policy: no browser access
revoke all on table public.parcel_tracking_fm_ship_type_182 from public, anon, authenticated;

with changed as (
  update public.parcel_tracking
     set ship_type = 'C2C'
   where carrier = 'fm'
     and ship_type = '全家店寄店取'
  returning id
)
insert into public.parcel_tracking_fm_ship_type_182 (id, old_ship_type)
select id, '全家店寄店取' from changed;

commit;

-- After applying: how many rows were changed, and what is left.
--   select count(*) from public.parcel_tracking_fm_ship_type_182;
--   select coalesce(ship_type, '(null)') as ship_type, count(*) from public.parcel_tracking where carrier = 'fm' group by 1;
