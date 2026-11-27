// sql/235 (help guide, orders-search row): the Cancel line is added under Reprint, twice = once, the
// rollback gives the row back. Run: PGLITE_DIR=<folder with @electric-sql/pglite@0.2.17> node scripts/sql235-behaviour.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
const dir = process.env.PGLITE_DIR;
if (!dir) { console.error("set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.2.17` was run"); process.exit(2); }
const { PGlite } = createRequire(join(dir, "package.json"))("@electric-sql/pglite");
const db = new PGlite();
const body = "Open **Orders** in the bottom bar.\n\n- Each order has **↻ Reprint**. Tapping an order opens **Print** (**🖨 Print** / **🖨 Print all**).\n- **⬇ Export** downloads.";
await db.exec(`create table public.support_guide(id text primary key, body text, keywords text, checked date);`);
await db.query(`insert into public.support_guide values ('orders-search',$1,'orders, order list, search, find order, buyer, history, last 7 days, hanapin order, listahan, 订单, 訂單, 搜索, 查詢','2026-11-19'),('other','x','y','2026-01-01')`, [body]);
const up = readFileSync("sql/235_guide_order_cancel.sql","utf8"), down = readFileSync("sql/235_guide_order_cancel_rollback.sql","utf8");
await db.exec(up); const a = (await db.query(`select body, keywords from support_guide where id='orders-search'`)).rows[0];
await db.exec(up); const b = (await db.query(`select body, keywords from support_guide where id='orders-search'`)).rows[0];
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
ok(a.body.includes("**Cancel an order**") && a.body.indexOf("Reprint") < a.body.indexOf("Cancel an order") && a.body.indexOf("Cancel an order") < a.body.indexOf("Export"), "line added under Reprint");
ok(a.keywords.includes("cancel order") && a.keywords.includes("取消訂單"), "keywords added");
ok(a.body === b.body && a.keywords === b.keywords, "twice = same");
const guide = readFileSync("docs/support/sfl-guide.md","utf8");
const line = a.body.split("\n").find((l) => l.includes("Cancel an order"));
ok(guide.includes(line), "same words as the guide file");
ok((await db.query(`select body from support_guide where id='other'`)).rows[0].body === "x", "other rows untouched");
await db.exec(down); const c = (await db.query(`select body, keywords from support_guide where id='orders-search'`)).rows[0];
ok(c.body === body && c.keywords.startsWith("orders, order list") && !c.keywords.includes("cancel"), "rollback = before");
