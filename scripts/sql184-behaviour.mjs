// Runs sql/184 (+ its rollback) on a real Postgres (PGlite, WASM) with rows shaped like the live
// table read on 2026-11-19 (全家: 70 × 全家店寄店取, 6 × C2C; plus 7-11 rows) and proves:
//   1. only 全家 rows whose ship_type is exactly 全家店寄店取 change, to 'C2C'
//   2. no 7-11 row changes (also one that carries the same text), no status / date / number changes
//   3. the helper table holds exactly the changed rows, and no browser role can read it
//   4. the rollback puts back exactly those rows (the 6 rows that were 'C2C' before stay 'C2C')
//   5. 184 applies again after the rollback; applying it with nothing to change is harmless
// Not part of CI (PGlite is not a dependency of the repo):
//   mkdir /tmp/pg184 && (cd /tmp/pg184 && npm i @electric-sql/pglite@0.2.17)
//   PGLITE_DIR=/tmp/pg184 node scripts/sql184-behaviour.mjs            (from the repo root)
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
async function loadPGlite() {
  try { return (await import("@electric-sql/pglite")).PGlite; } catch { /* PGLITE_DIR */ }
  const base = process.env.PGLITE_DIR ? resolve(process.env.PGLITE_DIR) : "";
  const entry = join(base, "node_modules", "@electric-sql", "pglite", "dist", "index.js");
  if (!base || !existsSync(entry)) {
    console.log("PGlite not found. Run: mkdir /tmp/pg184 && (cd /tmp/pg184 && npm i @electric-sql/pglite@0.2.17) — then PGLITE_DIR=/tmp/pg184 node scripts/sql184-behaviour.mjs");
    process.exit(2);
  }
  return (await import(pathToFileURL(entry).href)).PGlite;
}
const PGlite = await loadPGlite();
const dir = process.argv[2] || join(here, "..", "sql");
const src = (f) => readFileSync(`${dir}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create table public.parcel_tracking (
    id uuid primary key default gen_random_uuid(), user_id uuid not null, carrier text not null default '711',
    tracking_no text, status text not null default 'created', ship_type text, special_type text,
    picked_up_at timestamptz, pickup_deadline date, updated_at timestamptz not null default now() - interval '3 days');
  -- the table's own trigger: every update moves updated_at
  create function public.link_parcel_tracking() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
  create trigger trg_link_parcel_tracking before insert or update on public.parcel_tracking for each row execute function public.link_parcel_tracking();
`);
const U = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];
const add = (n, o) => db.exec(Array.from({ length: n }, (_, i) =>
  `insert into public.parcel_tracking (user_id, carrier, tracking_no, status, ship_type, special_type, picked_up_at, pickup_deadline)
   values ('${U[i % 2]}', '${o.carrier}', '${o.carrier === "fm" ? "1635174" + String(1000 + i) : "F83674" + String(100000 + i)}', '${o.status}', ${o.ship === null ? "null" : `'${o.ship}'`}, ${o.special ? `'${o.special}'` : "null"}, ${o.status === "picked_up" ? "now() - interval '2 days'" : "null"}, ${o.status === "at_store" ? "current_date + 5" : "null"});`).join("\n"));
// 全家, as live
await add(28, { carrier: "fm", status: "picked_up", ship: "全家店寄店取" });
await add(21, { carrier: "fm", status: "at_store", ship: "全家店寄店取" });
await add(21, { carrier: "fm", status: "in_transit", ship: "全家店寄店取" });
await add(6, { carrier: "fm", status: "in_transit", ship: "C2C" });
// 全家 rows the file must NOT touch
await add(2, { carrier: "fm", status: "at_store", ship: "宅配" });
await add(1, { carrier: "fm", status: "in_transit", ship: null });
await add(1, { carrier: "fm", status: "in_transit", ship: " 全家店寄店取 " });   // not exactly the text
// 7-11
await add(40, { carrier: "711", status: "at_store", ship: "C2C" });
await add(5, { carrier: "711", status: "at_store", ship: "C2C", special: "4.店到宅服務單" });
await add(7, { carrier: "711", status: "created", ship: null });
await add(1, { carrier: "711", status: "in_transit", ship: "全家店寄店取" });    // cannot happen; must still be left alone

const snap = async () => (await db.query(`select id, user_id, carrier, tracking_no, status, ship_type, special_type, picked_up_at::text as p, pickup_deadline::text as d from public.parcel_tracking order by id`)).rows;
const count = async (w) => Number((await db.query(`select count(*)::int as n from public.parcel_tracking where ${w}`)).rows[0].n);
const before = await snap();
const beforeById = new Map(before.map((r) => [r.id, r]));

// ── 1–3: apply
await db.exec(src("184_fm_ship_type_fix.sql"));
const after = await snap();
ok(after.length === before.length, "no row is added or removed");
ok(await count(`carrier = 'fm' and ship_type = '全家店寄店取'`) === 0, "no 全家 row keeps the text 全家店寄店取");
ok(await count(`carrier = 'fm' and ship_type = 'C2C'`) === 76, "70 changed + 6 that were C2C = 76 全家 rows with C2C");
let changed = 0, other = 0;
for (const r of after) {
  const b = beforeById.get(r.id);
  const { ship_type: s1, ...rest1 } = r; const { ship_type: s0, ...rest0 } = b;
  ok(JSON.stringify(rest1) === JSON.stringify(rest0), `only ship_type may change (row of carrier ${r.carrier}, status ${r.status})`);
  if (s1 !== s0) { changed += 1; ok(b.carrier === "fm" && s0 === "全家店寄店取" && s1 === "C2C", `a changed row was a 全家 全家店寄店取 row and is now C2C (was ${s0}, carrier ${b.carrier})`); } else other += 1;
}
ok(changed === 70, `exactly 70 rows changed (got ${changed})`);
ok(other === before.length - 70, "every other row is as it was");
ok(await count(`carrier = '711' and ship_type = '全家店寄店取'`) === 1, "a 7-11 row is never touched, whatever its text");
ok(await count(`carrier = 'fm' and ship_type = '宅配'`) === 2, "a 全家 home-delivery row keeps its words");
ok(await count(`carrier = 'fm' and ship_type is null`) === 1, "a 全家 row with no saved type is left alone");
ok(await count(`carrier = 'fm' and ship_type = ' 全家店寄店取 '`) === 1, "only the exact text is changed");
const helper = (await db.query(`select id, old_ship_type from public.parcel_tracking_fm_ship_type_184`)).rows;
ok(helper.length === 70 && helper.every((h) => h.old_ship_type === "全家店寄店取"), "the helper table holds the 70 changed rows with their old words");
ok(helper.every((h) => beforeById.get(h.id)?.ship_type === "全家店寄店取"), "every helper id is a row that carried the text");
const rls = (await db.query(`select relrowsecurity as on from pg_class where relname = 'parcel_tracking_fm_ship_type_184'`)).rows[0].on;
const pol = Number((await db.query(`select count(*)::int as n from pg_policies where tablename = 'parcel_tracking_fm_ship_type_184'`)).rows[0].n);
ok(rls === true && pol === 0, "row security is on with no policy: no browser access to the helper table");
for (const role of ["anon", "authenticated"]) {
  const g = Number((await db.query(`select count(*)::int as n from information_schema.role_table_grants where table_name = 'parcel_tracking_fm_ship_type_184' and grantee = '${role}'`)).rows[0].n);
  ok(g === 0, `${role} has no right on the helper table`);
}
// the picked-up rows keep their pickup time (the clean-up of picked-up rows goes by it)
ok(await count(`carrier = 'fm' and status = 'picked_up' and picked_up_at is null`) === 0, "picked-up rows keep their pickup time");

// applying twice is refused as a whole (the helper table exists) and changes nothing
let second = "";
try { await db.exec(src("184_fm_ship_type_fix.sql")); } catch (e) { second = String(e.message || e); }
ok(/already exists/.test(second), "a second apply stops at the helper table (nothing is changed twice)");
try { await db.exec("rollback"); } catch { /* no open transaction */ }
ok(JSON.stringify(await snap()) === JSON.stringify(after), "after the refused second apply every row is as after the first");

// ── 4: a row uploaded again after 184, a row deleted since, then the rollback
const again = helper[0].id, gone = helper[1].id;
await db.exec(`update public.parcel_tracking set status = 'picked_up' where id = '${again}'; delete from public.parcel_tracking where id = '${gone}';`);
await db.exec(src("184_fm_ship_type_fix_rollback.sql"));
const back = await snap();
ok(back.length === before.length - 1, "the rollback adds no row back (the deleted one stays deleted)");
ok(await count(`carrier = 'fm' and ship_type = '全家店寄店取'`) === 69, "69 of the 70 rows carry their old words again (1 was deleted)");
ok(await count(`carrier = 'fm' and ship_type = 'C2C'`) === 6, "the 6 全家 rows that were C2C before 184 are still C2C");
for (const r of back) {
  const b = beforeById.get(r.id);
  ok(r.ship_type === b.ship_type, `after the rollback a row has its ship_type of before 184 (${b.carrier} ${b.ship_type})`);
}
ok(Number((await db.query(`select count(*)::int as n from pg_class where relname = 'parcel_tracking_fm_ship_type_184'`)).rows[0].n) === 0, "the helper table is gone");

// ── 5: 184 applies again; with nothing to change it changes nothing
await db.exec(src("184_fm_ship_type_fix.sql"));
ok(await count(`carrier = 'fm' and ship_type = '全家店寄店取'`) === 0 && Number((await db.query(`select count(*)::int as n from public.parcel_tracking_fm_ship_type_184`)).rows[0].n) === 69, "184 applies again after the rollback (69 rows)");
await db.exec(src("184_fm_ship_type_fix_rollback.sql"));
await db.exec(`update public.parcel_tracking set ship_type = 'C2C' where carrier = 'fm' and ship_type = '全家店寄店取'`);
await db.exec(src("184_fm_ship_type_fix.sql"));
ok(Number((await db.query(`select count(*)::int as n from public.parcel_tracking_fm_ship_type_184`)).rows[0].n) === 0, "nothing to change → the helper table is empty and no row moves");

console.log(`${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
