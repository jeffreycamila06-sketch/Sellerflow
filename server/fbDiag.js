// FACEBOOK COMMENT DIAGNOSTICS — admin-only, READ-ONLY (Nov 12 2026).
// GET /api/admin/fb-diag?page_id=<id> answers WHY a Page's live gets few comments, with proof:
// the Page token's debug_token (validity, type, scopes, granular scopes, expiry), the Page's
// tasks, the live video the poller would pick (the poller's OWN exported functions, unchanged),
// and comment counts on the live_video object and on its video object.
// Nothing here is used by the poller, printing, receipts or any seller flow — it only reads.
// Output = IDs, counts, scopes, Graph error codes. NEVER a token, the app secret, a buyer name
// or comment text: comments are asked for with fields id,created_time,from{id} only, and the
// whole answer is scrubbed of the token / app token / secret once more before it leaves.
import { graphGet, classifyGraphError, fetchLiveVideos, fetchLiveVideoFromVideos, FB_LIVE_API_REFUSED_CODE, GRAPH_HOST } from "./fbLive.js";
import { GRAPH_VERSION } from "./fbConfig.js";
import { decryptToken } from "./fbTokens.js";
import { maskSecretText } from "./fbHardening.js";

export const FB_DIAG_PATH = "/api/admin/fb-diag";
export const DIAG_COMMENT_LIMIT = 10;
const PAGE_ID_RE = /^\d{1,30}$/;

const url = (path, params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== "") q.set(k, String(v));
  return `${GRAPH_HOST}/${GRAPH_VERSION}${path}?${q.toString()}`;
};
// Facebook's own error fields only (code, subcode, short masked message) — never the URL.
const errOf = (status, body, secrets) => {
  const c = classifyGraphError(status, body);
  return { http: status ?? null, code: c.code > 0 ? c.code : null, error_subcode: c.subcode, type: c.type, message: shortMsg(c.message, secrets) };
};
const shortMsg = (m, secrets) => {
  let s = maskSecretText(m || "", "", 160);
  for (const x of secrets) if (x) s = s.split(x).join("[redacted]");
  return s;
};
const thrown = (e) => ({ http: null, code: null, error_subcode: null, type: null, message: e && (e.name === "AbortError" || e.message === "graph_timeout") ? "timeout" : "request_failed" });

// Comments on one object: Facebook's total (summary.total_count) and who the returned ones are from.
export function countCommentsFrom(list, pageId) {
  const out = { returned: 0, from_page: 0, from_missing: 0, from_others: 0 };
  for (const c of Array.isArray(list) ? list : []) {
    out.returned += 1;
    const id = c && c.from && c.from.id != null ? String(c.from.id) : "";
    if (!id) out.from_missing += 1;
    else if (id === String(pageId)) out.from_page += 1;
    else out.from_others += 1;
  }
  return out;
}

async function commentsOn({ fetchImpl, objectId, pageId, token, secrets, extra = {} }) {
  try {
    const { status, body } = await graphGet({ fetchImpl, url: url(`/${objectId}/comments`, {
      summary: "total_count", filter: "stream", limit: DIAG_COMMENT_LIMIT, fields: "id,created_time,from{id}", ...extra, access_token: token,
    }) });
    if (status !== 200 || !Array.isArray(body.data)) return { object_id: String(objectId), ok: false, error: errOf(status, body, secrets) };
    const total = body.summary && Number.isFinite(Number(body.summary.total_count)) ? Number(body.summary.total_count) : null;
    return {
      object_id: String(objectId), ok: true, fb_total: total, ...countCommentsFrom(body.data, pageId),
      comment_ids: body.data.map((c) => String((c && c.id) || "")).filter(Boolean),
      has_next_page: !!(body.paging && body.paging.next),
    };
  } catch (e) { return { object_id: String(objectId), ok: false, error: thrown(e) }; }
}

// The row to use when the Page is connected more than once: the active one, newest first.
export function pickPageRow(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const t = (r) => Date.parse(r.updated_at || r.created_at || 0) || 0;
  list.sort((a, b) => (Number(!!b.active) - Number(!!a.active)) || (t(b) - t(a)));
  return list[0] || null;
}

// The whole diagnosis. rows = the fb_pages rows for page_id (service role). fetchImpl = the
// appsecret_proof fetch (the poller's); appFetch = the plain fetch for /debug_token (app token).
// Never throws: every step has its own try/catch and reports its error instead.
export async function runFbDiag({ config, pageId, rows, fetchImpl, appFetch, now = () => Date.now() }) {
  const out = { ok: true, page_id: String(pageId), at: new Date(now()).toISOString(), graph_version: GRAPH_VERSION };
  const row = pickPageRow(rows);
  out.fb_pages = {
    rows: Array.isArray(rows) ? rows.length : 0,
    picked: row ? { user_id: row.user_id ?? null, active: !!row.active, can_message: row.can_message ?? null, created_at: row.created_at ?? null, updated_at: row.updated_at ?? null, token_expires_at: row.token_expires_at ?? null } : null,
  };
  if (!row) return { ...out, ok: false, error: "page_not_found" };
  let token = "";
  try { token = decryptToken(row.access_token, config.tokenKey) || ""; } catch { token = ""; }
  if (!token) return { ...out, ok: false, error: "token_unreadable" };
  const appToken = `${config.appId}|${config.appSecret}`;
  const secrets = [token, appToken, config.appSecret, config.tokenKey, row.access_token].filter((s) => typeof s === "string" && s.length >= 6);

  // 1. debug_token of the Page token (app token, plain fetch — same as fetchGranularScopes).
  try {
    const { status, body } = await graphGet({ fetchImpl: appFetch, url: url("/debug_token", { input_token: token, access_token: appToken }) });
    const d = body && body.data;
    if (status === 200 && d) {
      out.debug_token = {
        is_valid: d.is_valid === true, type: d.type ?? null, app_id_matches: d.app_id != null ? String(d.app_id) === String(config.appId) : null,
        profile_id: d.profile_id != null ? String(d.profile_id) : null,
        scopes: Array.isArray(d.scopes) ? d.scopes.map(String) : [],
        granular_scopes: Array.isArray(d.granular_scopes) ? d.granular_scopes.map((g) => ({ scope: String(g.scope || ""), target_ids: Array.isArray(g.target_ids) ? g.target_ids.map(String) : null })) : [],
        expires_at: d.expires_at ?? null, data_access_expires_at: d.data_access_expires_at ?? null,
        error: d.error ? { code: d.error.code ?? null, error_subcode: d.error.subcode ?? d.error.error_subcode ?? null, message: shortMsg(d.error.message, secrets) } : null,
      };
    } else out.debug_token = { error: errOf(status, body, secrets) };
  } catch (e) { out.debug_token = { error: thrown(e) }; }

  // 2. The Page's tasks (role) as seen with this token.
  try {
    const { status, body } = await graphGet({ fetchImpl, url: url(`/${pageId}`, { fields: "id,name,tasks", access_token: token }) });
    out.page = status === 200 && body && !body.error
      ? { id: body.id != null ? String(body.id) : null, name_present: !!body.name, tasks: Array.isArray(body.tasks) ? body.tasks.map(String) : null }
      : { error: errOf(status, body, secrets) };
  } catch (e) { out.page = { error: thrown(e) }; }

  // 3. The live video — the poller's own functions, in the poller's order (live_videos; code 10 → videos).
  let live;
  let videoMode = false;
  try { live = await fetchLiveVideos({ config, fetchImpl, pageId, pageToken: token }); } catch { live = { liveVideoId: "", failed: true }; }
  const firstTry = live.failed ? { failed: true, code: live.detail ? live.detail.code : null } : { failed: false };
  if (live.failed && !live.authFail && live.detail && live.detail.code === FB_LIVE_API_REFUSED_CODE) {
    try { live = await fetchLiveVideoFromVideos({ fetchImpl, pageId, pageToken: token }); } catch { live = { liveVideoId: "", failed: true }; }
    videoMode = true;
  }
  out.live = {
    poller_pick: live.liveVideoId || null, video_mode: videoMode, live_videos_call: firstTry,
    failed: !!live.failed, auth_fail: !!live.authFail,
    error: live.failed && live.detail ? { http: live.detail.httpStatus ?? null, code: live.detail.code ?? null, error_subcode: live.detail.subcode ?? null, message: shortMsg(live.detail.message, secrets) } : null,
  };
  const lv = live.liveVideoId || "";
  let videoId = "";
  if (lv) {
    try {
      const { status, body } = videoMode
        ? await graphGet({ fetchImpl, url: url(`/${lv}`, { fields: "id,live_status,created_time", access_token: token }) })
        : await graphGet({ fetchImpl, url: url(`/${lv}`, { fields: "id,status,broadcast_start_time,video", access_token: token }) });
      if (status === 200 && body && !body.error) {
        if (videoMode) { out.live.status = body.live_status ?? null; out.live.broadcast_start_time = body.created_time ?? null; videoId = lv; }
        else { out.live.status = body.status ?? null; out.live.broadcast_start_time = body.broadcast_start_time ?? null; videoId = body.video && body.video.id != null ? String(body.video.id) : ""; }
        out.live.video_id = videoId || null;
      } else out.live.detail_error = errOf(status, body, secrets);
    } catch (e) { out.live.detail_error = thrown(e); }

    // 4. Comments on what the poller reads (the live_video, or the video in video mode).
    out.comments_live = await commentsOn({ fetchImpl, objectId: lv, pageId, token, secrets });
    // 4b. The same object with the poller's own filters (live_filter=no_filter, newest first).
    out.comments_live_poller_filters = await commentsOn({ fetchImpl, objectId: lv, pageId, token, secrets, extra: { live_filter: "no_filter", order: "reverse_chronological" } });
    // 5. The video object behind the live_video, when it is a different id.
    out.comments_video = videoId && videoId !== lv ? await commentsOn({ fetchImpl, objectId: videoId, pageId, token, secrets }) : null;
  }
  out.page_only = !!(out.comments_live && out.comments_live.ok && out.comments_live.returned > 0 && out.comments_live.from_others === 0 && out.comments_live.from_missing === 0);
  return scrub(out, secrets);
}

// Last safety net: any copy of a secret anywhere in the answer → "[redacted]".
export function scrub(obj, secrets) {
  let s = JSON.stringify(obj);
  for (const x of secrets) if (x) s = s.split(JSON.stringify(x).slice(1, -1)).join("[redacted]");
  return JSON.parse(s);
}

// Express handler. Mounted behind requireAuth + requireAdmin in server.js. readPageRows(pageId)
// → the fb_pages rows (throws on a database error). log(line) gets one IDs-only line.
export function createFbDiagHandler({ config, readPageRows, fetchImpl, appFetch, log = () => {} }) {
  return async function fbDiag(req, res) {
    res.set("Cache-Control", "no-store");
    const pageId = String((req.query && req.query.page_id) || "").trim();
    if (!PAGE_ID_RE.test(pageId)) return res.status(400).json({ ok: false, error: "page_id_required" });
    let rows;
    try { rows = await readPageRows(pageId); } catch { return res.status(502).json({ ok: false, error: "fb_pages_read_failed" }); }
    try {
      const out = await runFbDiag({ config, pageId, rows, fetchImpl, appFetch });
      try {
        const dt = out.debug_token || {};
        const c = out.comments_live || {};
        log(`[FB-DIAG] page=${pageId} valid=${dt.is_valid ?? "-"} type=${dt.type ?? "-"} scopes=${(dt.scopes || []).join(",") || "-"} lv=${(out.live && out.live.poller_pick) || "-"} video=${(out.live && out.live.video_id) || "-"} fb_total=${c.fb_total ?? "-"} returned=${c.returned ?? "-"} page_only=${out.page_only}`);
      } catch { /* the log line never breaks the answer */ }
      return res.json(out);
    } catch { return res.status(500).json({ ok: false, error: "diag_failed" }); }
  };
}
