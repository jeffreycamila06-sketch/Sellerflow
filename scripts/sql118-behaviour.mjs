// Runs sql/118 (buyer-number guard) + its rollback on a real Postgres (PGlite, WASM): 139 buyers,
// then a stale #9 → #140, a returning buyer keeps #50, outbox retry, legacy rows, rollback.
// Not part of CI (PGlite is not a dependency). Run from a scratch folder:
//   npm i @electric-sql/pglite@0.2.17 && node sql118-behaviour.mjs <repo>/sql/118_session_buyer_number_guard.HOLD.sql <repo>/sql/118_session_buyer_number_guard_rollback.HOLD.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const [,, up, down] = process.argv;
const db = new PGlite();
let pass=0, fail=0; const ok=(c,m)=>{ if(c)pass++; else {fail++; console.log("FAIL",m);} };
await db.exec(`create table public.live_session_orders(id bigserial primary key, user_id uuid, session_id uuid, buyer_number int, handle text, platform text, comment_msg_id text, created_at timestamptz default now());
create unique index ux on public.live_session_orders(user_id, comment_msg_id);`);
await db.exec(readFileSync(up,"utf8"));
const U='00000000-0000-0000-0000-000000000001', S='00000000-0000-0000-0000-0000000000aa', S2='00000000-0000-0000-0000-0000000000bb';
const ins = async (s,n,h,msg,p='TikTok') => (await db.query(`insert into live_session_orders(user_id,session_id,buyer_number,handle,platform,comment_msg_id) values($1,$2,$3,$4,$5,$6) on conflict do nothing returning buyer_number`,[U,s,n,h,p,msg])).rows[0]?.buyer_number;
for (let i=1;i<=139;i++) await ins(S,i,'@b'+i,'m'+i);
ok(await ins(S,9,'@new','x1')===140, "stale #9 for a new buyer → 140");
ok(await ins(S,141,'@b50','x2')===50, "returning buyer given a 2nd number → keeps 50");
ok(await ins(S,141,'@other','x3')===141, "free number kept");
ok(await ins(S,7,'@b7','x4')===7, "returning buyer, right number");
ok(await ins(S,9,'@b9','x5','Facebook')===142, "same handle other platform = different buyer");
ok(await ins(S,9,'@new','x1')===undefined, "outbox retry of the same msgId = no new row");
ok(await ins(S2,1,'@z','y1')===1, "other session starts at #1");
ok(await ins(null,1,'@q','n1')===1 && await ins(null,1,'@r','n2')===1, "legacy null session untouched");
const d=(await db.query(`select buyer_number from live_session_orders where session_id=$1 group by buyer_number having count(distinct handle||platform)>1`,[S])).rows.length;
ok(d===0,"no number with two buyers in the session");
await db.exec(readFileSync(down,"utf8"));
ok(await ins(S,9,'@after','z1')===9, "after rollback: no guard");
console.log(`pass=${pass} fail=${fail}`); process.exit(fail?1:0);
