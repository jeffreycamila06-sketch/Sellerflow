// FACEBOOK MESSENGER RECEIPT — who holds this buyer's conversation? LOG ONLY (2026-11-24).
// A private reply can fail with Graph error 10 / subcode 2018300 ("another app is controlling this
// thread now"). To learn WHO, right after such a failure the server asks Facebook two read-only
// questions about that buyer's conversation and writes ONE log line:
//   GET /{page-id}/thread_owner?recipient=<buyer id>              → the app id that holds it
//   GET /{page-id}/conversations?platform=messenger&user_id=<buyer id>&fields=id,updated_time
//                                                                → is there a chat, how old
// The line holds app ids, counts, minutes and Graph error codes only — never the buyer id, a
// name, a message text or the token. Nothing here sends, takes control or changes a setting, and
// nothing here can change the send's answer: every error is swallowed.
// ⚠️ 2026-11-25 (production): 16 reads answered "owner=shape" — the /thread_owner answer had no app id.
// Meta moved every Page from the Handover Protocol to Conversation Routing. What /thread_owner answers
// there (Meta's Conversation Routing page, as quoted in search results — developers.facebook.com cannot be
// opened from the build session, so NOT read first-hand):
//   the caller owns the thread or is the Page's default app → { data: [ { thread_owner: { app_id, expiration } } ] }
//   another app holds it and the thread is not idle        → thread_owner with an expiration only, NO app id
//   otherwise                                              → an empty answer
// So: owner=app (+ who=<app id>) | owner=hidden (held, Meta does not say by whom) | owner=none (empty) |
// owner=err | owner=shape. Whenever no app id was read, the answer's SHAPE is recorded too — field names and
// value TYPES only (answerShape), never a value — so the next answer nobody expected explains itself.
import { GRAPH_VERSION } from "./fbConfig.js";
import { GRAPH_HOST } from "./fbLive.js";

export const OWNER_READ_TIMEOUT_MS = 6000;
export const OWNER_READ_MAX_PER_HOUR = 30; // per Page, in memory
// Facebook's own Page Inbox. Meta's Handover Protocol pages give this id as the target for "pass to the Page
// Inbox"; seen here only through search results and third-party docs that quote it (the site is blocked).
export const FB_PAGE_INBOX_APP_ID = "263902037430900";
export const OWNER_SHAPE_MAX = 200;   // characters of a recorded shape
export const OWNER_SHAPE_DEPTH = 3;   // levels of key names
export const OWNER_SHAPE_KEYS = 12;   // key names per object

const DIGITS = /^\d{5,32}$/;
export const isBuyerId = (v) => typeof v === "string" && DIGITS.test(v);

// Key names only, for an answer of an unexpected shape: letters / underscore, no digits, short.
export function safeKeyNames(obj, max = 8) {
  if (!obj || typeof obj !== "object") return "-";
  const names = Object.keys(obj).slice(0, max).map((k) => String(k).replace(/[^A-Za-z_]/g, "").slice(0, 24)).filter(Boolean);
  return names.length ? names.join(",") : "-";
}

// ── The SHAPE of an answer: key names + value types, never a value ─────────────────────────────────
// { data: [ { thread_owner: { app_id: "1" } } ] }  →  data[0]{thread_owner{app_id:str}}
// A key name is kept ONLY when the whole of it looks like a Graph field name: lower-case letters and
// underscores, 24 characters at most. Any other key — an id, a token, a name, anything with a capital, a
// digit, a space or a dot — is data, not a field name, and is written "?". An array shows its first element
// only; below OWNER_SHAPE_DEPTH levels just "obj" / "arr".
const FIELD_NAME = /^[a-z][a-z_]{0,23}$/;
const shapeKey = (k) => (FIELD_NAME.test(String(k)) ? String(k) : "?");
const shapeType = (v) => (v === null ? "null" : Array.isArray(v) ? "arr" : typeof v === "object" ? "obj"
  : typeof v === "string" ? "str" : typeof v === "number" ? "num" : typeof v === "boolean" ? "bool" : "other");
function shapeMembers(obj, depth) {
  const keys = Object.keys(obj);
  const out = keys.slice(0, OWNER_SHAPE_KEYS).map((k) => shapeKey(k) + shapeValue(obj[k], depth));
  if (keys.length > OWNER_SHAPE_KEYS) out.push(`+${keys.length - OWNER_SHAPE_KEYS}`);
  return out.join(",");
}
// what follows a key name (depth = levels of key names still allowed below this value)
function shapeValue(v, depth) {
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const first = v[0];
    if (first && typeof first === "object" && !Array.isArray(first)) return depth > 0 ? `[0]{${shapeMembers(first, depth - 1)}}` : "[0]:obj";
    return `[0]:${shapeType(first)}`;
  }
  if (v && typeof v === "object") return depth > 0 ? `{${shapeMembers(v, depth - 1)}}` : ":obj";
  return `:${shapeType(v)}`;
}
export function answerShape(body, max = OWNER_SHAPE_MAX) {
  let out;
  try {
    if (Array.isArray(body)) out = shapeValue(body, OWNER_SHAPE_DEPTH);
    else if (body && typeof body === "object") out = shapeMembers(body, OWNER_SHAPE_DEPTH - 1) || "{}";
    else out = shapeType(body);
  } catch { out = "unreadable"; }
  return String(out).replace(/[^A-Za-z_0-9[\]{}:,+?]/g, "").slice(0, max) || "-";
}

const errOf = (b) => (b && b.error && typeof b.error === "object"
  ? `${Number(b.error.code) || 0}/${Number(b.error.error_subcode) || 0}` : "");

const APP_ID = /^\d{3,24}$/;
const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

// Graph answer of /thread_owner → { owner, who, err, keys, shape }
//   owner: "app" (who = the app id) | "hidden" | "none" | "err" | "shape";  shape: "" when an app id was read
//   or Facebook answered an error, else the answer's shape (answerShape).
// Accepted: data[0].thread_owner (Meta's documented form) and a bare thread_owner object at the top (not
// documented — read the same way so one more deploy is not needed for it). The app id may be text or a number.
export function parseThreadOwner(body) {
  const e = errOf(body);
  if (e) return { owner: "err", who: "", err: e, keys: "", shape: "" };
  const top = asObject(body);
  const list = top && Array.isArray(top.data) ? top.data : null;
  const shaped = (owner) => ({ owner, who: "", err: "", keys: "", shape: answerShape(body) });
  if (list && list.length === 0) return shaped("none");
  const first = list ? asObject(list[0]) : null;
  const to = asObject(first && first.thread_owner) || asObject(top && top.thread_owner);
  if (!to) return shaped(first && Object.keys(first).length === 0 ? "none" : "shape");
  const id = typeof to.app_id === "string" || typeof to.app_id === "number" ? String(to.app_id).trim() : "";
  if (APP_ID.test(id)) return { owner: "app", who: id, err: "", keys: "", shape: "" };
  if (id === "" && to.app_id === undefined) {
    if (Object.keys(to).length === 0) return shaped("none");
    if (to.expiration !== undefined) return shaped("hidden");   // held by an app Meta does not name to us
  }
  return shaped("shape");
}

// Graph answer of /conversations → { conv: "<count>" | "err" | "shape", ageMin: "<minutes>" | "-", err, keys }
export function parseConversation(body, nowMs) {
  const e = errOf(body);
  if (e) return { conv: "err", ageMin: "-", err: e, keys: "" };
  const list = body && Array.isArray(body.data) ? body.data : null;
  if (!list) return { conv: "shape", ageMin: "-", err: "", keys: safeKeyNames(body) };
  if (list.length === 0) return { conv: "0", ageMin: "-", err: "", keys: "" };
  const t = Date.parse(String((list[0] && list[0].updated_time) || ""));
  const age = Number.isFinite(t) ? String(Math.max(0, Math.round((nowMs - t) / 60000))) : "-";
  return { conv: String(Math.min(list.length, 99)), ageMin: age, err: "", keys: age === "-" ? safeKeyNames(list[0]) : "" };
}

async function getJson(fetchImpl, url, timeoutMs) {
  const ac = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(url, { method: "GET", ...(ac ? { signal: ac.signal } : {}) });
    const body = await r.json().catch(() => null);
    return { http: Number(r.status) || 0, body };
  } catch {
    return { http: 0, body: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// → { owner, who, shape, ownerHttp, ownerErr, conv, convAgeMin, convHttp, convErr, keys, ms }. Never throws.
export async function readThreadOwner({ fetchImpl, pageId, buyerId, pageToken, now = () => Date.now(), timeoutMs = OWNER_READ_TIMEOUT_MS }) {
  const t0 = now();
  const base = `${GRAPH_HOST}/${GRAPH_VERSION}/${encodeURIComponent(pageId)}`;
  const tok = `access_token=${encodeURIComponent(pageToken)}`;
  const [a, b] = await Promise.all([
    getJson(fetchImpl, `${base}/thread_owner?recipient=${encodeURIComponent(buyerId)}&${tok}`, timeoutMs),
    getJson(fetchImpl, `${base}/conversations?platform=messenger&user_id=${encodeURIComponent(buyerId)}&fields=id,updated_time&${tok}`, timeoutMs),
  ]);
  const o = a.http === 0 ? { owner: "err", who: "", err: "", keys: "", shape: "" } : parseThreadOwner(a.body);
  const c = b.http === 0 ? { conv: "err", ageMin: "-", err: "", keys: "" } : parseConversation(b.body, now());
  return {
    owner: o.owner, who: o.who || "-", shape: o.shape || "-", ownerHttp: a.http, ownerErr: o.err || "-",
    conv: c.conv, convAgeMin: c.ageMin, convHttp: b.http, convErr: c.err || "-",
    keys: [o.keys, c.keys].filter(Boolean).join("|") || "-", ms: Math.max(0, now() - t0),
  };
}

// who_is = "us" (our own app) | "inbox" (Facebook's Page Inbox) | "other" | "-" (no app id read).
export function ownerWhoIs(who, ourAppId) {
  if (!APP_ID.test(String(who))) return "-";
  if (ourAppId && String(who) === String(ourAppId)) return "us";
  return String(who) === FB_PAGE_INBOX_APP_ID ? "inbox" : "other";
}

const shapePart = (r) => (r.shape && r.shape !== "-" ? ` shape=${r.shape}` : "");

// The short text kept next to the failed row (fb_receipts.error_detail): an app id, words and counts only.
export function ownerNote(r, ourAppId) {
  return `owner=${r.owner} who=${r.who} who_is=${ownerWhoIs(r.who, ourAppId)} owner_err=${r.ownerErr} conv=${r.conv} conv_age_min=${r.convAgeMin} conv_err=${r.convErr}${shapePart(r)}`;
}
// Facebook's own words (first) + the note; never longer than OWNER_ROW_DETAIL_MAX — the words give way, not the note.
export const OWNER_ROW_DETAIL_MAX = 600;
export function ownerRowDetail(detail, r, ourAppId) {
  const note = ` | ${ownerNote(r, ourAppId)}`;
  return `${String(detail || "").slice(0, Math.max(0, OWNER_ROW_DETAIL_MAX - note.length))}${note}`.slice(0, OWNER_ROW_DETAIL_MAX);
}

export function ownerLogLine(userId, pageId, r, ourAppId) {
  return `[FB] receipt owner user=${String(userId).slice(0, 8)} page=${pageId} owner=${r.owner} who=${r.who} who_is=${ownerWhoIs(r.who, ourAppId)} owner_http=${r.ownerHttp} owner_err=${r.ownerErr}`
    + ` conv=${r.conv} conv_age_min=${r.convAgeMin} conv_http=${r.convHttp} conv_err=${r.convErr} keys=${r.keys} ms=${r.ms}${shapePart(r)}`;
}

// At most `max` reads per Page per hour (in memory). → true when this read may run.
export function makeOwnerReadGate({ max = OWNER_READ_MAX_PER_HOUR, windowMs = 60 * 60 * 1000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return function allow(pageId) {
    const t = now();
    const kept = (hits.get(pageId) || []).filter((x) => t - x < windowMs);
    if (kept.length >= max) { hits.set(pageId, kept); return false; }
    kept.push(t);
    hits.set(pageId, kept);
    if (hits.size > 2000) hits.delete(hits.keys().next().value);
    return true;
  };
}
