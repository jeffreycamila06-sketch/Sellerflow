// FACEBOOK "POST SALES" — buyers comment a code on a Page POST → an order (sql/137).
// A SEPARATE module from the live path: nothing here touches server/fbLive.js, the live comment
// relay, live_session_orders or buyer numbering. It only IMPORTS fbLive's Graph helpers.
//
// One poller for all sellers: every POLL_MS it loads the SELLING sales whose window is open
// (status 'selling', starts_at ≤ now ≤ ends_at; ends_at passed → marked 'ended'), fetches each
// post's comments with the Page token already stored in fb_pages (pages_read_engagement +
// pages_read_user_content), and runs each NEW comment through the SAME rules as Auto mode:
//   • code mode: the WHOLE comment (trimmed, case-insensitive) must equal an item code — "A" or
//     "a" matches, "A po" / "ok A" / "A." do not (autoMode.ts Q1/Q2). Quantity = 1.
//   • plus_one mode: "+1" (1 piece) or "+N" (N pieces, 1..PLUS_ONE_MAX); fullwidth ＋/digits
//     are accepted.
// The database RPC fb_post_order_claim does the atomic part (row lock → no overselling; one
// order per comment id; one per buyer per item). Sold out → the buyer joins fb_waitlist
// (source 'post'); no order. Comments FROM THE PAGE ITSELF are ignored.
// Processed-once: the Graph paging cursor (`after`) is stored per sale (last_comment_cursor) and
// the unique comment_id makes any re-read harmless. Errors back off per sale (rate limit 5 min,
// invalid token 1 h — the page row is NOT marked inactive here; the live path owns that).
// Never lose a comment (2026-11-20): the cursor of a comments page is saved only after EVERY
// comment of that page was answered by the database. A claim that fails (throws, or an answer that
// is not ordered / dup / sold_out) or a waitlist write that fails stops the pass for that sale and
// leaves the cursor BEFORE that page → the next minute reads the same page again (the comments
// already ordered answer 'dup': comment_id keeps each order once).
// Plans (sql/188): only sellers who pass fb_post_seller_allowed (admin, a 'fb_post_sales' tester,
// an active Plus / Pro / Master plan) are read at all. Another seller's sales stay as they are (no
// Facebook call, cursor not moved); renewed before the end date, the comments left meanwhile are
// read and become orders in their order. The claim RPC checks the same rule ('not_allowed').
// Lives first (2026-11-20, fix round 1): while the live comment reader runs for a Page
// (isPageLive — a READ of the live reader's running pollers), no post of that Page is read: no
// Facebook call, the cursor stays. After the live, the comments written meanwhile are read in
// order. Other Pages are not affected.
// The end date is judged by the COMMENT's time (sql/188 claim): a sale whose end date passed is
// read once more ("closing"), comments written before the end become orders, later ones are
// skipped, and only then is the sale marked ended — so nothing written before the end is lost to
// a live, a slow minute, or End now (which only moves the end date to now).
import { graphGet, classifyGraphError, GRAPH_HOST } from "./fbLive.js";
import { GRAPH_VERSION } from "./fbConfig.js";
import { decryptToken } from "./fbTokens.js";
import { withAppSecretProof, maskSecretText } from "./fbHardening.js";

export const POLL_MS = 60 * 1000;            // one pass over all active sales
export const COMMENTS_LIMIT = 100;           // comments per request
export const MAX_PAGES_PER_SALE = 5;         // paging cap per sale per pass
export const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
export const AUTH_FAIL_BACKOFF_MS = 60 * 60 * 1000;
export const ERROR_BACKOFF_MS = 2 * 60 * 1000;
export const PLUS_ONE_MAX = 10;
export const MAX_ACTIVE_SALES_PER_SELLER = 20; // mirrored by the create RPC
export const RECENT_POSTS_LIMIT = 10;
// After its end date a sale is read once more (comments written before the end become orders).
// A sale that still cannot be read this long after its end date (token gone, a comment that keeps
// failing) is ended without reading further. Longer than the longest live (fbLive MAX_SESSION_MS).
export const CLOSE_GRACE_MS = 24 * 60 * 60 * 1000;

// Is the live comment reader running for this Page? READ-ONLY look at fbLive's running pollers
// (the Map fbLive exposes as _pollers); never changes anything. No Map → not live.
export function pageLiveIn(pollers, pageId) {
  if (!pollers || typeof pollers.values !== "function") return false;
  const id = String(pageId ?? "");
  if (!id) return false;
  for (const e of pollers.values()) if (e && !e.stopped && String(e.pageId) === id) return true;
  return false;
}

// ── pure ─────────────────────────────────────────────────────────────────────
const fullwidth = (s) => String(s ?? "").replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10)).replace(/＋/g, "+");
export const normalizeCode = (s) => fullwidth(s).trim().toLowerCase();

// "+1" / "+ 2" / "＋３" → the quantity (1..PLUS_ONE_MAX); anything else → 0.
export function parsePlusOne(text) {
  const m = normalizeCode(text).match(/^\+\s*(\d{1,2})$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return n >= 1 && n <= PLUS_ONE_MAX ? n : 0;
}

// Comment text → { item, qty } or null. items = rows of fb_post_sale_items for the sale.
export function matchPostComment(text, { mode, items }) {
  const list = Array.isArray(items) ? items : [];
  if (mode === "plus_one") {
    const qty = parsePlusOne(text);
    return qty && list[0] ? { item: list[0], qty } : null;
  }
  const c = normalizeCode(text);
  if (!c) return null;
  const item = list.find((i) => normalizeCode(i.code) === c);
  return item ? { item, qty: 1 } : null;
}

// A comment written by the Page itself (the seller answering buyers) is never an order.
export const isPageComment = (comment, pageId) => String(comment?.from?.id ?? "") !== "" && String(comment.from.id) === String(pageId);

// Is this sale open right now? (The DB RPC re-checks; this just skips the Graph call.)
export function saleWindow(sale, nowMs) {
  const start = Date.parse(sale.starts_at || "") || 0;
  const end = Date.parse(sale.ends_at || "") || 0;
  if (sale.status !== "selling") return "ended";
  if (end && nowMs > end) return "expired";
  if (start && nowMs < start) return "not_yet";
  return "open";
}

// Graph comment → the claim arguments.
export function commentToClaim(sale, m, c) {
  const from = c && c.from && typeof c.from === "object" ? c.from : {};
  return {
    saleId: sale.id, itemId: m.item.id, qty: m.qty,
    buyerFbId: String(from.id ?? ""), buyerName: String(from.name ?? ""),
    commentId: String(c.id ?? ""), commentText: String(c.message ?? "").slice(0, 500),
    createdAt: c.created_time ? new Date(c.created_time).toISOString() : null,
  };
}

const graphUrl = (path, params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== "") q.set(k, String(v));
  return `${GRAPH_HOST}/${GRAPH_VERSION}${path}?${q.toString()}`;
};

// One comments page of a post. order=chronological + the stored `after` cursor = each comment
// read once. { ok, data, after, cls } — cls = classifyGraphError on failure.
export async function fetchPostComments({ fetchImpl, postId, pageToken, after }) {
  const url = graphUrl(`/${encodeURIComponent(postId)}/comments`, {
    fields: "id,from{id,name},message,created_time", order: "chronological", limit: COMMENTS_LIMIT, access_token: pageToken, after,
  });
  const { status, body } = await graphGet({ fetchImpl, url });
  if (status !== 200 || !Array.isArray(body?.data)) return { ok: false, cls: classifyGraphError(status, body), status };
  const next = body?.paging?.cursors?.after || null;
  return { ok: true, data: body.data, after: body.data.length ? next : null, hasNext: !!body?.paging?.next };
}

// The Page's recent posts for the "Sell on a post" picker. { ok, posts } — picture/message trimmed.
export async function fetchRecentPosts({ fetchImpl, pageId, pageToken, limit = RECENT_POSTS_LIMIT }) {
  const url = graphUrl(`/${encodeURIComponent(pageId)}/posts`, { fields: "id,message,created_time,full_picture,permalink_url", limit, access_token: pageToken });
  const { status, body } = await graphGet({ fetchImpl, url });
  if (status !== 200 || !Array.isArray(body?.data)) return { ok: false, cls: classifyGraphError(status, body), status };
  return { ok: true, posts: body.data.map((p) => ({ id: String(p.id ?? ""), message: String(p.message ?? "").slice(0, 300), createdTime: String(p.created_time ?? ""), picture: String(p.full_picture ?? ""), url: String(p.permalink_url ?? "") })).filter((p) => p.id) };
}

// ── runtime ──────────────────────────────────────────────────────────────────
// store: listActiveSales() → sales with items + page access_token (service role);
//        markEnded(id); saveCursor(id, cursor);
//        claimOrder(args) → 'ordered'|'dup'|'sold_out'|'ended'|'not_allowed';
//        joinWaitlist(row); getPage(userId, pageId);
//        allowedSellers(userIds) → the ids that may sell on posts, or null = no plan rule in the
//        database yet (sql/188 not applied: every seller, as before). Throws → no seller this pass.
// enabled: async () => boolean (the fb_post_sales_enabled switch, cached).
export function createFbPostSales(deps) {
  const {
    config, store, enabled = async () => false, isPageLive = () => false,
    fetchImpl: rawFetch = globalThis.fetch, now = () => Date.now(), log = () => {},
    setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (h) => clearInterval(h),
  } = deps;
  const fetchImpl = withAppSecretProof(rawFetch, config.appSecret);
  const backoff = new Map(); // sale id → until ms
  const paused = new Set();  // sale ids whose seller does not pass the plan rule (logged once)
  const waiting = new Set(); // sale ids waiting for their Page's live to end (logged once)
  const pageLive = (pageId) => { try { return isPageLive(String(pageId)) === true; } catch { return false; } };
  let handle = null;
  let running = false;

  // The ids of these sellers that may sell on posts; null = every seller (no rule in the DB yet).
  async function allowedOf(userIds) {
    if (typeof store.allowedSellers !== "function") return null;
    const r = await store.allowedSellers(userIds);
    return r == null ? null : new Set(r.map(String));
  }

  async function processSale(sale, allowed = true) {
    const nowMs = now();
    if ((backoff.get(sale.id) || 0) > nowMs) return;
    const win = saleWindow(sale, nowMs);
    if (win === "ended" || win === "not_yet") return;
    // the seller's plan: no Facebook call, the cursor stays where it is; past its end date → ended
    if (!allowed) {
      if (win === "expired") { await store.markEnded(sale.id); paused.delete(sale.id); log(`[FB-POST] ended sale=${sale.id}`); return; }
      if (!paused.has(sale.id)) { paused.add(sale.id); log(`[FB-POST] sale=${sale.id} paused — the seller's plan does not include post sales`); }
      return;
    }
    if (paused.delete(sale.id)) log(`[FB-POST] sale=${sale.id} resumed`);
    if (win === "expired" && nowMs > (Date.parse(sale.ends_at || "") || 0) + CLOSE_GRACE_MS) {
      await store.markEnded(sale.id); waiting.delete(sale.id);
      log(`[FB-POST] ended sale=${sale.id} — over 24 h past its end date, not read further`);
      return;
    }
    // the Page is live: no Facebook call for its posts, the cursor stays (also past the end date)
    if (pageLive(sale.page_id)) {
      if (!waiting.has(sale.id)) { waiting.add(sale.id); log(`[FB-POST] sale=${sale.id} waiting — page=${sale.page_id} is live`); }
      return;
    }
    if (waiting.delete(sale.id)) log(`[FB-POST] sale=${sale.id} reading again — page=${sale.page_id} live ended`);
    const closing = win === "expired"; // past the end date: read what was written before it, then end
    const token = decryptToken(sale.access_token, config.tokenKey);
    if (!token) { backoff.set(sale.id, nowMs + AUTH_FAIL_BACKOFF_MS); log(`[FB-POST] sale=${sale.id} token unreadable`); return; }
    let after = sale.last_comment_cursor || null;
    let ordered = 0, waitlisted = 0, done = false;
    for (let page = 0; page < MAX_PAGES_PER_SALE; page++) {
      const r = await fetchPostComments({ fetchImpl, postId: sale.post_id, pageToken: token, after });
      if (!r.ok) {
        if (r.cls.code === 100 && after) { await store.saveCursor(sale.id, null); } // stale cursor → start over (comment_id dedupes)
        const wait = r.cls.rateLimited ? RATE_LIMIT_BACKOFF_MS : r.cls.authFail ? AUTH_FAIL_BACKOFF_MS : ERROR_BACKOFF_MS;
        backoff.set(sale.id, nowMs + wait);
        log(`[FB-POST] sale=${sale.id} fetch failed http=${r.status} code=${r.cls.code} ${r.cls.rateLimited ? "rate_limited" : r.cls.authFail ? "auth" : "error"} msg=${maskSecretText(r.cls.message, token, 120)}`);
        return;
      }
      if (r.after && r.after === after) { done = true; break; } // the same page again (cursor did not move) → stop, never reprocess
      for (const c of r.data) {
        if (!c || !c.id || isPageComment(c, sale.page_id)) continue;
        const m = matchPostComment(c.message, sale);
        if (!m) continue;
        const args = commentToClaim(sale, m, c);
        let verdict = "error";
        try { verdict = await store.claimOrder(args); } catch (e) { log(`[FB-POST] claim failed sale=${sale.id}: ${String(e && e.message || e)}`); }
        if (verdict === "ordered") ordered++;
        else if (verdict === "sold_out") {
          try {
            await store.joinWaitlist({ user_id: sale.user_id, session_id: null, code: m.item.code, product_local_id: m.item.product_id ?? null, comment_id: args.commentId, page_id: String(sale.page_id), live_video_id: null, commenter_id: args.buyerFbId || null, commenter_name: args.buyerName, handle: args.buyerFbId || args.buyerName, source: "post", sale_id: sale.id });
            waitlisted++;
          } catch (e) {
            log(`[FB-POST] waitlist failed sale=${sale.id}: ${String(e && e.message || e)}`);
            return stopAt(sale, args.commentId, "waitlist_failed", ordered, waitlisted);
          }
        } else if (verdict === "ended" && closing) {
          // a comment written after the end date: no order, read on
        } else if (verdict !== "dup") {
          // 'error' (the claim threw), 'not_allowed' (the plan), 'ended', or an answer we do not know:
          // this comment has no answer yet → stop here, keep the cursor before this page.
          return stopAt(sale, args.commentId, verdict, ordered, waitlisted);
        }
      }
      if (r.after && r.after !== after) { after = r.after; await store.saveCursor(sale.id, after); }
      if (!r.hasNext || !r.data.length) { done = true; break; }
    }
    if (ordered || waitlisted) log(`[FB-POST] sale=${sale.id} ordered=${ordered} waitlisted=${waitlisted}`);
    // every comment up to now has an answer → a sale past its end date is ended
    if (closing && done) { await store.markEnded(sale.id); log(`[FB-POST] ended sale=${sale.id}`); }
  }

  // A comment without an answer: the pass for this sale ends, its cursor is NOT saved.
  function stopAt(sale, commentId, reason, ordered, waitlisted) {
    log(`[FB-POST] sale=${sale.id} stopped at comment=${commentId} reason=${reason} ordered=${ordered} waitlisted=${waitlisted} — read again next minute`);
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      if (!(await enabled())) return;
      const sales = await store.listActiveSales();
      let allowed;
      try { allowed = await allowedOf([...new Set(sales.map((s) => String(s.user_id)))]); }
      catch (e) { allowed = new Set(); log(`[FB-POST] plan check failed — no post orders this pass: ${String(e && e.message || e)}`); }
      for (const s of sales) {
        try { await processSale(s, allowed === null || allowed.has(String(s.user_id))); } catch (e) { log(`[FB-POST] sale=${s.id} error ${String(e && e.message || e)}`); }
      }
    } catch (e) {
      log(`[FB-POST] tick error ${String(e && e.message || e)}`);
    } finally { running = false; }
  }

  // The "Sell on a post" picker: the seller's own Page's recent posts (server-side because the
  // Page token never leaves the server). { ok, posts } | { ok:false, error }.
  // sql/188: only a seller who may sell on posts (plan_not_allowed); the rule unreadable → plan_check_failed.
  async function recentPosts(userId, pageId) {
    let allowed;
    try { allowed = await allowedOf([String(userId)]); } catch { return { ok: false, error: "plan_check_failed" }; }
    if (allowed !== null && !allowed.has(String(userId))) return { ok: false, error: "plan_not_allowed" };
    const page = await store.getPage(userId, pageId);
    if (!page) return { ok: false, error: "page_not_found" };
    const token = decryptToken(page.access_token, config.tokenKey);
    if (!token) return { ok: false, error: "needs_reauth" };
    const r = await fetchRecentPosts({ fetchImpl, pageId, pageToken: token });
    if (!r.ok) return { ok: false, error: r.cls.authFail ? "needs_reauth" : r.cls.rateLimited ? "too_many_requests" : "fb_failed" };
    return { ok: true, posts: r.posts };
  }

  return {
    start() { if (!handle) handle = setTimer(() => { void tick(); }, POLL_MS); },
    stop() { if (handle) { clearTimer(handle); handle = null; } },
    tick, recentPosts,
  };
}
