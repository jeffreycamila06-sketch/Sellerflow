// Runs sql/115 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of the live
// schema and checks the plan → Parcel Check / Pickup Status access rules.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg115 && cd /tmp/pg115 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql115-behaviour.mjs . && node sql115-behaviour.mjs <repo>/sql/115_parcel_auto_access.sql <repo>/sql/115_parcel_auto_access_rollback.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const [,, fwd, back] = process.argv;
const db = new PGlite();
const q = (s, p) => db.query(s, p);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

await db.exec(`
create role anon; create role authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create table public.seller_profiles(id serial primary key, auth_user_id uuid, email text, role text, plan text, plan_status text, country text);
create table public.parcel_check_access(user_id uuid primary key references auth.users(id) on delete cascade, enabled boolean not null default true, note text, created_at timestamptz not null default now());
create table public.parcel_tracking_access(user_id uuid primary key references auth.users(id) on delete cascade, enabled boolean not null default true, note text, created_at timestamptz not null default now(),
  auto_check boolean not null default false, last_manual_check_at timestamptz, last_manual_check_day date, last_completed_at timestamptz);
`);
let n = 0;
async function seller(plan, { role = "seller", status = "active", country = null } = {}) {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await q("insert into auth.users values ($1)", [id]);
  await q("insert into public.seller_profiles(auth_user_id, role, plan, plan_status, country) values ($1,$2,$3,$4,$5)", [id, role, plan, status, country]);
  return id;
}
const acc = async (t, id) => (await q(`select enabled, note from public.${t} where user_id=$1`, [id])).rows[0] ?? null;
const both = async (id) => [await acc("parcel_check_access", id), await acc("parcel_tracking_access", id)];
const set = (id, col, v) => q(`update public.seller_profiles set ${col}=$2 where auth_user_id=$1`, [id, v]);

// ── existing sellers BEFORE sql/115 (backfill targets) ──
const oldPro = await seller("Pro ");
const oldBasic = await seller("basic");
const oldPh = await seller("master", { country: "PH" });
const oldAdmin = await seller("master", { role: "admin" });
const oldExpired = await seller("plus", { status: "expired" });
const oldHandOff = await seller("pro");
await q("insert into public.parcel_check_access values ($1,false,'Jeff: off')", [oldHandOff]);
const oldTw = await seller("plus", { country: "tw" });

await db.exec(readFileSync(fwd, "utf8"));

for (const [id, want, m] of [[oldPro, true, "pro (spaces/case)"], [oldTw, true, "plus country tw"]]) {
  const [c, t] = await both(id);
  ok(c?.enabled === want && t?.enabled === want && c.note === "auto: paid plan", `backfill gives ${m} access`);
}
for (const [id, m] of [[oldBasic, "basic"], [oldPh, "PH"], [oldAdmin, "admin"], [oldExpired, "expired"]]) {
  const [c, t] = await both(id);
  ok(c === null && t === null, `backfill skips ${m}`);
}
ok((await acc("parcel_check_access", oldHandOff))?.enabled === false, "backfill leaves a hand-off row off");
ok((await acc("parcel_tracking_access", oldHandOff))?.enabled === true, "…while the missing other table row is added");

// ── new signups ──
const newFree = await seller("free");
ok((await both(newFree)).every((r) => r === null), "free signup → nothing");
const newPro = await seller("pro");
ok((await both(newPro)).every((r) => r?.enabled === true), "paid insert → access");

// ── downgrade / upgrade ──
await set(newPro, "plan", "basic");
let [c, t] = await both(newPro);
ok(c.enabled === false && t.enabled === false && c.note === "auto-off: plan basic", "downgrade → auto-off");
await set(newPro, "plan", "master");
[c, t] = await both(newPro);
ok(c.enabled === true && t.enabled === true && c.note === "auto: paid plan", "upgrade after auto-off → back on");
await set(newPro, "plan_status", "expired");
ok((await acc("parcel_check_access", newPro)).enabled === false, "expired → off");
await set(newPro, "plan_status", "active");
ok((await acc("parcel_check_access", newPro)).enabled === true, "renewed → on");
await set(newPro, "country", "PH");
ok((await acc("parcel_tracking_access", newPro)).enabled === false, "country PH → off");
await set(newPro, "country", null);
ok((await acc("parcel_tracking_access", newPro)).enabled === true, "country back to TW (null) → on");
await set(newPro, "plan", null);
ok((await acc("parcel_check_access", newPro)).note === "auto-off: plan none", "plan removed → 'auto-off: plan none'");

// ── a row Jeff turned off by hand is never turned back on ──
const hand = await seller("pro");
await q("update public.parcel_check_access set enabled=false, note='Jeff: off' where user_id=$1", [hand]);
await set(hand, "plan", "master");
ok((await acc("parcel_check_access", hand)).enabled === false && (await acc("parcel_check_access", hand)).note === "Jeff: off", "hand-off row stays off on upgrade");
ok((await acc("parcel_tracking_access", hand)).enabled === true, "the other table is unaffected");

// ── no real change → no action ──
const same = await seller("pro");
await q("update public.parcel_check_access set enabled=false, note='auto-off: test' where user_id=$1", [same]);
await set(same, "plan", "pro");
ok((await acc("parcel_check_access", same)).enabled === false, "plan set to the same value → nothing happens");
await q("update public.seller_profiles set email='x@y.z' where auth_user_id=$1", [same]);
ok((await acc("parcel_check_access", same)).enabled === false, "other column change → nothing happens");

// ── admin update skipped ──
const adm = await seller("basic", { role: "admin" });
await set(adm, "plan", "master");
ok((await both(adm)).every((r) => r === null), "admin plan change → skipped");

// ── an error never blocks the plan change ──
await db.exec("alter table public.parcel_check_access rename to pca_gone");
const brk = await seller("pro");
let blocked = false;
try { await set(brk, "plan", "master"); } catch { blocked = true; }
ok(!blocked, "error inside → plan change still succeeds");
ok((await q("select plan from public.seller_profiles where auth_user_id=$1", [brk])).rows[0].plan === "master", "…and the new plan is saved");
await db.exec("alter table public.pca_gone rename to parcel_check_access");

// ── execute revoked from browser roles ──
const priv = (await q("select has_function_privilege('authenticated','public.parcel_auto_access_trg()','execute') a, has_function_privilege('anon','public.parcel_auto_access_trg()','execute') b")).rows[0];
ok(priv.a === false && priv.b === false, "execute revoked from anon + authenticated");

// ── rollback ──
await db.exec(readFileSync(back, "utf8"));
const afterRb = await seller("pro");
ok((await both(afterRb)).every((r) => r === null), "after rollback nothing is automatic");
ok((await q("select count(*)::int n from pg_proc where proname='parcel_auto_access_trg'")).rows[0].n === 0, "rollback drops the function");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
