-- ============================================================================
-- sql/159 — 7-11 server checker SHADOW (Jeff 2026-11-14).
-- ============================================================================
-- NOT APPLIED. ADD-ONLY: one new table + one switch row (off).
-- The server re-checks parcels the Chrome extension has ALREADY checked (in the last 30 min) with its
-- own 7-11 session and writes ONE row per (parcel, kind) comparing the two answers. Nothing a seller
-- sees changes: the server never writes parcel_scans; this table is read only by the server (the
-- Admin → 7-11 Login "Shadow" block asks the server).
--   scan_id      uuid  parcel_scans.id (no foreign key: a deleted parcel just leaves an old row)
--   kind         'store' | 'phone'
--   ext_verdict  the extension's word (store_full_status / phone_check_status)
--   srv_verdict  the server's answer mapped to the same words
--   srv_ms / srv_http  the server check's time and last HTTP status
--   match        ext_verdict = srv_verdict
--   note         one short word (e.g. timeout) — never a phone, a name, a store, a cookie or a guid
-- NO phone, NO name, NO store id/name, NO cookie/guid in this table.
-- RLS on, NO policies, revoked from public / anon / authenticated, granted to service_role.
-- Kept 30 days (the shadow job deletes older rows).
-- Switch: app_settings pc711_shadow_enabled = 'true' turns the job on (needs the 7-11 login connected).
-- Rollback: sql/159_pc711_shadow_rollback.sql.
-- ============================================================================
begin;
set local lock_timeout = '2s';

create table if not exists public.pc711_shadow (
  id           bigserial primary key,
  scan_id      uuid not null,
  at           timestamptz not null default now(),
  kind         text not null check (kind in ('store', 'phone')),
  ext_verdict  text,
  srv_verdict  text,
  srv_ms       integer,
  srv_http     integer,
  match        boolean,
  note         text check (note is null or note ~ '^[a-z0-9_]{0,32}$'),
  unique (scan_id, kind)
);
create index if not exists pc711_shadow_at_idx on public.pc711_shadow (at desc);

alter table public.pc711_shadow enable row level security;
revoke all on table public.pc711_shadow from public;
revoke all on table public.pc711_shadow from anon;
revoke all on table public.pc711_shadow from authenticated;
grant all on table public.pc711_shadow to service_role;
grant usage, select on sequence public.pc711_shadow_id_seq to service_role;
revoke all on sequence public.pc711_shadow_id_seq from public, anon, authenticated;

insert into public.app_settings (key, value) values ('pc711_shadow_enabled', 'false')
  on conflict (key) do nothing;

commit;
