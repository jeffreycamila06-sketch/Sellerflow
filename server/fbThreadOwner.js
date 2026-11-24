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
// ⚠️ The two answers' shapes are from Meta's docs as remembered, never measured: an answer of
// another shape is logged as "shape" with its key NAMES, never silently dropped.
import { GRAPH_VERSION } from "./fbConfig.js";
import { GRAPH_HOST } from "./fbLive.js";

export const OWNER_READ_TIMEOUT_MS = 6000;
export const OWNER_READ_MAX_PER_HOUR = 30; // per Page, in memory
export const FB_PAGE_INBOX_APP_ID = "263902037430900"; // Facebook's own Page inbox (vendor docs)

const DIGITS = /^\d{5,32}$/;
export const isBuyerId = (v) => typeof v === "string" && DIGITS.test(v);

// Key names only, for an answer of an unexpected shape: letters / underscore, no digits, short.
export function safeKeyNames(obj, max = 8) {
  if (!obj || typeof obj !== "object") return "-";
  const names = Object.keys(obj).slice(0, max).map((k) => String(k).replace(/[^A-Za-z_]/g, "").slice(0, 24)).filter(Boolean);
  return names.length ? names.join(",") : "-";
}

const errOf = (b) => (b && b.error && typeof b.error === "object"
  ? `${Number(b.error.code) || 0}/${Number(b.error.error_subcode) || 0}` : "");

// Graph answer of /thread_owner → { owner: "<app id>" | "none" | "err" | "shape", err, keys }
export function parseThreadOwner(body) {
  const e = errOf(body);
  if (e) return { owner: "err", err: e, keys: "" };
  const list = body && Array.isArray(body.data) ? body.data : null;
  if (!list) return { owner: "shape", err: "", keys: safeKeyNames(body) };
  if (list.length === 0) return { owner: "none", err: "", keys: "" };
  const first = list[0] && typeof list[0] === "object" ? list[0] : null;
  const to = first && first.thread_owner && typeof first.thread_owner === "object" ? first.thread_owner : null;
  const id = to && (typeof to.app_id === "string" || typeof to.app_id === "number") ? String(to.app_id) : "";
  if (/^\d{3,24}$/.test(id)) return { owner: id, err: "", keys: "" };
  return { owner: "shape", err: "", keys: safeKeyNames(to || first) };
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

// → { owner, ownerHttp, ownerErr, conv, convAgeMin, convHttp, convErr, keys, ms }. Never throws.
export async function readThreadOwner({ fetchImpl, pageId, buyerId, pageToken, now = () => Date.now(), timeoutMs = OWNER_READ_TIMEOUT_MS }) {
  const t0 = now();
  const base = `${GRAPH_HOST}/${GRAPH_VERSION}/${encodeURIComponent(pageId)}`;
  const tok = `access_token=${encodeURIComponent(pageToken)}`;
  const [a, b] = await Promise.all([
    getJson(fetchImpl, `${base}/thread_owner?recipient=${encodeURIComponent(buyerId)}&${tok}`, timeoutMs),
    getJson(fetchImpl, `${base}/conversations?platform=messenger&user_id=${encodeURIComponent(buyerId)}&fields=id,updated_time&${tok}`, timeoutMs),
  ]);
  const o = a.http === 0 ? { owner: "err", err: "", keys: "" } : parseThreadOwner(a.body);
  const c = b.http === 0 ? { conv: "err", ageMin: "-", err: "", keys: "" } : parseConversation(b.body, now());
  return {
    owner: o.owner, ownerHttp: a.http, ownerErr: o.err || "-",
    conv: c.conv, convAgeMin: c.ageMin, convHttp: b.http, convErr: c.err || "-",
    keys: [o.keys, c.keys].filter(Boolean).join("|") || "-", ms: Math.max(0, now() - t0),
  };
}

// who = "ours" | "inbox" | "other" | "-" (no app id read). The app id itself is logged too.
export function ownerWho(owner, ourAppId) {
  if (!/^\d+$/.test(String(owner))) return "-";
  if (ourAppId && String(owner) === String(ourAppId)) return "ours";
  return String(owner) === FB_PAGE_INBOX_APP_ID ? "inbox" : "other";
}

// The short text kept next to the failed row (fb_receipts.error_detail): app id + counts only.
export function ownerNote(r, ourAppId) {
  return `owner=${r.owner} who=${ownerWho(r.owner, ourAppId)} owner_err=${r.ownerErr} conv=${r.conv} conv_age_min=${r.convAgeMin} conv_err=${r.convErr}`;
}

export function ownerLogLine(userId, pageId, r, ourAppId) {
  return `[FB] receipt owner user=${String(userId).slice(0, 8)} page=${pageId} owner=${r.owner} who=${ownerWho(r.owner, ourAppId)} owner_http=${r.ownerHttp} owner_err=${r.ownerErr}`
    + ` conv=${r.conv} conv_age_min=${r.convAgeMin} conv_http=${r.convHttp} conv_err=${r.convErr} keys=${r.keys} ms=${r.ms}`;
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
