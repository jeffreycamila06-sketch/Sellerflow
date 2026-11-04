// Runs sql/140 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of the live
// parcel tables with the sql/36 + sql/121 phonebook triggers in place, and checks: the four
// nullable contact_platform columns + their check constraint, the triggers carrying the
// platform (replaced together with the handle; a blank handle keeps the old one), the
// 'buyer_contact_enabled' switch seeded OFF, 'buyer_contact' in my_feature_access(), the FAQ
// rows, and a rollback that restores the triggers and leaves the contact values alone.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg140 && cd /tmp/pg140 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql140-behaviour.mjs . && node sql140-behaviour.mjs <repo>/sql/140_buyer_contact.sql <repo>/sql/140_buyer_contact_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [,, up, down] = process.argv;
const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const A = "00000000-0000-0000-0000-00000000000a";

const STUB = `
create extension pg_trgm;
create role anon; create role authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.app_settings(key text primary key, value text, updated_at timestamptz default now());
create table public.feature_access_emails(feature text, email text, is_prefix boolean default false);
create table public.support_faq(id bigint generated always as identity primary key, question text not null, answer text not null, lang text, guide_sections text[] not null default '{}', from_chat_id uuid, enabled boolean not null default true, needs_recheck boolean not null default false, approved_at timestamptz, created_at timestamptz not null default now());
create table public.parcel_scans(id uuid primary key default gen_random_uuid(), user_id uuid not null, customer_name text, phone text, store_id text, amount numeric, notes text, status text default 'confirmed', store_check_status text, phone_check_status text, created_at timestamptz default now());
create table public.parcel_customers(id uuid primary key default gen_random_uuid(), user_id uuid not null, phone text not null, name text, store_id text, notes text, created_at timestamptz default now(), updated_at timestamptz default now());
create unique index parcel_customers_uniq on public.parcel_customers (user_id, phone, lower(trim(coalesce(name, ''))));
create table public.fm_parcel_scans(id uuid primary key default gen_random_uuid(), user_id uuid not null, recipient_name text, phone text, store_id text, amount numeric, shipping_fee numeric, order_date date, buyer_username text, created_at timestamptz default now());
create table public.fm_parcel_customers(id uuid primary key default gen_random_uuid(), user_id uuid not null, phone text not null, name text, store_id text, buyer_username text, created_at timestamptz default now(), updated_at timestamptz default now());
create unique index fm_parcel_customers_uniq on public.fm_parcel_customers (user_id, phone, lower(trim(coalesce(name, ''))));
`;
// the live phonebook triggers before sql/140 = sql/36 + sql/121, read from THOSE files (not from the rollback)
const sqlDir = dirname(up);
const s36 = readFileSync(join(sqlDir, "36_parcel_customers_filters.sql"), "utf8");
const s121 = readFileSync(join(sqlDir, "121_fm_parcel_customers.sql"), "utf8");
const slice = (s, from, to) => { const a = s.indexOf(from), b = s.indexOf(to, a); if (a < 0 || b < 0) throw new Error(`anchor missing: ${from} / ${to}`); return s.slice(a, b + to.length); };
const before = slice(s36, "create or replace function public.upsert_parcel_customer()", "execute function public.upsert_parcel_customer();")
  + "\n" + slice(s121, "create function public.upsert_fm_parcel_customer()", "execute function public.upsert_fm_parcel_customer();");
const live = readFileSync(down, "utf8");
const featureFn = live.slice(live.indexOf("create or replace function public.my_feature_access()"), live.lastIndexOf("commit;"));

await db.exec(STUB);
await db.exec(before);
await db.exec(featureFn);
await db.exec(`insert into auth.users values ('${A}','a@x.com'); insert into feature_access_emails values ('buyer_contact','a@x.com',false);`);

const q = (s, p) => db.query(s, p);
const col = async (t) => (await q("select 1 from information_schema.columns where table_name=$1 and column_name='contact_platform'", [t])).rows.length === 1;
const cust = async (phone) => (await q("select notes, contact_platform from parcel_customers where phone=$1", [phone])).rows;
const fmcust = async (phone) => (await q("select buyer_username, contact_platform from fm_parcel_customers where phone=$1", [phone])).rows;
const asUser = async (sql) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${A}',false);`); try { return (await db.query(sql)).rows; } finally { await db.exec("reset role;"); } };

// ── apply 140 ────────────────────────────────────────────────────────────────
await db.exec(readFileSync(up, "utf8"));
for (const t of ["parcel_scans", "parcel_customers", "fm_parcel_scans", "fm_parcel_customers"]) ok(await col(t), `${t}.contact_platform exists`);
let bad = false; try { await q("insert into parcel_scans(user_id, phone, notes, contact_platform) values ($1,'0900000000','x','telegram')", [A]); } catch { bad = true; }
ok(bad, "check constraint rejects an unknown platform");
ok((await q("select value from app_settings where key='buyer_contact_enabled'")).rows[0]?.value === "false", "switch seeded OFF");
ok((await q("select count(*)::int as n from support_faq where 'pickup-status' = any(guide_sections)")).rows[0].n === 16, "16 FAQ rows (2 × 8 languages)");
ok((await q("select count(*)::int as n from support_faq where enabled or approved_at is not null")).rows[0].n === 0, "FAQ rows seeded DISABLED (enabled with the switch, not at merge)");
await db.exec(readFileSync(up, "utf8")); // idempotent re-run (no duplicate FAQ / setting) — must not throw
ok((await q("select count(*)::int as n from support_faq")).rows[0].n === 16, "FAQ seed is idempotent");
const fa = (await asUser("select public.my_feature_access() as a"))[0].a;
ok(fa.buyer_contact === true && fa.fb_post_sales === false, `my_feature_access carries buyer_contact for a listed email (${JSON.stringify(fa)})`);

// 7-11: platform travels with the handle
const { rows: [{ id }] } = await q("insert into parcel_scans(user_id, customer_name, phone, store_id, amount, notes, contact_platform) values ($1,'Maria','0912345678','266402',500,'@maria','line') returning id", [A]);
ok(JSON.stringify(await cust("0912345678")) === JSON.stringify([{ notes: "@maria", contact_platform: "line" }]), "insert → customer gets handle + platform");
await q("update parcel_scans set notes='+886912345678', contact_platform='whatsapp' where id=$1", [id]);
ok(JSON.stringify(await cust("0912345678")) === JSON.stringify([{ notes: "+886912345678", contact_platform: "whatsapp" }]), "handle + platform replaced together");
await q("update parcel_scans set notes='', contact_platform=null where id=$1", [id]);
ok(JSON.stringify(await cust("0912345678")) === JSON.stringify([{ notes: "+886912345678", contact_platform: "whatsapp" }]), "blank handle keeps the saved handle AND platform");
await q("update parcel_scans set notes='maria_tt', contact_platform=null where id=$1", [id]);
ok(JSON.stringify(await cust("0912345678")) === JSON.stringify([{ notes: "maria_tt", contact_platform: null }]), "a new handle with no platform (TikTok) clears the old platform");
await q("update parcel_scans set phone_check_status='restricted' where id=$1", [id]);
ok((await cust("0912345678")).length === 0, "rule 2 (restricted) still removes the buyer");

// FamilyMart: same rules
await q("insert into fm_parcel_scans(user_id, recipient_name, phone, store_id, amount, shipping_fee, order_date, buyer_username, contact_platform) values ($1,'Pedro','0922222222','022131',450,39,'2026-11-03','pedro.ig','instagram')", [A]);
ok(JSON.stringify(await fmcust("0922222222")) === JSON.stringify([{ buyer_username: "pedro.ig", contact_platform: "instagram" }]), "FM insert → customer gets handle + platform");
await q("update fm_parcel_scans set buyer_username=null, contact_platform=null where phone='0922222222'");
ok(JSON.stringify(await fmcust("0922222222")) === JSON.stringify([{ buyer_username: "pedro.ig", contact_platform: "instagram" }]), "FM blank handle keeps handle + platform");
await q("update fm_parcel_scans set buyer_username='+886922222222', contact_platform='whatsapp' where phone='0922222222'");
ok(JSON.stringify(await fmcust("0922222222")) === JSON.stringify([{ buyer_username: "+886922222222", contact_platform: "whatsapp" }]), "FM handle + platform replaced together");

// ── rollback ─────────────────────────────────────────────────────────────────
await db.exec(readFileSync(down, "utf8"));
for (const t of ["parcel_scans", "parcel_customers", "fm_parcel_scans", "fm_parcel_customers"]) ok(!(await col(t)), `${t}.contact_platform dropped`);
ok((await q("select count(*)::int as n from app_settings where key='buyer_contact_enabled'")).rows[0].n === 0, "switch row deleted");
ok((await q("select count(*)::int as n from support_faq")).rows[0].n === 0, "the 16 seeded FAQ rows deleted by the rollback");
ok(JSON.stringify((await q("select buyer_username from fm_parcel_customers where phone='0922222222'")).rows) === JSON.stringify([{ buyer_username: "+886922222222" }]), "contact values untouched by the rollback");
await q("insert into parcel_scans(user_id, customer_name, phone, store_id, amount, notes) values ($1,'Ana','0933333333','211004',300,'@ana')", [A]);
ok(JSON.stringify(await q("select notes from parcel_customers where phone='0933333333'").then((r) => r.rows)) === JSON.stringify([{ notes: "@ana" }]), "restored 7-11 trigger still saves the handle");
const fa2 = (await asUser("select public.my_feature_access() as a"))[0].a;
ok(!("buyer_contact" in fa2) && "fb_post_sales" in fa2, "my_feature_access back to the sql/137 list");

console.log(`sql140: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
