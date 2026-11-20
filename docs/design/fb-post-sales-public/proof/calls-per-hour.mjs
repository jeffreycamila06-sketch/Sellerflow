// Facebook calls per hour on ONE Page with 20 open post sales (2026-11-20). Runs the REAL post poller
// (server/fbPostSales.js) for 60 passes (= one hour; it runs once a minute) against a fake Facebook
// that hands out new comments, and counts every request. The live-comment numbers come from the live
// poller's own timers (server/fbLive.js) — that poller is not run here.
// Fix round 1: while the Page is live the post poller does not read that Page (isPageLive, a read of
// the live poller's running pollers — here a fake Map). Part 2 runs a 2-hour live and counts the post
// calls during it (0) and the catch-up after it.
//   node docs/design/fb-post-sales-public/proof/calls-per-hour.mjs        (from the repo root)
import { createFbPostSales, pageLiveIn, POLL_MS, COMMENTS_LIMIT, MAX_PAGES_PER_SALE } from "../../../../server/fbPostSales.js";
import { POLL_ACTIVE_MS, POLL_QUIET_MS, MAX_COMMENT_PAGES, LIVE_RECHECK_MS } from "../../../../server/fbLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app", appSecret: "s", tokenKey: "k" };
const SALES = 20, HOUR_PASSES = Math.round(3600_000 / POLL_MS);

// minutes: how long to run; live(m) → is the Page live in minute m; perMin(m) → new comments per post that minute.
// Returns the calls per minute.
async function run(minutes, live, perMin) {
  let now = Date.parse("2026-11-20T02:00:00Z");
  const pollers = new Map();
  const posts = Array.from({ length: SALES }, () => ({ total: 0 }));
  const cursors = new Map();
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    const u = new URL(url);
    const i = Number(u.pathname.match(/P1_(\d+)\/comments/)[1]);
    const from = Number(u.searchParams.get("after") || 0);
    const to = Math.min(posts[i].total, from + COMMENTS_LIMIT);
    const data = [];
    for (let n = from; n < to; n++) data.push({ id: `${i}_${n}`, message: "zz", created_time: new Date(now).toISOString(), from: { id: `b${n}`, name: "x" } }); // never a code: count calls only
    return { status: 200, json: async () => ({ data, paging: data.length ? { cursors: { after: String(to) }, ...(to < posts[i].total ? { next: "n" } : {}) } : {} }) };
  };
  const sales = posts.map((_, i) => ({
    id: i + 1, user_id: "u1", page_id: "P1", post_id: `P1_${i}`, mode: "code", status: "selling",
    starts_at: new Date(now - 3600_000).toISOString(), ends_at: new Date(now + 7 * 86400_000).toISOString(),
    items: [{ id: i, code: "A", name: "x", price: 1, stock: null, sold: 0 }], access_token: encryptToken("TOK", CONFIG.tokenKey),
  }));
  const rt = createFbPostSales({
    config: CONFIG, enabled: async () => true, fetchImpl, now: () => now, log: () => {},
    isPageLive: (pageId) => pageLiveIn(pollers, pageId),
    store: {
      async listActiveSales() { return sales.map((s) => ({ ...s, last_comment_cursor: cursors.get(s.id) ?? null })); },
      async markEnded() {}, async saveCursor(id, c) { cursors.set(id, c); }, async claimOrder() { return "dup"; }, async joinWaitlist() {}, async getPage() { return null; },
      async allowedSellers(ids) { return ids; },
    },
  });
  const perMinute = [];
  for (let m = 0; m < minutes; m++) {
    if (live(m)) pollers.set("s:Facebook:P1", { pageId: "P1", stopped: false }); else pollers.delete("s:Facebook:P1");
    for (const p of posts) p.total += perMin(m);
    const before = calls;
    await rt.tick();
    perMinute.push(calls - before);
    now += POLL_MS;
  }
  return perMinute;
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const hour = async (n) => sum(await run(HOUR_PASSES, () => false, () => n));

const rows = [];
for (const n of [0, 20, 100, 250, 600]) rows.push([n, await hour(n)]);
console.log(`POST POLLER — one Page, ${SALES} open sales, one pass every ${POLL_MS / 1000} s, ≤ ${MAX_PAGES_PER_SALE} pages of ${COMMENTS_LIMIT} per sale per pass`);
for (const [n, c] of rows) console.log(`  new comments per post per minute ${String(n).padStart(3)} → ${c} Facebook calls in one hour (${(c / 60).toFixed(1)} a minute) · ${c * 24} a day at that rate`);
const quiet = 3600_000 / POLL_QUIET_MS, active = 3600_000 / POLL_ACTIVE_MS;
console.log(`LIVE POLLER — the same Page while live (server/fbLive.js timers, not run here)`);
console.log(`  no new comments: one read every ${POLL_QUIET_MS / 1000} s → ${quiet} a hour; comments coming in: every ${POLL_ACTIVE_MS / 1000} s → ${active} a hour`);
console.log(`  a burst (a full page of ${COMMENTS_LIMIT} all new): up to ${MAX_COMMENT_PAGES} more pages per read → at most ${active * (1 + MAX_COMMENT_PAGES)} a hour; live-status check ${3600_000 / LIVE_RECHECK_MS} a hour`);
const q = rows[0][1];
console.log(`BEFORE fix round 1 — TOGETHER (20 quiet post sales): ${quiet + q}–${active + q} a hour while live`);
console.log(`AFTER fix round 1 — while the Page is live the post sales make 0 calls: ${quiet}–${active} a hour (the live reader alone); ${q} a hour (${q * 24} a day) from the post sales when the Page is not live`);
// part 2: an hour before, a 2-hour live, then until the post sales have caught up
console.log(`2-HOUR LIVE on the same Page (minute 60–179), new comments on each of the ${SALES} posts every minute:`);
for (const n of [0, 5, 20, 100]) {
  const pm = await run(60 + 120 + 60, (m) => m >= 60 && m < 180, () => n);
  const during = sum(pm.slice(60, 180));
  const after = pm.slice(180);
  let caught = after.findIndex((c, i) => i > 0 && c === pm[59]);
  if (caught < 0) caught = after.length;
  console.log(`  ${String(n).padStart(3)} a minute → post calls during the live: ${during} · first minute after: ${after[0]} calls · back to the normal ${pm[59]} a minute after ${caught} minute(s) · catch-up total ${sum(after.slice(0, Math.max(1, caught)))} calls (${n * 120} comments per post to read)`);
}
