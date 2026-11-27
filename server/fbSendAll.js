// INVOICING → FACEBOOK "SEND ALL IN MESSENGER" (FB-2, Jeff 2026-11-26).
//
// A seller with the Receipt add-on (fb_receipt_access enabled AND the plan not ended — the store's
// hasReceiptAccess, any plan) taps "Send all": a server job sends every Facebook buyer of that
// session ONE receipt picture in Messenger, one by one. The phone can be closed; the job runs here.
//
// The SAME machinery as the after-live automatic receipt (server/fbAutoReceipt.js), NOT its switch:
//   • the picture = server/receiptDraw.js drawReceiptPng (the seller's saved receipt format + the
//     Invoicing shipping fee, the order lines minus the lines cancelled for the invoice); when the seller
//     saved an edit of that buyer's receipt (sql/231 fb_receipt_edits, the Invoicing editor) the picture is
//     that edit instead — opening, lines, shipping fee, note — on the orders' buyer number / name / QR / words
//     (src/lib/receiptEdit.js applyReceiptEdit, the SAME function the phone's editor draws with);
//   • the send = fbReceipt.sendOne: the same per-buyer lock, claim, upload and ONE Graph call as the
//     automatic receipt (one private reply per comment, the fb_receipts unique index), with the
//     can_reply_privately preflight (false → the buyer is skipped);
//   • at most 10 sends per minute per seller. Jobs of different sellers run at the same time; one seller's
//     jobs one after another (a lane per seller; a waiting job keeps a heartbeat).
// Gate, per job and per request: fb_send_all_enabled = 'true' OR the seller is an admin, AND the
// add-on. fb_auto_receipt_enabled is never read here and nothing here queues an after-live job.
//
// A job row (sql/225 fb_send_all_jobs) per tap; the database lets a session have ONE job waiting or
// running (a second tap = the same job). A server restart in the middle: a job whose heartbeat is
// older than 3 minutes goes back to 'queued' and the next pass goes on (buyers already sent are
// skipped by the send itself).
//
// The phone only ever gets: per buyer number a tag (+ the time it was sent), and the job's counts.
// Never a PSID, a comment id, a page token or Facebook's error text.
import { checkReceiptRate, pickReceiptCandidates, isMixedBuyer, makeSendablePage, RECEIPT_WINDOW_MS, RECEIPT_THREAD_OWNED, AUTO_NO_PRIVATE_REPLY } from "./fbReceipt.js";
import { groupBuyers, makePreflight } from "./fbAutoReceipt.js";
import { drawReceiptPng, drawReceiptInputPng, receiptInputFromRows } from "./receiptDraw.js";
import { noEmoji as sharedNoEmoji, applyReceiptEdit, editPictureLines, cleanReceiptEdit } from "../src/lib/receiptEdit.js";
import { makeRateGate } from "./fbHardening.js";

export const SEND_ALL_RATE_MAX = 10;
export const SEND_ALL_RATE_WINDOW_MS = 60 * 1000;
// a job claimed but waiting behind the same seller's running job: a heartbeat at least this often
// (the database takes a job back after 3 minutes without one)
export const WAITER_BEAT_MS = 30 * 1000;
export const SEND_ALL_TICK_MS = 15 * 1000;
export const SEND_ALL_PENDING_FRESH_MS = 2 * 60 * 1000; // a 'pending' row this young = still sending
export const SEND_ALL_STATUS_RATE_MAX = 60;  // per seller per minute (the app polls every 4 s)
export const SEND_ALL_PREVIEW_RATE_MAX = 30; // per seller per minute
export const SEND_ALL_START_RATE_MAX = 20;   // per seller per minute
export const SEND_ALL_LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];

// The picture's words the automatic receipt does not have (the app's rd_rc_pic_shipping /
// rd_rc_pic_howto / rd_rc_pic_scan — a test pins them to the app's texts). Total / to be confirmed
// / "…and N more" come from receiptDraw's RECEIPT_LABELS, as for the automatic receipt.
export const SEND_ALL_LABELS = {
  en: { shipping: "Shipping fee", howToPay: "How to pay", scanToPay: "Scan to pay" },
  fil: { shipping: "Bayad sa shipping", howToPay: "Paano magbayad", scanToPay: "I-scan para magbayad" },
  zh: { shipping: "运费", howToPay: "付款方式", scanToPay: "扫码付款" },
  "zh-TW": { shipping: "運費", howToPay: "付款方式", scanToPay: "掃碼付款" },
  vi: { shipping: "Phí vận chuyển", howToPay: "Cách thanh toán", scanToPay: "Quét để thanh toán" },
  th: { shipping: "ค่าจัดส่ง", howToPay: "วิธีชำระเงิน", scanToPay: "สแกนเพื่อชำระเงิน" },
  id: { shipping: "Ongkos kirim", howToPay: "Cara bayar", scanToPay: "Pindai untuk bayar" },
  bg: { shipping: "Доставка", howToPay: "Как да платите", scanToPay: "Сканирайте, за да платите" },
};

// Emoji out of a text for the Send all picture (the server's Noto fonts have none). Moved to the shared
// src/lib/receiptEdit.js (the phone's Invoicing editor takes them out the same way); the same function.
export const noEmoji = sharedNoEmoji;
export const noEmojiRow = (r) => ({ ...r, customer_name: noEmoji(r.customer_name), handle: noEmoji(r.handle), product: noEmoji(r.product) });

// The tags the phone can get. sendable = the phone may offer "Send" / count it in "K left".
export const SEND_ALL_TAGS = ["not_sent", "sending", "sent", "other_app", "cant_message", "unknown"];
export const tagSendable = (tag) => tag === "not_sent" || tag === "other_app";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isReceiptKind = (r) => r && (r.kind == null || r.kind === "receipt");
const iso = (ms) => new Date(ms).toISOString();
const short = (id) => String(id || "").slice(0, 8);
const ACTIVE = new Set(["queued", "running"]);
export const jobActive = (job) => !!job && ACTIVE.has(String(job.status || ""));

// body → { sessionId, buyerNumber (null = every buyer), lang, currency } | null. PURE.
export function parseSendAllBody(body, { needBuyer = false } = {}) {
  const sessionId = String(body?.sessionId || "").trim();
  if (!UUID_RE.test(sessionId)) return null;
  const raw = body?.buyerNumber;
  let buyerNumber = null;
  if (raw !== undefined && raw !== null && raw !== "") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || n > 1_000_000) return null;
    buyerNumber = n;
  }
  if (needBuyer && buyerNumber === null) return null;
  const lang = SEND_ALL_LANGS.includes(String(body?.lang)) ? String(body.lang) : "en";
  const cur = String(body?.currency ?? "").trim();
  const currency = cur && cur.length <= 8 && !/[<>\n\r]/.test(cur) ? cur : "NT$";
  return { sessionId, buyerNumber, lang, currency };
}

// ONE buyer's tag. PURE.
//   orders  = that buyer's Facebook order rows (comment_msg_id, platform_meta, handle, created_at)
//   rows    = this seller's receipt rows for those comments (status, error_code, kind, sent_at, created_at)
//   job     = the session's newest job (or null); inScope = this buyer is one the job sends
// → { tag, at } (at = the newest send time, only for 'sent').
export function buyerTag({ orders, rows, job = null, inScope = false, nowMs = Date.now() }) {
  const receipts = (rows || []).filter(isReceiptKind);
  const sentAt = receipts.filter((r) => r.status === "sent").map((r) => String(r.sent_at || r.created_at || "")).filter(Boolean).sort().pop();
  if (receipts.some((r) => r.status === "sent")) return { tag: "sent", at: sentAt || null };
  const active = jobActive(job) && inScope;
  const pending = receipts.filter((r) => r.status === "pending");
  if (pending.length) {
    const young = pending.some((r) => nowMs - (Date.parse(r.created_at) || 0) < SEND_ALL_PENDING_FRESH_MS);
    return { tag: active || young ? "sending" : "unknown", at: null };
  }
  if (receipts.some((r) => r.error_code === AUTO_NO_PRIVATE_REPLY)) return { tag: "cant_message", at: null };
  if (isMixedBuyer(orders)) return { tag: "cant_message", at: null };
  const since = nowMs - RECEIPT_WINDOW_MS;
  const recent = (orders || []).filter((o) => (Date.parse(o.created_at) || 0) >= since);
  if (pickReceiptCandidates(recent, receipts).length === 0) return { tag: "cant_message", at: null };
  if (active) {
    const started = Date.parse(job.claimed_at || job.created_at || "") || 0;
    const tried = receipts.some((r) => (Date.parse(r.created_at) || 0) >= started);
    if (!tried) return { tag: "sending", at: null };
  }
  const newestFail = receipts.filter((r) => r.status === "failed").sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))[0];
  if (newestFail && String(newestFail.error_code || "") === RECEIPT_THREAD_OWNED) return { tag: "other_app", at: null };
  return { tag: "not_sent", at: null };
}

// The job's row → what the phone may see (counts and words only). PURE.
export function jobView(job) {
  if (!job) return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    state: String(job.status || ""), oneBuyer: job.buyer_number != null,
    total: n(job.total), sent: n(job.sent), skipped: n(job.skipped), failed: n(job.failed),
    stop: ["needs_messaging", "no_access", "not_allowed"].includes(String(job.note || "")) ? String(job.note) : null,
    startedAt: job.created_at ? String(job.created_at) : null, finishedAt: job.finished_at ? String(job.finished_at) : null,
  };
}

// sendOne answer → sent | skipped | none (busy) | failed | unknown | retry | needs_messaging | no_access.
// The automatic receipt's own mapping.
export function sendOutcome(out) {
  const j = out?.json || {};
  if (j.ok === true) return "sent";
  if (j.skipped || j.error === "cannot_reply_privately" || j.error === "mixed_buyer" || j.error === "none_left") return "skipped";
  if (j.error === "busy") return "none";
  if (j.error === "needs_messaging" || j.error === "no_access") return j.error;
  if (j.error === "send_failed") return "failed";
  if (j.error === "unknown_result") return "unknown";
  return "retry";
}

/**
 * deps.store:
 *   hasReceiptAccess(uid) → bool (add-on + plan not ended) · isAdmin(uid) → bool (throws on error)
 *   insertSendAllJob(row) → { id } | { conflict:true } | { error } · claimSendAllJobs(limit) → jobs
 *   touchSendAllJob(id, patch) · finishSendAllJob(id, patch) · latestSendAllJob(uid, sessionId) → job|null
 *   listSessionFbRows(uid, sessionId) → live_session_orders rows (Facebook, that session)
 *   listSessionReceipts(uid, sessionId) → fb_receipts rows of that session (this seller)
 *   listInvoiceSkips(uid, sessionId) → buyer numbers saved Sent by hand / Can't message / Cancelled
 *   listLineCancels(uid, sessionId) → order ids cancelled for the Facebook invoice
 *   getSendAllSettings(uid) → { opening, note, qrImage, shippingFee }
 *   listReceiptEdits(uid, sessionId) → that session's saved edits (sql/231): [{ buyer_number, opening, lines,
 *     shipping_fee, note }]; [] when there is none OR the table is not there yet; throws on a read error
 *   getPage(uid, pageId) (for the "can this Page message" check, as in fbReceipt)
 * deps.enabled() → fb_send_all_enabled is exactly 'true' (cached reader); deps.receipt = createFbReceipt(...).
 */
export function createSendAllRunner(deps) {
  const {
    store, receipt, enabled, config = {},
    preflight = makePreflight({ fetchImpl: deps.fetchImpl }),
    draw = drawReceiptPng,
    drawInput = drawReceiptInputPng,
    now = () => Date.now(), log = () => {},
    sleep = (ms) => new Promise((r) => { const h = setTimeout(r, ms); if (h && typeof h.unref === "function") h.unref(); }),
  } = deps;
  const rate = new Map(); // userId → send timestamps (in memory)
  const sendablePage = makeSendablePage(store, config);
  let claiming = false;
  let again = false;
  // ONE lane per seller: their jobs run one after another (so the 10-a-minute limit holds per seller);
  // the lanes of different sellers run at the same time. A job claimed while its seller's lane is busy
  // waits in the lane and keeps a heartbeat (else the database would take it back as stale_running).
  const lanes = new Map(); // userId → { tail: Promise, waiting: Map<jobId, job> }
  const inLane = new Set(); // job ids in a lane (waiting or running) — never queued twice
  const waiterBeat = new Map(); // waiting job id → last heartbeat sent (ms)

  const hasAccess = async (uid) => { try { return (await store.hasReceiptAccess(uid)) === true; } catch { return false; } };
  // switch OR admin; any read error = no
  const allowed = async (uid) => {
    try { if ((await enabled()) === true) return true; } catch { /* no */ }
    try { return (await store.isAdmin(uid)) === true; } catch { return false; }
  };

  // ONE buyer's picture, from that buyer's rows (lines cancelled for the invoice left out). Emoji are taken out
  // first (the server's fonts have none — they would be boxes in the buyer's Messenger).
  // With a saved edit: the orders' input (buyer number / name / QR / words / currency) with the edit on top.
  // No edit: exactly the call of before (byte-identical picture).
  async function picture(rows, settings, lang, currency, edit = null) {
    const s = {
      opening: noEmoji(settings.opening), note: noEmoji(settings.note), qrImage: settings.qrImage, shippingFee: settings.shippingFee,
      lang, currency, labels: SEND_ALL_LABELS[lang] || SEND_ALL_LABELS.en,
    };
    if (!edit) return draw(rows.map(noEmojiRow), s);
    return drawInput(applyReceiptEdit(receiptInputFromRows(rows.map(noEmojiRow), s), edit));
  }
  // buyer number → the saved edit (cleaned to sql/231's shape)
  const editsByBuyer = (list) => new Map((list || []).map((e) => [Number(e.buyer_number), cleanReceiptEdit(e)]));
  const editEmpty = (edit) => !!edit && editPictureLines(edit.lines).length === 0;
  // a store without the reader (older wiring, tests) = no edits
  const readEdits = async (uid, sid) => (typeof store.listReceiptEdits === "function" ? store.listReceiptEdits(uid, sid) : []);
  const keptRows = (rows, cancels) => (rows || []).filter((r) => !cancels.has(Number(r.id)));

  async function finish(job, status, note, c) {
    try {
      await store.finishSendAllJob(job.id, { status, note: String(note || "").slice(0, 200), finished_at: iso(now()), heartbeat_at: iso(now()), ...(c ? { sent: c.sent, skipped: c.skipped, failed: c.failed } : {}) });
    } catch { /* a stale job goes back to 'queued' after 3 minutes */ }
    log(`[FB] send-all job=${job.id} user=${short(job.user_id)} ${status} ${note || ""}${c ? ` sent=${c.sent} skipped=${c.skipped} failed=${c.failed}` : ""}`);
  }
  const touch = async (job, patch) => {
    try { await store.touchSendAllJob(job.id, { heartbeat_at: iso(now()), ...patch }); } catch { /* next touch */ }
    await beatWaiters(job.user_id);
  };
  // the waiting jobs of one seller (or of every seller): a heartbeat at most every WAITER_BEAT_MS each
  async function beatWaiters(uid) {
    const list = uid == null ? [...lanes.values()] : [lanes.get(uid)].filter(Boolean);
    const t = now();
    for (const lane of list) {
      for (const w of lane.waiting.values()) {
        if (t - (waiterBeat.get(w.id) || 0) < WAITER_BEAT_MS) continue;
        waiterBeat.set(w.id, t);
        try { await store.touchSendAllJob(w.id, { heartbeat_at: iso(t) }); } catch { /* next beat */ }
      }
    }
  }

  async function runJob(job) {
    const uid = job.user_id;
    if (!(await allowed(uid))) return finish(job, "stopped", "not_allowed");
    if (!(await hasAccess(uid))) return finish(job, "stopped", "no_access");
    let rows, skips, cancels, settings, edits;
    try {
      [rows, skips, cancels, settings, edits] = await Promise.all([
        store.listSessionFbRows(uid, job.session_id), store.listInvoiceSkips(uid, job.session_id),
        store.listLineCancels(uid, job.session_id), store.getSendAllSettings(uid), readEdits(uid, job.session_id),
      ]);
    } catch { return finish(job, "failed", "read_failed"); }   // never the orders' receipt over a saved edit
    const editOf = editsByBuyer(edits);
    const skip = new Set((skips || []).map(Number));
    const cut = new Set((cancels || []).map(Number));
    const buyers = groupBuyers(rows).filter((b) => b.sessionId === job.session_id && (job.buyer_number == null || b.buyerNumber === Number(job.buyer_number)));
    const c = { sent: 0, skipped: 0, failed: 0 };
    await touch(job, { total: buyers.length, sent: 0, skipped: 0, failed: 0 });
    for (const b of buyers) {
      const kept = keptRows(b.rows, cut);
      const edit = editOf.get(b.buyerNumber) || null;
      if (skip.has(b.buyerNumber) || kept.length === 0 || editEmpty(edit)) { c.skipped++; await touch(job, { ...c }); continue; }
      // 10 a minute: wait for a free place (heartbeat while waiting)
      for (;;) {
        const t = now();
        const r = checkReceiptRate(rate.get(uid), t, SEND_ALL_RATE_MAX, SEND_ALL_RATE_WINDOW_MS);
        if (r.allowed) { rate.set(uid, r.kept); break; }
        rate.set(uid, r.kept);
        const wait = Math.max(1000, (Math.min(...r.kept) + SEND_ALL_RATE_WINDOW_MS) - t);
        await touch(job, { ...c });
        await sleep(wait);
      }
      // the switch / add-on may change during a long job: asked again before every buyer
      if (!(await allowed(uid))) return finish(job, "stopped", "not_allowed", c);
      let out;
      try {
        out = await receipt.sendOne(uid, { sessionId: b.sessionId, buyerNumber: b.buyerNumber }, () => picture(kept, settings, job.lang, job.currency, edit), preflight);
      } catch { out = { status: 500, json: { ok: false, error: "draw_or_send_failed" } }; }
      const kind = sendOutcome(out);
      if (kind === "skipped" || kind === "none") {
        const k = rate.get(uid) || []; rate.set(uid, k.slice(0, -1)); // nothing went out: the place is given back
        c.skipped++;
      } else if (kind === "needs_messaging" || kind === "no_access") {
        return finish(job, "failed", kind, c);
      } else if (kind === "sent") c.sent++;
      else c.failed++;
      await touch(job, { ...c });
    }
    return finish(job, "done", "", c);
  }

  async function runSafe(job) {
    try { await runJob(job); } catch { await finish(job, "failed", "error"); }
  }
  // put a claimed job in its seller's lane; resolves when that job has finished
  function enqueue(job) {
    const uid = String(job.user_id || "");
    if (inLane.has(job.id)) return Promise.resolve();
    inLane.add(job.id);
    let lane = lanes.get(uid);
    if (!lane) { lane = { tail: Promise.resolve(), waiting: new Map() }; lanes.set(uid, lane); }
    lane.waiting.set(job.id, job);
    waiterBeat.set(job.id, now()); // the claim itself set the heartbeat
    const l = lane;
    const done = l.tail.then(async () => {
      l.waiting.delete(job.id); waiterBeat.delete(job.id);
      await runSafe(job);
    }).finally(() => {
      inLane.delete(job.id);
      if (l.tail === done && l.waiting.size === 0 && lanes.get(uid) === l) lanes.delete(uid);
    });
    l.tail = done;
    return done;
  }

  // One pass: claim every waiting job and put each in its seller's lane. Sellers run at the same time,
  // one job at a time per seller. Claiming never overlaps itself (a kick during a claim runs one more
  // claim right after); a kick while jobs RUN claims at once (a new seller does not wait for another's
  // job). Never throws. Resolves when the jobs it claimed have finished.
  async function tick() {
    await beatWaiters(null);
    if (claiming) { again = true; return 0; }
    claiming = true;
    const started = [];
    try {
      for (;;) {
        again = false;
        let jobs = [];
        try { jobs = (await store.claimSendAllJobs(5)) || []; } catch { jobs = []; }
        for (const job of jobs) started.push(enqueue(job));
        if (!jobs.length && !again) break; // nothing waiting and no tap during the claim
      }
    } finally { claiming = false; }
    await Promise.all(started);
    return started.length;
  }
  const kick = () => { void tick().catch(() => {}); };

  // ── routes' work ──
  async function start(uid, body) {
    if (!(await hasAccess(uid))) return { status: 403, json: { ok: false, error: "no_access" } };
    if (!(await allowed(uid))) return { status: 403, json: { ok: false, error: "not_allowed" } };
    const b = parseSendAllBody(body);
    if (!b) return { status: 400, json: { ok: false, error: "bad_request" } };
    let ins;
    try { ins = await store.insertSendAllJob({ user_id: uid, session_id: b.sessionId, buyer_number: b.buyerNumber, lang: b.lang, currency: b.currency, status: "queued" }); }
    catch { ins = { error: "insert_failed" }; }
    if (ins && ins.conflict) { kick(); return { status: 200, json: { ok: true, already: true } }; }
    if (!ins || ins.error || ins.id == null) return { status: 500, json: { ok: false, error: "start_failed" } };
    log(`[FB] send-all job=${ins.id} user=${short(uid)} queued${b.buyerNumber ? " one" : " all"}`);
    kick();
    return { status: 200, json: { ok: true, already: false } };
  }

  async function status(uid, body) {
    if (!(await hasAccess(uid))) return { status: 200, json: { ok: true, access: false } };
    if (!(await allowed(uid))) return { status: 200, json: { ok: true, access: true, allowed: false } };
    const b = parseSendAllBody(body);
    if (!b) return { status: 400, json: { ok: false, error: "bad_request" } };
    let rows, receipts, job;
    try {
      [rows, receipts, job] = await Promise.all([
        store.listSessionFbRows(uid, b.sessionId), store.listSessionReceipts(uid, b.sessionId), store.latestSendAllJob(uid, b.sessionId),
      ]);
    } catch { return { status: 502, json: { ok: false, error: "read_failed" } }; }
    const byComment = new Map();
    for (const r of receipts || []) {
      const id = String(r.comment_id || "");
      if (!byComment.has(id)) byComment.set(id, []);
      byComment.get(id).push(r);
    }
    const t = now();
    const buyers = groupBuyers(rows).filter((g) => g.sessionId === b.sessionId);
    const out = [];
    let pageId = "";
    for (const g of buyers) {
      const ids = new Set(g.rows.map((r) => String(r.comment_msg_id || "").trim()).filter(Boolean));
      const mine = [...ids].flatMap((id) => byComment.get(id) || []);
      const inScope = !!job && (job.buyer_number == null || Number(job.buyer_number) === g.buyerNumber);
      const { tag, at } = buyerTag({ orders: g.rows, rows: mine, job, inScope, nowMs: t });
      out.push(at ? { n: g.buyerNumber, tag, at } : { n: g.buyerNumber, tag });
      if (!pageId) { const m = g.rows.find((r) => r.platform_meta && r.platform_meta.page_id); if (m) pageId = String(m.platform_meta.page_id); }
    }
    // can the Page message at all? (one read; no Page found = nothing to say)
    let needsMessaging = false;
    if (pageId && out.some((x) => tagSendable(x.tag))) {
      try { needsMessaging = !(await sendablePage(uid, pageId)); } catch { needsMessaging = false; }
    }
    return { status: 200, json: { ok: true, access: true, allowed: true, job: jobView(job), needsMessaging, buyers: out } };
  }

  async function preview(uid, body) {
    if (!(await hasAccess(uid))) return { status: 403, json: { ok: false, error: "no_access" } };
    if (!(await allowed(uid))) return { status: 403, json: { ok: false, error: "not_allowed" } };
    const b = parseSendAllBody(body, { needBuyer: true });
    if (!b) return { status: 400, json: { ok: false, error: "bad_request" } };
    let rows, cancels, settings, edits;
    try {
      [rows, cancels, settings, edits] = await Promise.all([store.listSessionFbRows(uid, b.sessionId), store.listLineCancels(uid, b.sessionId), store.getSendAllSettings(uid), readEdits(uid, b.sessionId)]);
    } catch { return { status: 502, json: { ok: false, error: "read_failed" } }; }
    const g = groupBuyers(rows).find((x) => x.sessionId === b.sessionId && x.buyerNumber === b.buyerNumber);
    const kept = g ? keptRows(g.rows, new Set((cancels || []).map(Number))) : [];
    if (!kept.length) return { status: 404, json: { ok: false, error: "no_orders" } };
    const edit = editsByBuyer(edits).get(b.buyerNumber) || null;
    if (editEmpty(edit)) return { status: 404, json: { ok: false, error: "no_lines" } };
    try {
      const png = await picture(kept, settings, b.lang, b.currency, edit);
      return { status: 200, json: { ok: true, png: Buffer.from(png).toString("base64") } };
    } catch (e) {
      const why = String((e && e.message) || "").replace(/[^a-z_]/gi, "").slice(0, 40);
      return { status: 502, json: { ok: false, error: why === "qr_too_big" ? "qr_too_big" : "draw_failed" } };
    }
  }

  const wrap = (fn) => async (req, res) => {
    try {
      const out = await fn(req.authUserId, req.body || {});
      return res.status(out.status).json(out.json);
    } catch {
      return res.status(500).json({ ok: false, error: "server_error" });
    }
  };
  const gate = (max) => makeRateGate({ max, windowMs: 60 * 1000, now, keyOf: (req) => req.authUserId, onLimit: (_req, res) => res.status(429).json({ ok: false, error: "too_many_requests" }) });
  function registerRoutes(app, requireAuth) {
    app.post("/fb/sendall/start", requireAuth, gate(SEND_ALL_START_RATE_MAX), wrap(start));
    app.post("/fb/sendall/status", requireAuth, gate(SEND_ALL_STATUS_RATE_MAX), wrap(status));
    app.post("/fb/sendall/preview", requireAuth, gate(SEND_ALL_PREVIEW_RATE_MAX), wrap(preview));
  }

  return { start, status, preview, tick, kick, runJob, registerRoutes, _rate: rate, _lanes: lanes };
}
