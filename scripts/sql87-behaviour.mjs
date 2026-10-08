// Runs sql/84 → sql/85 → sql/87 (+ sql/87's rollback) on a real Postgres (PGlite, WASM)
// against a stub of the live schema and checks every Instagram rule of the account total:
// TikTok / Facebook / Shopee answers identical before and after 87, IG counting + triggers +
// ranking (tie-break instagram 4) + live check + coverage + quota, RLS / column grants on
// ig_accounts, each section alone and twice, and the rollback (refusal + verbatim restore).
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg87 && cd /tmp/pg87 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql87-behaviour.mjs . && node sql87-behaviour.mjs <repo>/sql/84_account_total.sql <repo>/sql/85_account_live.sql <repo>/sql/87_account_instagram.sql <repo>/sql/87_account_instagram_rollback.sql
// Also re-run the sql84 / sql85 scripts with 87 loaded (see the report for the exact files).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const [,, f84, f85, f87, back87] = process.argv;
const src = (f) => readFileSync(f, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const STUB = `
create role anon; create role authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.seller_profiles(auth_user_id uuid primary key references auth.users(id) on delete cascade, email text, plan text, role text default 'seller', tiktok text, facebook text, store_name text, created_at timestamptz not null default now());
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.seller_profiles where auth_user_id = auth.uid() and role='admin') $$;
create table public.fb_pages(id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, page_id text not null, page_name text, access_token text, created_at timestamptz not null default now(), unique(user_id,page_id));
create table public.shopee_shops(id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, shop_id bigint not null, shop_name text, created_at timestamptz not null default now(), unique(user_id,shop_id));
create table public.app_settings(key text primary key, value text not null);
create table public.tiktok_account_changes(user_id uuid, platform text, slot_index smallint, last_changed_at timestamptz, primary key(user_id,platform,slot_index));
grant all on public.tiktok_account_changes to authenticated, anon;
create function public.touch_tiktok_slot(p_platform text, p_slot_index smallint) returns timestamptz language plpgsql as $$ begin return now(); end $$;
-- sql/84 seeds account_limit_exempt for the owner test account (FK to auth.users).
insert into auth.users values ('880a7987-f1b5-4970-82d0-06938cefd4f6');
`;

async function fresh() { const db = new PGlite(); await db.exec(STUB); return db; }
function helpers(db) {
  const q = (s, p) => db.query(s, p);
  let n = 0;
  const user = async (plan, tiktok, role = "seller") => {
    const id = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
    await q("insert into auth.users values ($1)", [id]);
    await q("insert into seller_profiles(auth_user_id, plan, role, tiktok, created_at) values ($1,$2,$3,$4,'2026-07-01')", [id, plan, role, tiktok]);
    return id;
  };
  const as = async (uid, fn, role = null) => {
    await db.exec(`set request.jwt.claim.sub = '${uid}'${role ? `; set role ${role}` : ""}`);
    try { return await fn(); } finally { await db.exec(`${role ? "reset role; " : ""}reset request.jwt.claim.sub`); }
  };
  const sw = (k, v) => v == null ? q("delete from app_settings where key=$1", [k]) : q("insert into app_settings values ($1,$2) on conflict (key) do update set value=excluded.value", [k, v]);
  const try_ = async (fn) => { try { await fn(); return "ok"; } catch (e) { return e.message; } };
  return { q, user, as, sw, try_ };
}

// ── A) TikTok / Facebook / Shopee answers are identical before and after sql/87 ─────
{
  const db = await fresh(); const { q, user, as, sw } = helpers(db);
  await db.exec(src(f84)); await db.exec(src(f85));
  const ids = [];
  ids.push(await user("basic", "a,b,c"));                      // over limit, TikTok only
  const tp = await user("plus", "t"); ids.push(tp);
  await q("insert into fb_pages(user_id,page_id) values ($1,'P1')", [tp]);
  const sh = await user("pro", null); ids.push(sh);
  for (const s of [11, 22]) await q("insert into shopee_shops(user_id,shop_id) values ($1,$2)", [sh, s]);
  await q("delete from shopee_shops where user_id=$1 and shop_id=22", [sh]);   // a vacated seat
  const snapshot = async () => {
    const out = [];
    for (const enf of [null, "true"]) {
      await sw("account_live_enforce", enf);
      for (const u of ids) {
        out.push(await as(u, async () => (await q("select account_quota() j")).rows[0].j));
        out.push(await as(u, async () => (await q("select account_live_coverage() j")).rows[0].j));
        for (const [p, k] of [["tiktok", "a"], ["tiktok", "b"], ["tiktok", "t"], ["facebook", "P1"], ["shopee", "11"]])
          out.push(await as(u, async () => (await q("select account_live_check($1,$2) j", [p, k])).rows[0].j));
        out.push((await q("select platform, account_key, rank from account_live_ranking($1) order by rank", [u])).rows);
      }
    }
    await sw("account_live_enforce", null);
    // account_quota gains an 'instagram' key in 87 — compare without it.
    return JSON.stringify(out, (k, v) => (k === "instagram" ? undefined : v));
  };
  const before = await snapshot();
  await db.exec(src(f87)); await db.exec(src(f87));
  ok(before === await snapshot(), "TikTok / Facebook / Shopee answers identical after sql/87 (run twice)");
  ok((await as(ids[0], async () => (await q("select account_quota() j")).rows[0].j)).instagram === 0, "account_quota reports instagram: 0 for a seller with none");
  // a new Page / shop / TikTok name is checked exactly as before
  await sw("account_total_enforce", "true");
  const r = await (async () => { try { await q("insert into fb_pages(user_id,page_id) values ($1,'P2')", [ids[0]]); return "ok"; } catch (e) { return e.message; } })();
  ok(/account_limit/.test(r), "a new Facebook Page over the limit is still refused");
  await sw("account_total_enforce", null);
}

// ── B) Instagram rules ───────────────────────────────────────────────────────
const db = await fresh(); const { q, user, as, sw, try_ } = helpers(db);
await db.exec(src(f84)); await db.exec(src(f85)); await db.exec(src(f87));
const ig = (u, id) => q("insert into ig_accounts(user_id, ig_user_id, ig_username) values ($1,$2,$3)", [u, id, `n${id}`]);
const reauth = (u, id) => q("insert into ig_accounts(user_id, ig_user_id, ig_username) values ($1,$2,'renamed') on conflict (user_id, ig_user_id) do update set ig_username = excluded.ig_username", [u, id]);
const seat = async (u, id) => (await q("select * from account_seats where user_id=$1 and platform='instagram' and account_key=$2", [u, id])).rows[0];

ok((await q("select value from app_settings where key='ig_enabled'")).rows[0]?.value === "false", "ig_enabled seeded 'false'");

// counting + enforce
const BASIC = await user("basic", "a");
await sw("account_total_enforce", "true");
ok(/account_limit/.test(await try_(() => ig(BASIC, "1001"))), "Basic with 1 TikTok: a new IG account is refused (enforcing)");
ok((await q("select count(*)::int c from ig_accounts where user_id=$1", [BASIC])).rows[0].c === 0, "…and nothing was written");
await sw("account_total_enforce", null);
ok((await try_(() => ig(BASIC, "1001"))) === "ok", "log-only: the IG account is saved");
ok((await q("select would_block from account_limit_log where user_id=$1 and platform='instagram'", [BASIC])).rows[0]?.would_block === "over_total", "log-only: logged over_total");
ok((await q("select account_total_used($1) v", [BASIC])).rows[0].v === 2, "account_total_used counts the IG account");
ok((await as(BASIC, async () => (await q("select account_quota() j")).rows[0].j)).instagram === 1, "account_quota: instagram 1");
ok((await as(BASIC, async () => (await q("select account_quota() j")).rows[0].j)).used === 2, "account_quota: used 2");

const PLUS = await user("plus", "a");
await sw("account_total_enforce", "true");
ok((await try_(() => ig(PLUS, "2001"))) === "ok", "Plus with TikTok + IG: allowed");
ok(/account_limit/.test(await try_(() => ig(PLUS, "2002"))), "Plus: a third account (2nd IG) refused");
ok((await try_(() => reauth(PLUS, "2001"))) === "ok", "re-authorizing an existing IG account passes even at the limit");
ok((await q("select ig_username from ig_accounts where user_id=$1 and ig_user_id='2001'", [PLUS])).rows[0].ig_username === "renamed", "re-authorization updated the row");

// delete → vacated seat (key = ig_user_id); replacement → locked
await q("delete from ig_accounts where user_id=$1 and ig_user_id='2001'", [PLUS]);
const s = await seat(PLUS, "2001");
ok(s && s.removed_at && !s.replaced_at, "deleting the IG row vacates its seat, keyed by ig_user_id");
ok((await try_(() => ig(PLUS, "2003"))) === "ok", "a new IG account may take the vacated seat");
ok((await seat(PLUS, "2003")).lock_until !== null, "…as a replacement (locked)");
ok((await seat(PLUS, "2001")).replaced_at !== null, "…and the old seat is marked replaced");
await q("delete from ig_accounts where user_id=$1 and ig_user_id='2003'", [PLUS]);
ok(/account_limit/.test(await try_(() => ig(PLUS, "2004"))), "during the replacement lock the seat still counts (refused)");
await sw("account_total_enforce", null);

// ranking + tie-break + live check + coverage
const MIX = await user("plus", "t");
await q("insert into fb_pages(user_id,page_id) values ($1,'P9')", [MIX]);
await q("insert into shopee_shops(user_id,shop_id) values ($1,99)", [MIX]);
await ig(MIX, "3001");
await q("update account_seats set added_at='2026-08-01' where user_id=$1", [MIX]);   // all tied
const rank = (await q("select platform, rank from account_live_ranking($1) order by rank", [MIX])).rows.map((r) => r.platform);
ok(JSON.stringify(rank) === JSON.stringify(["tiktok", "facebook", "shopee", "instagram"]), `tie-break tiktok 1, facebook 2, shopee 3, instagram 4 (${rank})`);
await sw("account_live_enforce", "true");
const chk = await as(MIX, async () => (await q("select account_live_check('instagram','3001') j")).rows[0].j);
ok(chk.allowed === false && chk.rank === 4 && chk.limit === 2, "account_live_check('instagram'): rank 4 of limit 2 → refused (enforcing)");
const chkTt = await as(MIX, async () => (await q("select account_live_check('tiktok','t') j")).rows[0].j);
ok(chkTt.allowed === true && chkTt.rank === 1, "the TikTok account keeps rank 1");
const cov = await as(MIX, async () => (await q("select account_live_coverage() j")).rows[0].j);
ok(cov.accounts.some((a) => a.platform === "instagram" && a.key === "3001" && a.covered === false), "coverage lists the IG account, not covered");
const unknownIg = await as(MIX, async () => (await q("select account_live_check('instagram','nope') j")).rows[0].j);
ok(unknownIg.allowed === true && unknownIg.registered === false, "an unknown IG id passes the check (the route checks the row)");
await q("update account_seats set added_at = added_at - interval '1 day' where user_id=$1 and platform='instagram'", [MIX]);
ok((await as(MIX, async () => (await q("select account_live_check('instagram','3001') j")).rows[0].j)).allowed === true, "an older IG account is covered");
await sw("account_live_enforce", null);

// RLS + column grants
const OTHER = await user("plus", null);
await ig(OTHER, "4001");
await q("update ig_accounts set access_token='secret' where user_id=$1", [OTHER]);
const seen = await as(OTHER, async () => (await q("select ig_user_id from ig_accounts")).rows.map((r) => r.ig_user_id), "authenticated");
ok(JSON.stringify(seen) === '["4001"]', `a seller sees only their own IG rows (${seen})`);
ok(/permission denied/.test(await as(OTHER, () => try_(() => q("select access_token from ig_accounts")), "authenticated")), "a seller cannot read access_token");
ok(/permission denied/.test(await as(OTHER, () => try_(() => q("insert into ig_accounts(user_id, ig_user_id) values ($1,'x')", [OTHER])), "authenticated")), "a seller cannot insert");
ok(/permission denied/.test(await as(OTHER, () => try_(() => q("update ig_accounts set active=false")), "authenticated")), "a seller cannot update");
await as(MIX, () => q("delete from ig_accounts where ig_user_id='4001'"), "authenticated");
ok((await q("select count(*)::int c from ig_accounts where ig_user_id='4001'")).rows[0].c === 1, "a seller cannot delete another seller's row");
await as(OTHER, () => q("delete from ig_accounts where ig_user_id='4001'"), "authenticated");
ok((await q("select count(*)::int c from ig_accounts where ig_user_id='4001'")).rows[0].c === 0, "a seller can delete their own row");
ok(/permission denied/.test(await as(OTHER, () => try_(() => q("select email from ig_tester_access")), "authenticated")), "ig_tester_access: no client access");
ok(/permission denied/.test(await as(OTHER, () => try_(() => q("select ig_user_id from ig_accounts")), "anon")), "anon: no access to ig_accounts");

// ── C) each section alone and twice; forward-file rules ─────────────────────
{
  const fwd = src(f87);
  ok(!/drop\s+\w+\s+if\s+exists/i.test(fwd), "forward file: no 'drop … if exists'");
  ok(!/\\u[0-9a-f]{4}/i.test(fwd + src(back87)), "no backslash-u escapes");
  const sections = fwd.split(/^-- ── /m).slice(1).map((x) => "-- ── " + x);
  ok(sections.length === 7, `7 sections (${sections.length})`);
  for (const [i, s] of sections.entries()) {
    const d = await fresh(); await d.exec(src(f84)); await d.exec(src(f85));
    if (i > 0) await d.exec(sections[0]);                 // later sections use section 1's table
    const r = await (async () => { try { await d.exec(s); await d.exec(s); return "ok"; } catch (e) { return e.message; } })();
    ok(r === "ok", `section ${i + 1} alone, twice: ${r}`);
  }
  ok((await try_(() => db.exec(src(f87)))) === "ok", "the whole file again on the used database");
  await sw("ig_enabled", "true");
  await db.exec(src(f87));
  ok((await q("select value from app_settings where key='ig_enabled'")).rows[0].value === "true", "re-running never switches ig_enabled back off");
}

// ── D) rollback ──────────────────────────────────────────────────────────────
{
  const refuse = await try_(() => db.exec(src(back87)));
  ok(/rollback refused/.test(refuse), "rollback refuses while instagram seat rows exist");
  await db.exec("rollback");   // the refused file left its transaction open (psql ends it itself)
  ok((await q("select count(*)::int c from pg_tables where tablename='ig_accounts'")).rows[0].c === 1, "…and changed nothing");
  await q("delete from account_seats where platform='instagram'");
  await db.exec(src(back87)); await db.exec(src(back87));
  ok((await q("select count(*)::int c from pg_tables where tablename in ('ig_accounts','ig_tester_access')")).rows[0].c === 0, "rollback: IG tables gone (twice is safe)");
  ok((await q("select count(*)::int c from app_settings where key='ig_enabled'")).rows[0].c === 0, "rollback: ig_enabled gone");
  ok(!/instagram/.test((await q("select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.account_seats'::regclass and contype='c'")).rows.map((r) => r.d).join()), "rollback: 3-platform CHECK back");
  const ref = await fresh(); await ref.exec(src(f84)); await ref.exec(src(f85));
  const def = async (d, f) => (await d.query(`select pg_get_functiondef(p.oid) v from pg_proc p where proname=$1`, [f])).rows[0].v;
  for (const f of ["account_total_used", "account_total_del_trg", "account_quota", "account_live_ranking"])
    ok(await def(db, f) === await def(ref, f), `rollback: ${f} identical to sql/84+85`);
  ok((await q("select count(*)::int c from pg_proc where proname='account_total_ig_ins_trg'")).rows[0].c === 0, "rollback: IG trigger function gone");
}

console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
