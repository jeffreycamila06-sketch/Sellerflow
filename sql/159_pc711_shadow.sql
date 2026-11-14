-- ============================================================================
-- sql/159 — 7-11 server checker SHADOW (Jeff 2026-11-14).
-- ============================================================================
-- NOT APPLIED. ADD-ONLY: one new table + one switch row (off).
-- The server re-checks parcels the Chrome extension has ALREADY checked (in the last 30 min) with its
-- own 7-11 session and writes ONE row per (parcel, kind) comparing the two answers. Nothing a seller
-- sees changes: the server never writes parcel_scans; this table is read only by the server (the
-- Admin → 7-11 Login "Shadow" block asks the server).
--   scan_id      uuid  parcel_scans.id (no foreign key: a deleted parcel just leaves an old row)
--   kind         'store' | 'phone' | 'frozen' (frozen = parcel_scans.frozen_store_status, extension 1.18.2:
--                the same store chain, byIDData cate=27; ext 'unknown' → match NULL, note ext_unknown)
--   ext_verdict  the extension's word (store_full_status / phone_check_status)
--   srv_verdict  the server's answer mapped to the same words
--   srv_ms / srv_http  the server check's time and last HTTP status
--   match        ext_verdict = srv_verdict
--   note         one short word (e.g. timeout) — never a phone, a name, a store, a cookie or a guid
--   match NULL   the server reached no real answer (a server error, NOT a mismatch); then:
--   fail_step    where it stopped: phone.token | phone.validate | store.cart | store.detail | store.map |
--                store.emap | store.byid | login | input (null when it reached an answer)
--   fail_http / fail_reason   that step's HTTP status and one word (timeout | http | no_form | no_guid |
--                unexpected_answer | needs_login | bad_input | threw …)
--   steps        every step of THIS check: [{s, http, ms, ok[, w]}] — step name, http, ms, ok, one word.
--                Never a phone, name, store id, cookie, guid, URL query or page text.
--   gap_s        seconds between the extension's check and the server's (explains "it changed in between")
--   raw          the server's raw answer WORD only: enable | disable | close | NO2 | other |
--                Status:true | Status:false-restricted | Status:false-other
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
  kind         text not null check (kind in ('store', 'phone', 'frozen')),
  ext_verdict  text,
  srv_verdict  text,
  srv_ms       integer,
  srv_http     integer,
  match        boolean,
  note         text check (note is null or note ~ '^[a-z0-9_]{0,32}$'),
  fail_step    text check (fail_step is null or fail_step in ('phone.config', 'phone.token', 'phone.validate', 'store.skip', 'store.config', 'store.relogin', 'store.cart', 'store.detail', 'store.map', 'store.emap', 'store.byid', 'frozen.byid', 'login', 'input', 'other')),
  fail_http    integer,
  fail_reason  text check (fail_reason is null or fail_reason ~ '^[a-z0-9_]{0,32}$'),
  steps        jsonb not null default '[]'::jsonb,
  gap_s        integer,
  raw          text check (raw is null or raw in ('enable', 'disable', 'close', 'NO2', 'other', 'Status:true', 'Status:false-restricted', 'Status:false-other')),
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
