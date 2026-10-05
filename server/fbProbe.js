// FACEBOOK ALT PROBE — read-only research, no behaviour change.
//
// When GET /{page}/live_videos is refused with Facebook code 10 (the Live Video API is only for
// admins / developers / testers of our Meta app), /fb/connect still answers 502 fb_check_failed as
// before. AFTER that response, this probe asks Facebook — with the same Page token and only the
// already-approved pages_read_engagement / pages_read_user_content — whether the live video and its
// comments can be found another way (/videos, /posts, the video node, its comments).
//
// Every step = one row in public.fb_probe_log (sql/78, service role only) + one log line.
// METADATA ONLY: http, Facebook code/subcode/type, item count, and ids of videos/posts,
// live_status / created_time values, the newest comment's age, how many comments carry `from`,
// and the first 160 chars of Facebook's error message (token masked). NEVER the token, the request
// URL, comment text, commenter names or commenter ids.
//
// Runs in the background (never awaited by the request, never throws), each call through the
// caller's graphGet (10 s timeout), at most one probe per page every 30 s.

export const PROBE_MIN_INTERVAL_MS = 30 * 1000;
export const PROBE_MESSAGE_MAX = 160;
export const PROBE_TRIGGER_CODE = 10;
export const PROBE_STEPS = [
  "videos_min", "videos_live", "posts_min", "posts_attach",
  "video_node", "vcomments_min", "vcomments_from", "vcomments_stream", "pcomments_stream",
];

const isoMs = (v) => { const t = Date.parse(String(v || "")); return Number.isFinite(t) ? t : null; };
const str = (v) => (v == null ? null : String(v));

// Newest item by created_time (ties: first in the list).
export function newestId(items) {
  let best = null; let bestT = -Infinity;
  for (const it of items || []) {
    const t = isoMs(it && it.created_time);
    if (it && it.id && (t ?? -Infinity) > bestT) { best = String(it.id); bestT = t ?? -Infinity; }
  }
  if (!best) { const first = (items || []).find((it) => it && it.id); return first ? String(first.id) : null; }
  return best;
}

// One Graph answer → the row fields. kind "objects" (videos/posts/video node) keeps ids, live_status
// and created_time; kind "comments" keeps only counts and the newest comment's age.
export function summarize({ status = null, body = null, error = null, kind = "objects", nowMs = Date.now(), token = "" }) {
  if (error) {
    return { http: null, fb_code: null, fb_subcode: null, fb_type: null, items: null,
      detail: { timed_out: String(error && error.message) === "graph_timeout" || (error && error.name) === "AbortError", error: "request_failed" } };
  }
  const b = body && typeof body === "object" ? body : {};
  const err = b.error && typeof b.error === "object" ? b.error : null;
  let message = err ? String(err.message || "").replace(/\s+/g, " ").slice(0, PROBE_MESSAGE_MAX) : "";
  if (message && token) message = message.split(String(token)).join("[redacted]");
  const list = Array.isArray(b.data) ? b.data : (b.id && !err ? [b] : null);
  const detail = {};
  if (list) {
    if (kind === "comments") {
      let newest = null; let withFrom = 0;
      for (const c of list) {
        const t = isoMs(c && c.created_time);
        if (t != null && (newest == null || t > newest)) newest = t;
        if (c && c.from && c.from.id) withFrom += 1;
      }
      detail.newest_comment_age_seconds = newest == null ? null : Math.max(0, Math.round((nowMs - newest) / 1000));
      detail.comments_with_from = withFrom;
    } else {
      detail.ids = list.map((x) => str(x && x.id)).filter(Boolean);
      const live = list.map((x) => (x && x.live_status != null ? String(x.live_status) : null)).filter((x) => x != null);
      if (live.length) detail.live_status = live;
      detail.created_time = list.map((x) => str(x && x.created_time)).filter(Boolean);
    }
  }
  if (message) detail.error_message = message;
  return {
    http: Number.isFinite(status) ? status : null,
    fb_code: err && Number.isFinite(Number(err.code)) ? Number(err.code) : null,
    fb_subcode: err && Number.isFinite(Number(err.error_subcode)) ? Number(err.error_subcode) : null,
    fb_type: err && err.type ? String(err.type) : null,
    items: list ? list.length : null,
    detail,
  };
}

// deps: { get(path, params, token) → {status, body} (throws on timeout/network),
//         insertRow?(row), log?(line), now?() }
export function createFbAltProbe({ get, insertRow = null, log = () => {}, now = () => Date.now() }) {
  const lastStart = new Map(); // pageId → ms

  async function run({ userId, pageId, token }) {
    const user8 = String(userId || "").slice(0, 8);
    const page = String(pageId);
    const record = async (step, row) => {
      log(`[FB] alt probe user=${user8} page=${page} step=${step} http=${row.http ?? "-"} code=${row.fb_code ?? "-"} items=${row.items ?? "-"}${row.detail && row.detail.skipped ? " skipped" : ""}`);
      if (typeof insertRow === "function") {
        try { await insertRow({ user_id: userId || null, page_id: page, step, ...row }); } catch { /* never let a log row break the probe */ }
      }
    };
    // → the items (in memory only, to choose the next ids; objects only: id, created_time, live_status).
    const call = async (step, path, params, kind) => {
      let res; let items = [];
      try {
        const r = await get(path, params, token);
        res = summarize({ status: r.status, body: r.body, kind, nowMs: now(), token });
        const b = r.body && typeof r.body === "object" ? r.body : {};
        const list = Array.isArray(b.data) ? b.data : [];
        if (kind === "objects") items = list.filter((x) => x && x.id).map((x) => ({ id: String(x.id), created_time: x.created_time, live_status: x.live_status }));
      } catch (e) { res = summarize({ error: e, kind, nowMs: now(), token }); }
      await record(step, res);
      return items;
    };
    const skip = (step, reason) => record(step, { http: null, fb_code: null, fb_subcode: null, fb_type: null, items: null, detail: { skipped: true, reason } });

    // a–d: what the Page itself lists (approved permissions only).
    const vMin = await call("videos_min", `/${page}/videos`, { fields: "id,created_time", limit: 5 }, "objects");
    const vLive = await call("videos_live", `/${page}/videos`, { fields: "id,created_time,live_status", limit: 5 }, "objects");
    const pMin = await call("posts_min", `/${page}/posts`, { fields: "id,created_time,status_type", limit: 5 }, "objects");
    const pAtt = await call("posts_attach", `/${page}/posts`, { fields: "id,created_time,status_type,attachments{media_type,type,target}", limit: 5 }, "objects");

    // The video to look at: the LIVE one from b, else the newest from a/b. The post: newest from c/d.
    const liveItem = vLive.find((x) => String(x.live_status || "").toUpperCase() === "LIVE");
    const videoId = liveItem ? liveItem.id : newestId([...vLive, ...vMin]);
    const postId = newestId([...pMin, ...pAtt]);

    // e–h: the video node and its comments.
    if (videoId) {
      await call("video_node", `/${videoId}`, { fields: "id,created_time,live_status" }, "objects");
      await call("vcomments_min", `/${videoId}/comments`, { fields: "id,created_time", limit: 5 }, "comments");
      await call("vcomments_from", `/${videoId}/comments`, { fields: "id,created_time,from{id}", limit: 5 }, "comments");
      await call("vcomments_stream", `/${videoId}/comments`, { filter: "stream", order: "reverse_chronological", fields: "id,created_time,from{id}", limit: 5 }, "comments");
    } else {
      for (const s of ["video_node", "vcomments_min", "vcomments_from", "vcomments_stream"]) await skip(s, "no_video_id");
    }
    // i: the newest post's comments.
    if (postId) await call("pcomments_stream", `/${postId}/comments`, { filter: "stream", order: "reverse_chronological", fields: "id,created_time,from{id}", limit: 5 }, "comments");
    else await skip("pcomments_stream", "no_post_id");
  }

  // Starts a probe in the background unless one ran for this page in the last 30 s. Returns the
  // run's promise (for tests) or null when skipped. Never throws; the promise never rejects.
  function start({ userId, pageId, token }) {
    try {
      const key = String(pageId || "");
      if (!key || !token) return null;
      const t = now();
      const last = lastStart.get(key);
      if (last != null && t - last < PROBE_MIN_INTERVAL_MS) return null;
      lastStart.set(key, t);
      if (lastStart.size > 1000) lastStart.delete(lastStart.keys().next().value);
      return run({ userId, pageId: key, token }).catch(() => {});
    } catch {
      return null;
    }
  }

  return { start, _lastStart: lastStart };
}
