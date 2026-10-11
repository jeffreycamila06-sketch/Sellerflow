// Runs sql/119 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of the live
// parcel_tracking schema: carrier column, 全家 rows hidden while the switch is off, the
// upload RPC (gates, rate limit, row cap, mapping, hide, tracking-number collision), the
// 7-11 check paths skipping 全家 rows, and a clean rollback.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg119 && cd /tmp/pg119 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql119-behaviour.mjs . && node sql119-behaviour.mjs <repo>/sql/119_fm_pickup.sql <repo>/sql/119_fm_pickup_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const STUB = `
create role anon; create role authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table public.app_settings(key text primary key, value text);
create table public.feature_access_emails(feature text, email text, is_prefix boolean default false);
create table public.seller_profiles(auth_user_id uuid, plan text, plan_status text default 'active', plan_expiry timestamptz, role text);
create function public.is_admin() returns boolean language sql stable security definer as $$ select exists(select 1 from public.seller_profiles p where p.auth_user_id = auth.uid() and p.role='admin') $$;
grant execute on function public.is_admin() to authenticated;
create table public.parcel_tracking_access(user_id uuid primary key, enabled boolean default true, note text, created_at timestamptz default now(), last_manual_check_at timestamptz, last_manual_check_day date, last_completed_at timestamptz, auto_check boolean default false);
create table public.parcel_tracking_jobs(id uuid primary key default gen_random_uuid(), user_id uuid, kind text, created_by text, status text default 'queued', requested_at timestamptz default now(), started_at timestamptz, finished_at timestamptz, error text);
create unique index ux_jobs on public.parcel_tracking_jobs(user_id) where status in ('queued','running');
create table public.shipping_entries(id uuid primary key default gen_random_uuid(), user_id uuid, order_amount numeric, recipient_name text, phone text, buyer_username text, created_at timestamptz default now());
create table public.parcel_tracking (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, tracking_no text not null, cm_order_no text, shipping_entry_id uuid,
 buyer_username text, recipient_name text, store_id text, status text not null default 'created', status_message text, arrived_at timestamptz,
 pickup_deadline date, rec_store text, order_amount numeric, last_polled_at timestamptz, terminal boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), ship_type text, special_type text, recipient_phone text,
 picked_up_at timestamptz, returned_at timestamptz, unchanged_polls integer not null default 0,
 constraint parcel_tracking_status_check check (status = any (array['created','in_transit','at_store','picked_up','returned','not_found','unknown'])),
 constraint parcel_tracking_user_id_tracking_no_key unique (user_id, tracking_no));
create function public.parcel_tracking_taipei_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Taipei')::date $$;
create function public.parcel_tracking_setting_int(k text, d int, lo int, hi int) returns int language sql stable as $$ select d $$;
create function public.parcel_tracking_next_manual_at(p_last_at timestamptz, p_last_day date) returns timestamptz language sql stable as $$ select null::timestamptz $$;
create function public.parcel_tracking_can_use(p_uid uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_uid is not null and (public.is_admin() or (exists (select 1 from public.seller_profiles p where p.auth_user_id = p_uid and lower(coalesce(p.plan,'')) in ('plus','pro','master')) and exists (select 1 from public.parcel_tracking_access a where a.user_id = p_uid and a.enabled))) $$;
create function public.parcel_tracking_upload_allowed() returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is not null and (exists (select 1 from public.parcel_tracking_access a where a.user_id = auth.uid() and a.enabled) or public.is_admin()) $$;
create function public.parcel_tracking_guard_insert() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.parcel_tracking_upload_allowed() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.parcel_tracking t where t.tracking_no = new.tracking_no and t.user_id <> new.user_id) then
    raise exception 'foreign_tracking_no' using errcode = 'P0001'; end if;
  return new;
end; $$;
create function public.link_parcel_tracking() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create function public.parcel_tracking_enqueue_new() returns trigger language plpgsql security definer as $$ begin return null; end $$;
create function public.my_feature_access() returns jsonb language sql stable security definer as $$ select '{}'::jsonb $$;
create trigger trg_link_parcel_tracking before insert or update on public.parcel_tracking for each row execute function link_parcel_tracking();
create trigger trg_parcel_tracking_enqueue_new after insert on public.parcel_tracking referencing new table as new_rows for each statement execute function parcel_tracking_enqueue_new();
create trigger trg_parcel_tracking_guard_insert before insert on public.parcel_tracking for each row execute function parcel_tracking_guard_insert();
alter table public.parcel_tracking enable row level security;
create policy parcel_tracking_select on public.parcel_tracking for select using (user_id = auth.uid());
create policy parcel_tracking_insert on public.parcel_tracking for insert with check (user_id = auth.uid());
create policy parcel_tracking_update on public.parcel_tracking for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy parcel_tracking_delete on public.parcel_tracking for delete using (user_id = auth.uid());
grant select, delete on public.parcel_tracking to authenticated;
grant insert (user_id, tracking_no, buyer_username, cm_order_no, recipient_name, store_id, order_amount, shipping_entry_id), update (user_id, tracking_no, buyer_username, cm_order_no, recipient_name, store_id, order_amount, shipping_entry_id) on public.parcel_tracking to authenticated;
grant select on public.parcel_tracking_jobs to authenticated;
`;
const [,, up, down] = process.argv;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b", X = "00000000-0000-0000-0000-0000000000cc", ADM = "00000000-0000-0000-0000-0000000000ad";
await db.exec(STUB);
await db.exec(`insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com'),('${X}','x@x.com'),('${ADM}','adm@x.com');
insert into seller_profiles(auth_user_id, plan, role) values ('${A}','plus','seller'),('${B}','pro','seller'),('${X}','plus','seller'),('${ADM}','master','admin');
insert into parcel_tracking_access(user_id, enabled) values ('${A}',true),('${B}',true);
insert into app_settings values ('parcel_tracking_enabled','true'),('parcel_tracking_auto_mode','all');
insert into parcel_tracking(user_id, tracking_no, status) values ('${A}','T1','created'),('${B}','TB','in_transit');`);
await db.exec(readFileSync(up, "utf8"));
const as = async (uid, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
};
const up1 = (uid, rows) => as(uid, "select fm_pickup_upload($1::jsonb) r", [JSON.stringify(rows)]).then((x) => x[0].r);
const resetRate = () => db.exec("update fm_pickup_uploads set last_at = now() - interval '1 minute'");

ok((await db.query("select carrier from parcel_tracking where tracking_no='T1'")).rows[0].carrier === "711", "existing row → 711");
ok((await up1(A, [{ order_no: "L1", status: "at_store" }])).reason === "disabled", "switch off → disabled");
await db.exec(`insert into parcel_tracking(user_id, carrier, cm_order_no, tracking_no, status) values ('${A}','fm','L0',null,'at_store')`);
ok((await as(A, "select count(*)::int n from parcel_tracking"))[0].n === 1, "switch off: fm row hidden, 711 row shown");
ok((await as(A, "select count(*)::int n from parcel_tracking where status='at_store'"))[0].n === 0, "switch off: head count hides fm");

await db.exec("update app_settings set value='true' where key='fm_pickup_enabled'");
ok((await as(A, "select count(*)::int n from parcel_tracking"))[0].n === 2, "switch on: fm row visible");
ok((await as(B, "select count(*)::int n from parcel_tracking"))[0].n === 1, "other seller sees only own rows");
await db.exec("delete from parcel_tracking where cm_order_no='L0'; delete from parcel_tracking_jobs");

const res = await up1(A, [
  { order_no: "L1", status: "at_store", tracking_no: "FM1", pickup_deadline: "2026-10-14", status_message: "已到店", buyer_username: "juan_dela.cruz", recipient_name: "J*f*r*y", store_id: "022131", rec_store: "全家某店", order_amount: "120", ship_type: "C2C" },
  { order_no: "L2", status: "hide" },
  { order_no: "L3", status: "picked_up", tracking_no: "FM3", picked_up_at: "2026-10-10T12:00:00+08:00" },
  { order_no: "L4", status: "in_transit", tracking_no: "T1" },
  { order_no: "L5", status: "in_transit", tracking_no: "TB" },
  { order_no: "L6", status: "weird" },
  { order_no: "L7", status: "at_store", pickup_deadline: "not-a-date" },
]);
ok(res.ok && res.inserted === 4 && res.updated === 0 && res.hidden === 0 && res.skipped === 2 && res.tracking_dropped === 2, "upload counts " + JSON.stringify(res));
const rows = await as(A, "select cm_order_no, carrier, tracking_no, status, terminal, store_id, pickup_deadline::text d, buyer_username from parcel_tracking where carrier='fm' order by cm_order_no");
ok(rows.map((r) => r.cm_order_no).join() === "L1,L3,L4,L5", "stored orders");
ok(rows[0].store_id === "022131" && rows[0].d === "2026-10-14" && rows[0].tracking_no === "FM1" && !rows[0].terminal, "L1 fields");
ok(rows[1].terminal === true && rows[1].status === "picked_up", "picked → terminal");
ok(rows[2].tracking_no === null && rows[3].tracking_no === null, "colliding codes dropped");
ok((await db.query(`select tracking_no from parcel_tracking where user_id='${A}' and carrier='711'`)).rows[0].tracking_no === "T1", "7-11 row untouched");
ok((await db.query("select count(*)::int n from parcel_tracking_jobs")).rows[0].n === 0, "fm insert queues no check job");

ok((await up1(A, [{ order_no: "L1", status: "hide" }])).reason === "too_soon", "rate limit 20s");
await resetRate();
const r2 = await up1(A, [{ order_no: "L1", status: "hide" }, { order_no: "L4", status: "returned", returned_at: "2026-10-11T10:00:00+08:00", tracking_no: "FM4" }]);
ok(r2.hidden === 1 && r2.updated === 1 && r2.inserted === 0, "hide deletes, re-upload updates " + JSON.stringify(r2));
ok((await db.query("select tracking_no, terminal from parcel_tracking where cm_order_no='L4'")).rows[0].tracking_no === "FM4", "later code fills in");
await resetRate();
ok((await up1(A, Array.from({ length: 2001 }, (_, i) => ({ order_no: "Z" + i, status: "hide" })))).reason === "too_many", "2001 rows refused");
ok((await up1(X, [{ order_no: "L9", status: "at_store" }])).reason === "not_allowed", "no Pickup Status access → not_allowed");

// preview + admin while the switch is off
await db.exec("update app_settings set value='false' where key='fm_pickup_enabled'; delete from fm_pickup_uploads;");
ok((await up1(A, [{ order_no: "P1", status: "at_store" }])).reason === "disabled", "switch off again → disabled");
await db.exec("insert into feature_access_emails(feature,email) values ('fm_pickup','a@x.com')");
ok((await up1(A, [{ order_no: "P1", status: "at_store" }])).ok === true, "preview email → allowed");
ok((await as(A, "select count(*)::int n from parcel_tracking where carrier='fm'"))[0].n > 0, "preview sees fm rows");
ok((await up1(ADM, [{ order_no: "AD1", status: "in_transit" }])).reason === "disabled", "admin not on the preview list → disabled (same answer as the app)");
await db.exec("insert into feature_access_emails(feature,email) values ('fm_pickup','adm@x.com')");
ok((await up1(ADM, [{ order_no: "AD1", status: "in_transit" }])).ok === true, "admin on the preview list → allowed");

// 7-11 check paths ignore fm rows
await db.exec(`delete from parcel_tracking where user_id='${A}'; delete from parcel_tracking_jobs;
insert into parcel_tracking(user_id, carrier, cm_order_no, tracking_no, status, pickup_deadline) values ('${A}','fm','U1','FMX','at_store', (now() at time zone 'Asia/Taipei')::date + 1);`);
ok((await as(A, "select parcel_tracking_request_check('urgent') r"))[0].r.reason === "not_eligible", "urgent: fm parcel due tomorrow → not eligible");
ok((await as(A, "select parcel_tracking_auto_check() r"))[0].r.reason === "nothing_due", "auto: only fm rows → nothing due");
await db.exec(`insert into parcel_tracking(user_id, tracking_no, status, pickup_deadline) values ('${A}','T9','at_store',(now() at time zone 'Asia/Taipei')::date + 1)`);
ok((await as(A, "select parcel_tracking_request_check('urgent') r"))[0].r.reason === "queued", "urgent: 7-11 parcel due tomorrow → queued");

// 7-11 seller path unchanged: own insert (no carrier column) works, queues a job, null code refused
await db.exec("delete from parcel_tracking_jobs");
await as(A, "insert into parcel_tracking(user_id, tracking_no, buyer_username) values ($1,'T10','h')", [A]);
ok((await db.query("select carrier from parcel_tracking where tracking_no='T10'")).rows[0].carrier === "711", "app insert → 711");
ok((await db.query("select count(*)::int n from parcel_tracking_jobs where kind='new_parcels'")).rows[0].n === 1, "7-11 insert still queues a job");
let threw = false; try { await as(A, "insert into parcel_tracking(user_id, tracking_no) values ($1, null)", [A]); } catch { threw = true; }
ok(threw, "7-11 row without a code refused");
threw = false; try { await as(A, "update parcel_tracking set status='picked_up'"); } catch { threw = true; }
ok(threw, "seller still cannot write status directly");

await db.exec(readFileSync(down, "utf8"));
const cols = (await db.query("select column_name, is_nullable from information_schema.columns where table_name='parcel_tracking' and column_name in ('carrier','tracking_no')")).rows;
ok(cols.length === 1 && cols[0].is_nullable === "NO", "rollback: carrier gone, tracking_no not null");
ok((await db.query("select count(*)::int n from parcel_tracking")).rows[0].n === 3, "rollback: 7-11 rows kept (T9, T10, TB), fm rows gone");
const fa = (await db.query("select pg_get_functiondef('public.my_feature_access()'::regprocedure) d")).rows[0].d;
ok(!fa.includes("fm_pickup") && fa.includes("parcel_cap_70"), "rollback: feature list restored");
console.log(`pass=${pass} fail=${fail}`); process.exit(fail ? 1 : 0);
