// Research probe (read-only, no login): share link / short link → session_id + share_user_id →
// public session metadata (chatroom_id, status, viewers…). Usage:
//   node scripts/probes/shopee/resolve.mjs <share link | shp.ee link | uid:<host uid>> [cc=ph]
// Prints the HTTP status and the fields a reader needs; never prints buyer data.
// Two metadata routes, both plain GET, no cookies:
//   A) GET https://live.shopee.<cc>/api/v1/session/{session_id}        → anti-fraud gated (403 error 90309999) when called bare
//   B) GET https://live.shopee.<cc>/api/v1/host_session?uid={host uid} → 200 with data.session incl. chatroom_id (2026-10-27, TW)
// The host uid is the share link's `share_user_id` (or any known host uid).
import { pathToFileURL } from "node:url";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; // poll.mjs imports this module

const pickIds = (u) => ({ sessionId: (/[?&]session=(\d+)/.exec(u) || [])[1] || null, uid: (/[?&]share_user_id=(\d+)/.exec(u) || [])[1] || null });
export async function resolveSessionId(input) {
  if (/^\d+$/.test(input)) return { sessionId: input, uid: null, via: "id" };
  if (/^uid:\d+$/.test(input)) return { sessionId: null, uid: input.slice(4), via: "uid" };
  let url = input;
  const direct = pickIds(url);
  if (direct.sessionId) return { ...direct, via: "share-link" };
  // short link (shp.ee / s.shopee.ph …) → follow redirects manually, read the Location chain
  for (let hop = 0; hop < 6; hop++) {
    const r = await fetch(url, { redirect: "manual", headers: { "user-agent": UA } });
    const loc = r.headers.get("location");
    const ids = pickIds(loc || "");
    if (ids.sessionId) return { ...ids, via: `redirect hop ${hop + 1} (${r.status})`, finalUrl: loc };
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
  return { status: r.status, ms, body, route: "session" };
}
/** Route B: the host's current/last session by host uid — plain GET, answered 200 with chatroom_id without cookies (TW, 2026-10-27). */
export async function hostSessionMeta(uid, country = "ph") {
  const t0 = Date.now();
  const r = await fetch(`https://live.shopee.${country}/api/v1/host_session?uid=${uid}`, { headers: { "user-agent": UA, accept: "application/json" } });
  const ms = Date.now() - t0;
  let body = null; try { body = await r.json(); } catch { body = await r.text().catch(() => ""); }
  return { status: r.status, ms, body, route: "host_session" };
}
/** Session metadata for a reader: route B when a host uid is known (not gated), else route A. */
export async function anySessionMeta({ sessionId, uid }, country = "ph") {
  if (uid) { const b = await hostSessionMeta(uid, country); if (b.body?.data?.session?.chatroom_id) return b; }
  return sessionMeta(sessionId, country);
}

if (isCli) {
  const arg = process.argv[2];
  const cc = process.argv[3] || "ph";
  if (!arg) { console.error("usage: resolve.mjs <share link | short link | uid:<host uid> | session id> [cc]"); process.exit(2); }
  const res = await resolveSessionId(arg);
  console.log("resolve:", res);
  if (!res.sessionId && !res.uid) process.exit(1);
  const meta = await anySessionMeta(res, cc);
  console.log(`${meta.route} API: HTTP ${meta.status} in ${meta.ms} ms`);
  const s = meta.body?.data?.session;
  if (!s) { console.log("body:", JSON.stringify(meta.body).slice(0, 400)); process.exit(1); }
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
  console.log("session:", pick(s, ["session_id", "status", "chatroom_id", "room_id", "uid", "title", "start_time", "end_time", "viewer_count", "member_cnt", "like_cnt", "items_cnt", "is_test"]));
  console.log("top-level data keys:", Object.keys(meta.body.data).join(","));
}
