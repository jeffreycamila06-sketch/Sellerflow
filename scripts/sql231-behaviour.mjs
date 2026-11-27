// Runs sql/231 (+ its rollback) on a real Postgres (PGlite, WASM) with a stub auth schema, on top of the
// LIVE text it starts from (my_feature_access of sql/220 — md5 checked against production 2026-11-27).
// Proves: the guard (a changed function = nothing applied); applying twice is fine and keeps a switch Jeff
// already turned on; the switch starts 'false'; no login is put on the preview list; my_feature_access =
// the live 29 keys + 'waybill_username' and answers true only for a listed login; nothing else changed;
// the rollback restores the live text byte for byte (md5), removes the switch row and the preview logins,
// and the file can be applied again after it.
// Not part of CI (PGlite is not a dependency). Run:
//   PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17 installed> node scripts/sql231-behaviour.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.2.17` was run"); process.exit(2); }
const { PGlite } = createRequire(join(dir, "package.json"))("@electric-sql/pglite");
const read = (f) => readFileSync(join(repo, f), "utf8");
const UP = read("sql/231_waybill_username.sql");
const DOWN = read("sql/231_waybill_username_rollback.sql");
const cut = (text, from, to) => { const a = text.indexOf(from); const b = text.indexOf(to, a); if (a < 0 || b < 0) throw new Error(`cannot find ${from}`); return text.slice(a, b + to.length); };
const LIVE_ACCESS = cut(read("sql/220_invoicing.sql"), "create or replace function public.my_feature_access()", "$function$;");
const LIVE = "6d7264ef44eefe70c1e836eb20709b82";   // production, read 2026-11-27
const NEW = "86de09c575137dd74fee9252e586a8e2";

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`ok   ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const refused = async (sql, msg, want) => {
  try { await db.exec(sql); ok(false, `${msg} (was accepted)`); }
  catch (e) {
    await db.exec("rollback;").catch(() => {});
    ok(!want || String(e.message).includes(want), `${msg} → refused${want && !String(e.message).includes(want) ? ` — got: ${e.message}` : ""}`);
  }
};
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const as = async (role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('t.uid', '${uid ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role;"); }
};
const rows = async (sql, p) => (await db.query(sql, p)).rows;
const q1 = async (sql, p) => (await rows(sql, p))[0];
const md5of = async (name) => (await q1(`select md5(p.prosrc) as m from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname=$1`, [name]))?.m;
const settings = async () => JSON.stringify(await rows(`select key, value from public.app_settings order by key`));
const emails = async () => JSON.stringify(await rows(`select feature, email, is_prefix from public.feature_access_emails order by 1, 2`));

await db.exec(`
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on auth.users to authenticated;
insert into auth.users values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
create table public.app_settings(key text primary key, value text, updated_at timestamptz default now());
insert into public.app_settings(key, value) values ('invoicing_enabled', 'false'), ('blacklist_enabled', 'true');
create table public.feature_access_emails(feature text, email text, is_prefix boolean not null default false, primary key (feature, email));
insert into public.feature_access_emails values ('blacklist', 'a@example.com', false), ('invoicing', 'b@example.com', false);
`);
await db.exec(LIVE_ACCESS);
ok(await md5of("my_feature_access") === LIVE, "the starting my_feature_access is production's text (md5)");
const settingsBefore = await settings();
const emailsBefore = await emails();

// ── the guard ──
await db.exec(`create or replace function public.my_feature_access() returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;`);
await refused(UP, "my_feature_access is not the expected text", "is not the text this file was made from");
ok(await settings() === settingsBefore, "… and nothing was applied (no switch row)");
await db.exec(LIVE_ACCESS);

// ── apply, twice ──
await db.exec(UP);
ok(true, "sql/231 applies");
ok(await md5of("my_feature_access") === NEW, "my_feature_access is the new text (md5 in the file's guard)");
ok((await q1(`select value from public.app_settings where key='waybill_username_enabled'`)).value === "false", "the switch row starts as 'false'");
ok(JSON.stringify(await rows(`select key, value from public.app_settings where key <> 'waybill_username_enabled' order by key`)) === settingsBefore, "no other app_settings value changed");
ok(await emails() === emailsBefore, "no login is put on the preview list (feature_access_emails unchanged)");
await db.exec(`update public.app_settings set value = 'true' where key = 'waybill_username_enabled'`);
await db.exec(UP);
ok(true, "sql/231 applies a second time (nothing breaks)");
ok((await q1(`select value from public.app_settings where key='waybill_username_enabled'`)).value === "true", "applying again keeps a switch that was already turned on");
await db.exec(`update public.app_settings set value = 'false' where key = 'waybill_username_enabled'`);

// ── the preview key ──
const keysBefore = ["fb_preview", "kiosk_launcher", "parcel_check", "parcel_cap_tester", "pin_print", "sticker_v2", "sticker_spacing", "session_v2", "session_numbering_fix", "shopee_preview", "live_source", "classic_text", "support_ai_preview", "parcel_cap_70", "fm_pickup", "test_printers", "tiktok_send", "fb_post_sales", "buyer_contact", "one_sticker", "sticker_all_scripts", "scan_qr_lookup", "fm_store_check", "printer_tester", "seller_website", "blacklist", "account_limits_v2", "shopee_public", "invoicing"];
await as("authenticated", A, async () => {
  const a = (await q1(`select public.my_feature_access() as r`)).r;
  ok(JSON.stringify(Object.keys(a).sort()) === JSON.stringify([...keysBefore, "waybill_username"].sort()), "my_feature_access answers the live 29 keys + 'waybill_username' (30)");
  ok(a.waybill_username === false && a.blacklist === true && a.invoicing === false, "not listed → waybill_username false; the other keys answer as before");
});
await db.exec(`insert into public.feature_access_emails values ('waybill_username', 'b@example.com', false)`);
await as("authenticated", B, async () => {
  const b = (await q1(`select public.my_feature_access() as r`)).r;
  ok(b.waybill_username === true && b.invoicing === true, "a listed login → waybill_username true (and its other keys as before)");
});
await as("authenticated", A, async () => ok((await q1(`select public.my_feature_access() as r`)).r.waybill_username === false, "… and only that login"));
await as("anon", null, async () => {
  const r = (await q1(`select public.my_feature_access() as r`)).r;
  ok(r.waybill_username === false, "not signed in → false");
});

// ── rollback ──
await db.exec(`create or replace function public.my_feature_access() returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;`);
await refused(DOWN, "rollback refuses when my_feature_access was changed after sql/231", "roll that file back first");
await db.exec(UP.replace(/do \$guard\$[\s\S]*?end \$guard\$;/, "")); // put the new text back (no guard: the stand-in above is not a known text)
ok(await md5of("my_feature_access") === NEW, "(the new text is back for the rollback test)");
await db.exec(DOWN);
ok(true, "the rollback applies");
ok(await md5of("my_feature_access") === LIVE, "the rollback restores production's my_feature_access text (md5)");
ok((await q1(`select count(*)::int c from public.app_settings where key='waybill_username_enabled'`)).c === 0, "the rollback removes the switch row");
ok((await q1(`select count(*)::int c from public.feature_access_emails where feature='waybill_username'`)).c === 0, "the rollback removes the preview logins of 'waybill_username'");
ok(await settings() === settingsBefore && await emails() === emailsBefore, "after the rollback app_settings and the preview list are exactly as before sql/231");
await db.exec(UP);
ok(await md5of("my_feature_access") === NEW, "the file applies again after the rollback");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
