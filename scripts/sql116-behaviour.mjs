// Runs sql/116 (+ its rollback) on a real Postgres (PGlite, WASM) against a stub of the live
// schema and checks the help-bot tables, RLS, matching, queues and "Admin answered" scoping.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   mkdir /tmp/pg116 && cd /tmp/pg116 && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/scripts/sql116-behaviour.mjs . && node sql116-behaviour.mjs <repo>/sql
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const throws = async (fn, m) => { try { await fn(); ok(false, m); } catch { ok(true, m); } };

await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema extensions; create extension pg_trgm schema extensions;
grant usage on schema extensions to authenticated, service_role;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('t.admin', true), '') = '1' $$;
create table public.app_settings(key text primary key, value text not null);
grant usage on schema public to anon, authenticated, service_role;
`);
await db.exec(readFileSync(`${dir}/112_feature_access.sql`, "utf8"));
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [alice, bob, gt, admin] = [U(1), U(2), U(3), U(4)];
for (const [id, e] of [[alice, "alice@x.com"], [bob, "bob@x.com"], [gt, "googletest@gmail.com"], [admin, "boss@x.com"]])
  await db.query("insert into auth.users values ($1,$2)", [id, e]);

await db.exec(readFileSync(`${dir}/116_help_bot.sql`, "utf8"));

// run as a role with a user + admin flag
async function as(role, uid, isAdmin, fn) {
  await db.exec(`set t.uid = '${uid || ""}'; set t.admin = '${isAdmin ? "1" : ""}'; set role ${role};`);
  try { return await fn(); } finally { await db.exec("reset role; set t.uid = ''; set t.admin = '';"); }
}
const q = (s, p) => db.query(s, p);
const one = async (s, p) => (await q(s, p)).rows[0];

// ── switches + preview ──
const sw = Object.fromEntries((await q("select key, value from app_settings")).rows.map((r) => [r.key, r.value]));
ok(sw.support_ai_enabled === "false" && sw.support_ai_monthly_cap_usd === "15" && sw.support_ai_daily_per_seller === "20", "switch seeds");
ok((await as("authenticated", gt, false, () => one("select my_feature_access()->>'support_ai_preview' v"))).v === "true", "googletest is in preview");
ok((await as("authenticated", alice, false, () => one("select my_feature_access()->>'support_ai_preview' v"))).v === "false", "alice is not in preview");
ok((await as("authenticated", alice, false, () => one("select my_feature_access()->>'classic_text' v"))).v === "false", "old keys still answered");

// ── server writes (service role) ──
const ins = async (o) => (await q(
  `insert into support_chats (user_id, question, answer, source, faq_id, lang, cost_usd, needs_admin, seller_rating, created_at)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9, coalesce($10, now())) returning id`,
  [o.user, o.q, o.a ?? null, o.src, o.faq ?? null, o.lang ?? "en", o.cost ?? 0, o.needs ?? null, o.rating ?? 0, o.at ?? null])).rows[0].id;
await throws(() => as("authenticated", alice, false, () => q("insert into support_chats (user_id, question, source) values ($1,'x','ai')", [alice])), "seller cannot insert a chat");
await throws(() => as("authenticated", alice, false, () => q("update support_chats set review_status='approved'")), "seller cannot update chats directly");
await throws(() => q("insert into support_chats (user_id, question, source) values ($1,'x','other')", [alice]), "source check");
await throws(() => q("insert into support_chats (user_id, question, source) values ($1,$2,'ai')", [alice, "x".repeat(501)]), "question max 500");

const a1 = await ins({ user: alice, q: "How do I print a test sticker?", a: "Settings → Printer → Test print.", src: "ai", cost: 0.004 });
const a2 = await ins({ user: alice, q: "Can I get a refund?", a: "[handoff]", src: "handoff", needs: "billing" });
const b1 = await ins({ user: bob, q: "Why no comments?", a: "Close and reopen.", src: "ai", rating: 1, cost: 0.003 });
const b2 = await ins({ user: bob, q: "Does it work on Shopee?", a: "The guide doesn't cover that.", src: "ai", needs: "not_covered" });

// ── no direct table reads for any browser role (model, cost, review notes stay hidden) ──
for (const t of ["support_chats", "support_faq"]) {
  for (const [role, uid, adm, who] of [["authenticated", alice, false, "seller"], ["authenticated", admin, true, "admin"], ["anon", null, false, "anon"]]) {
    await throws(() => as(role, uid, adm, () => q(`select * from ${t}`)), `${who} direct select on ${t} is denied`);
  }
}

// ── rating ──
ok((await as("authenticated", alice, false, () => one("select support_rate($1, -1::smallint) r", [a1]))).r === true, "rate own chat");
ok((await as("authenticated", alice, false, () => one("select support_rate($1, 1::smallint) r", [b1]))).r === false, "cannot rate another seller's chat");
ok((await one("select seller_rating r from support_chats where id=$1", [b1])).r === 1, "bob's rating untouched");
ok((await as("authenticated", alice, false, () => one("select support_rate($1, 1::smallint) r", [a2]))).r === false, "cannot rate a handoff");
await q("update support_chats set seller_rating=0 where id=$1", [a1]);

// ── usage ──
await throws(() => as("authenticated", alice, false, () => q("select support_usage($1)", [alice])), "sellers cannot call support_usage");
const u = await as("service_role", null, false, () => one("select support_usage($1) u", [alice]));
ok(Number(u.u.day_count) === 1 && Math.abs(Number(u.u.month_cost) - 0.007) < 1e-9, "usage: day count (AI only) + month cost (all)");
await ins({ user: alice, q: "old", a: "x", src: "ai", cost: 1, at: new Date(Date.now() - 40 * 864e5).toISOString() });
const u2 = await one("select support_usage($1) u", [alice]);
ok(Number(u2.u.day_count) === 1 && Math.abs(Number(u2.u.month_cost) - 0.007) < 1e-9, "usage ignores last month");

// ── admin queues ──
await throws(() => as("authenticated", alice, false, () => q("select * from admin_support_queue('approve',0)")), "seller cannot open the queue");
const qa = await as("authenticated", admin, true, () => q("select * from admin_support_queue('approve',0)"));
ok(qa.rows[0]?.id === b1 && qa.rows.map((r) => r.id).includes(a1) && !qa.rows.map((r) => r.id).includes(b2), "approve tab: 👍 first, not-covered excluded");
const qb = await as("authenticated", admin, true, () => q("select * from admin_support_queue('answer',0)"));
ok(qb.rows.map((r) => r.id).sort().join() === [a2, b2].sort().join(), "answer tab: billing + not covered");
// batch of 10
for (let i = 0; i < 12; i++) await ins({ user: bob, q: `q${i}`, a: `a${i}`, src: "ai", at: new Date(Date.now() - (i + 1) * 60e3).toISOString() });
const page1 = await as("authenticated", admin, true, () => q("select * from admin_support_queue('approve',0)"));
ok(page1.rows.length === 10 && Number(page1.rows[0].total) === 15, "approve tab is batches of 10");

// ── approve batch ──
const items = [
  { id: b1, ok: true, save_faq: true },
  { id: a1, ok: true, save_faq: true, answer: "Settings → Printer → Test print. (edited)" },
  { id: page1.rows[2].id, ok: false, save_faq: true },
  { id: page1.rows[3].id, ok: true, save_faq: false },
];
const n = await as("authenticated", admin, true, () => one("select admin_support_approve_batch($1::jsonb) n", [JSON.stringify(items)]));
ok(n.n === 4, "approve batch reviewed 4");
const st = Object.fromEntries((await q("select id, review_status from support_chats")).rows.map((r) => [r.id, r.review_status]));
ok(st[b1] === "approved" && st[a1] === "edited" && st[page1.rows[2].id] === "wrong" && st[page1.rows[3].id] === "approved", "statuses after approve batch");
const faqs = (await q("select question, answer, from_chat_id from support_faq order by id")).rows;
ok(faqs.length === 2 && faqs.some((f) => f.answer.endsWith("(edited)")), "FAQ: one per ✅+Save, edited text kept, none for ❌ or Save off");
ok((await as("authenticated", admin, true, () => one("select admin_support_approve_batch($1::jsonb) n", [JSON.stringify(items)]))).n === 0, "approve batch is idempotent");

// ── answer batch ──
const ans = [{ id: a2, answer: "Message Admin on Telegram for refunds.", save_faq: false }, { id: b2, answer: "  ", save_faq: true }];
ok((await as("authenticated", admin, true, () => one("select admin_support_answer_batch($1::jsonb) n", [JSON.stringify(ans)]))).n === 1, "answer batch: 1 saved, empty skipped");
const qb2 = await as("authenticated", admin, true, () => q("select id from admin_support_queue('answer',0)"));
ok(qb2.rows.length === 1 && qb2.rows[0].id === b2, "skipped question stays in Tab B");
ok((await q("select count(*)::int c from support_faq")).rows[0].c === 2, "Save as FAQ off → no FAQ");
await as("authenticated", admin, true, () => q("select admin_support_answer_batch($1::jsonb)", [JSON.stringify([{ id: b2, answer: "Not yet.", save_faq: true }])]));
ok((await q("select count(*)::int c from support_faq")).rows[0].c === 3, "Save as FAQ on → FAQ");

// ── "Admin answered" only to the right seller ──
const aliceAns = await as("authenticated", alice, false, () => q("select * from support_admin_answers()"));
ok(aliceAns.rows.length === 1 && aliceAns.rows[0].id === a2 && aliceAns.rows[0].seen === false, "alice gets her admin answer, unseen");
const bobAns = await as("authenticated", bob, false, () => q("select * from support_admin_answers()"));
ok(bobAns.rows.length === 1 && bobAns.rows[0].id === b2, "bob gets only his own admin answer");
ok((await as("authenticated", gt, false, () => q("select * from support_admin_answers()"))).rows.length === 0, "a third seller sees none");
ok((await as("authenticated", alice, false, () => one("select support_admin_answers_seen() n"))).n === 1, "alice marks hers seen");
ok((await as("authenticated", bob, false, () => q("select seen from support_admin_answers()"))).rows[0].seen === false, "bob's stays unseen");

// ── matching ──
await q("update support_faq set enabled=false where answer='Not yet.'");
const m = await as("service_role", null, false, () => q("select * from support_faq_match($1)", ["how do i print a test sticker"]));
ok(m.rows.length === 1 && m.rows[0].sim >= 0.6, "trigram match ≥ 0.6 (case/punct ignored)");
ok((await q("select * from support_faq_match($1)", ["what is the weather today"])).rows.length === 0, "unrelated question → no match");
ok((await q("select * from support_faq_match($1)", ["Does it work on Shopee"])).rows.length === 0, "disabled FAQ never matches");
await throws(() => as("authenticated", alice, false, () => q("select * from support_faq_match('x')")), "sellers cannot call faq_match");

// ── admin FAQ list RPC ──
ok((await as("authenticated", admin, true, () => q("select * from admin_support_faq_list()"))).rows.length === 3, "admin FAQ list via RPC");
await throws(() => as("authenticated", alice, false, () => q("select * from admin_support_faq_list()")), "seller cannot call admin FAQ list");

// ── guide table: seed (sql/116b), no browser access, trigger marks needs_recheck ──
const { buildGuideSql } = await import(`${dir}/../scripts/sync-guide.mjs`);
const md = readFileSync(`${dir}/../docs/support/sfl-guide.md`, "utf8");
await db.exec(readFileSync(`${dir}/116b_guide_seed.sql`, "utf8"));
const nSections = (await one("select count(*)::int c from support_guide")).c;
ok(nSections > 20, "seed loads every guide section");
ok((await one("select count(*)::int c from support_guide where body ~ 'UNSURE:'")).c === 0, "no UNSURE lines in the table");
for (const [role, uid, adm, who] of [["authenticated", alice, false, "seller"], ["authenticated", admin, true, "admin"], ["anon", null, false, "anon"]])
  await throws(() => as(role, uid, adm, () => q("select * from support_guide")), `${who} cannot read support_guide`);
await q("update support_faq set guide_sections='{printer-bluetooth}' where answer like '%edited%'");
const before = (await one("select max(updated_at)::text t from support_guide")).t;
await db.exec(readFileSync(`${dir}/116b_guide_seed.sql`, "utf8"));
ok((await one("select max(updated_at)::text t from support_guide")).t === before, "re-applying the same seed changes nothing");
ok((await one("select count(*)::int c from support_faq where needs_recheck")).c === 0, "…and marks nothing");
await q("update support_guide set body = body || ' more' where id='printer-bluetooth'");
ok((await one("select count(*)::int c from support_faq where needs_recheck")).c === 0, "body change without a new date → no recheck");
await db.exec(buildGuideSql(md.replace(/(## printer-bluetooth[^\n]*\nLast checked: )\S+/, "$12026-12-01")));
ok((await one("select checked::text d from support_guide where id='printer-bluetooth'")).d === "2026-12-01", "new date upserted");
ok((await one("select count(*)::int c from support_faq where needs_recheck")).c === 1, "changed Last checked → linked FAQ needs recheck");
ok((await q("select * from support_faq_match($1)", ["how do i print a test sticker"])).rows.length === 0, "needs-recheck FAQ is not served");
const fid = (await one("select id from support_faq where needs_recheck")).id;
await as("authenticated", admin, true, () => q("select admin_support_faq_update($1, null, $2, null)", [fid, "Settings → Printer → Test print."]));
ok((await one("select needs_recheck r from support_faq where id=$1", [fid])).r === false, "admin edit clears recheck");
await throws(() => as("authenticated", alice, false, () => q("select admin_support_faq_update($1, null, 'x', null)", [fid])), "seller cannot edit FAQ");
// a section removed from the guide file is deleted, and its FAQ is marked
const noBt = md.replace(/## printer-bluetooth[\s\S]*?(?=\n## )/, "");
await db.exec(buildGuideSql(noBt));
ok((await one("select count(*)::int c from support_guide")).c === nSections - 1, "removed section deleted from the table");
ok((await one("select needs_recheck r from support_faq where id=$1", [fid])).r === true, "deleted section → linked FAQ needs recheck");
await db.exec(buildGuideSql(md));
await q("update support_faq set needs_recheck=false");

// ── quick questions + stats ──
await q("update support_chats set faq_id=$1 where id=$2", [fid, b1]);
const qq = await as("authenticated", alice, false, () => q("select * from support_quick_questions('en', 6)"));
ok(qq.rows.length >= 1 && qq.rows.length <= 6, "quick questions from enabled FAQ");
const s = await as("authenticated", admin, true, () => one("select admin_support_stats() s"));
ok(Number(s.s.cap_usd) === 15 && Number(s.s.handoff) === 1 && Number(s.s.ai) >= 3, "admin stats");
await throws(() => as("authenticated", alice, false, () => q("select admin_support_stats()")), "seller cannot read stats");

// ── delete cascade + rollback ──
await q("delete from auth.users where id=$1", [alice]);
ok((await q("select count(*)::int c from support_chats where user_id=$1", [alice])).rows[0].c === 0, "deleting the user removes their chats");
await db.exec(readFileSync(`${dir}/116_help_bot_rollback.sql`, "utf8"));
ok((await q("select to_regclass('public.support_chats') t")).rows[0].t === null, "rollback drops tables");
ok((await q("select count(*)::int c from app_settings where key like 'support_%'")).rows[0].c === 0, "rollback removes switches");
ok((await as("authenticated", gt, false, () => one("select my_feature_access() ? 'support_ai_preview' v"))).v === false, "rollback restores my_feature_access");

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
