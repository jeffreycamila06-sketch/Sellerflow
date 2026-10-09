// Runs sql/112 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of the live
// schema and checks my_feature_access(): booleans only, the signed-in user's LOGIN email,
// exact + prefix match, nothing for anon / no session, the list unreadable by browser roles.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg112 && cd /tmp/pg112 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql112-behaviour.mjs . && node sql112-behaviour.mjs <repo>/sql/112_feature_access.sql <repo>/sql/112_feature_access_rollback.sql
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
alter default privileges in schema public grant all on tables to anon, authenticated;
create schema auth;
create table auth.users(id uuid primary key, email text);
grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.seller_profiles(auth_user_id uuid primary key, email text);
`);
let n = 0;
async function user(loginEmail, profileEmail = loginEmail) {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await q("insert into auth.users values ($1,$2)", [id, loginEmail]);
  await q("insert into public.seller_profiles values ($1,$2)", [id, profileEmail]);
  return id;
}
async function as(role, uid, sql) {
  await db.exec(`set role ${role}`);
  await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || ""]);
  try { return await q(sql); } finally { await db.exec("reset role"); }
}
const access = async (uid) => (await as("authenticated", uid, "select public.my_feature_access() as a")).rows[0].a;

await db.exec(readFileSync(fwd, "utf8"));
const KEYS = ["fb_preview", "kiosk_launcher", "parcel_check", "parcel_cap_tester", "pin_print", "sticker_v2", "sticker_spacing", "session_v2", "session_numbering_fix", "shopee_preview", "live_source", "classic_text"];

const META = await user("test@gmail.com");
const TESTER = await user("GoogleTest@Gmail.com ");          // case + space in the login email
const BUDGET = await user("budgetukay77@gmail.com");          // prefix rule
const NOBODY = await user("random.seller@gmail.com");
const SPOOF = await user("random2@gmail.com", "test@gmail.com"); // profile email set to a listed one

const a = await access(META);
ok(JSON.stringify(Object.keys(a).sort()) === JSON.stringify([...KEYS].sort()), "every key, nothing else");
ok(Object.values(a).every((v) => typeof v === "boolean"), "booleans only");
ok(a.fb_preview === true && a.session_v2 === false, "test@gmail.com keeps fb_preview (Meta review), nothing else");
const t = await access(TESTER);
ok(t.fb_preview && t.kiosk_launcher && t.parcel_check && t.parcel_cap_tester && t.pin_print && t.sticker_v2 && t.sticker_spacing && t.session_numbering_fix && !t.session_v2, "googletest: same flags as the old lists");
ok((await access(BUDGET)).pin_print === true, "budgetukay* prefix → pin_print");
ok((await access(BUDGET)).parcel_check === false, "prefix only where is_prefix");
ok(Object.values(await access(NOBODY)).every((v) => v === false), "unlisted seller → all false");
ok(Object.values(await access(SPOOF)).every((v) => v === false), "profile email is ignored (login email only)");
ok(Object.values(await access("")).every((v) => v === false), "no session → all false");

let denied = false;
try { await as("anon", "", "select public.my_feature_access()"); } catch { denied = true; }
ok(denied, "anon cannot call it");
denied = false;
try { await as("authenticated", META, "select * from public.feature_access_emails"); } catch { denied = true; }
ok(denied, "the list itself is not readable by authenticated");
denied = false;
try { await as("authenticated", META, "insert into public.feature_access_emails(feature,email) values ('session_v2','test@gmail.com')"); } catch { denied = true; }
ok(denied, "and not writable");

const md5 = (await q("select md5(prosrc) as m from pg_proc where proname = 'my_feature_access'")).rows[0].m;
console.log("md5(prosrc) my_feature_access =", md5);

await db.exec(readFileSync(back, "utf8"));
ok((await q("select count(*)::int as c from pg_proc where proname = 'my_feature_access'")).rows[0].c === 0, "rollback drops the function");
ok((await q("select to_regclass('public.feature_access_emails') is null as gone")).rows[0].gone === true, "rollback drops the table");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
