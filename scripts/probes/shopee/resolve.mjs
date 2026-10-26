// Research probe (read-only, no login): share link / short link / session id → session_id →
// public session metadata (chatroom_id, status, viewers…). Usage:
//   node scripts/probes/shopee/resolve.mjs <share link | shp.ee link | session id> [cc=ph]
// Prints the HTTP status and the fields a reader needs; never prints buyer data.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const arg = process.argv[2];
const cc = process.argv[3] || "ph";
if (!arg) { console.error("usage: resolve.mjs <share link | short link | session id> [cc]"); process.exit(2); }

export async function resolveSessionId(input) {
  if (/^\d+$/.test(input)) return { sessionId: input, via: "id" };
  let url = input;
  const m = /[?&]session=(\d+)/.exec(url);
  if (m) return { sessionId: m[1], via: "share-link" };
  // short link (shp.ee / s.shopee.ph …) → follow redirects manually, read the Location chain
  for (let hop = 0; hop < 6; hop++) {
    const r = await fetch(url, { redirect: "manual", headers: { "user-agent": UA } });
    const loc = r.headers.get("location");
    const mm = /[?&]session=(\d+)/.exec(loc || "");
    if (mm) return { sessionId: mm[1], via: `redirect hop ${hop + 1} (${r.status})`, finalUrl: loc };
    if (!loc) return { sessionId: null, via: `no session in redirect chain (last status ${r.status})`, finalUrl: url };
    url = new URL(loc, url).toString();
  }
  return { sessionId: null, via: "too many redirects" };
}

export async function sessionMeta(sessionId, country = "ph") {
  const t0 = Date.now();
  const r = await fetch(`https://live.shopee.${country}/api/v1/session/${sessionId}`, { headers: { "user-agent": UA, accept: "application/json" } });
  const ms = Date.now() - t0;
  let body = null; try { body = await r.json(); } catch { body = await r.text().catch(() => ""); }
  return { status: r.status, ms, body };
}

const res = await resolveSessionId(arg);
console.log("resolve:", res);
if (!res.sessionId) process.exit(1);
const meta = await sessionMeta(res.sessionId, cc);
console.log(`session API: HTTP ${meta.status} in ${meta.ms} ms`);
const s = meta.body?.data?.session;
if (!s) { console.log("body:", JSON.stringify(meta.body).slice(0, 400)); process.exit(1); }
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
console.log("session:", pick(s, ["session_id", "status", "chatroom_id", "room_id", "uid", "username", "title", "start_time", "end_time", "viewer_count", "member_cnt", "like_cnt", "items_cnt"]));
console.log("play_urls:", (s.play_urls || []).length, "| top-level data keys:", Object.keys(meta.body.data).join(","));
