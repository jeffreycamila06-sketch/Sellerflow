// FACEBOOK hardening helpers (Build 8) — pure, no I/O.
//   • appsecret_proof on every Graph request that carries a token (one fetch wrapper);
//   • one masker for any Facebook text that may reach a log (token → "[redacted]", URL → "[url]");
//   • a small per-key sliding-window gate (express middleware);
//   • Meta's signed_request (Deauthorize Callback) check.
import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH_HOSTNAME = "graph.facebook.com";

// A Facebook comment id ("<post>_<comment>" digits) — the one format check for every path that
// sends to a commenter (sold-out reply, picture receipt).
export const FB_COMMENT_ID_RE = /^[0-9_]{1,80}$/;
export const isFbCommentId = (v) => FB_COMMENT_ID_RE.test(String(v ?? ""));

// HMAC-SHA256(access token, app secret), hex — Meta's appsecret_proof.
export function appSecretProof(token, secret) {
  return createHmac("sha256", String(secret)).update(String(token)).digest("hex");
}

// A Graph URL with an access_token gets &appsecret_proof=… appended (the URL is otherwise left
// byte-for-byte as it was). No token / another host / already there / no secret → unchanged.
export function addAppSecretProof(url, secret) {
  const s = String(url);
  if (!secret) return s;
  let u;
  try { u = new URL(s); } catch { return s; }
  if (u.hostname !== GRAPH_HOSTNAME) return s;
  const token = u.searchParams.get("access_token");
  if (!token || u.searchParams.has("appsecret_proof")) return s;
  return `${s}${s.includes("?") ? "&" : "?"}appsecret_proof=${appSecretProof(token, secret)}`;
}

// fetch → the same fetch, with the proof added to every Graph request that carries a token.
export function withAppSecretProof(fetchImpl, secret) {
  if (typeof fetchImpl !== "function" || !secret || fetchImpl.__appSecretProof) return fetchImpl;
  const wrapped = (url, init) => fetchImpl(addAppSecretProof(url, secret), init);
  wrapped.__appSecretProof = true;
  return wrapped;
}

// Any text that may reach a log: whitespace collapsed, every copy of the token → "[redacted]",
// every URL → "[url]", cut to max characters.
export function maskSecretText(text, token = "", max = 300) {
  let out = String(text ?? "").replace(/\s+/g, " ").trim();
  if (token) out = out.split(String(token)).join("[redacted]");
  out = out.replace(/\bhttps?:\/\/\S+/gi, "[url]");
  return out.slice(0, max).trim();
}

// Sliding window per key: keyOf(req) → key ("" = let through). Over max → onLimit(req, res).
export function makeRateGate({ max, windowMs, keyOf, onLimit, now = () => Date.now(), maxKeys = 5000 }) {
  const hits = new Map();
  return function rateGate(req, res, next) {
    const key = String(keyOf(req) || "");
    if (!key) return next();
    const t = now();
    const kept = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (kept.length >= max) { hits.set(key, kept); return onLimit(req, res); }
    kept.push(t);
    hits.delete(key); hits.set(key, kept);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return next();
  };
}
// The client address for a per-IP gate. Behind Render's proxy req.ip is the proxy, so the RIGHT-most
// X-Forwarded-For entry (the one the proxy added; the left ones are client-supplied) wins.
export function ipOf(req) {
  const xff = String((req && req.headers && req.headers["x-forwarded-for"]) || "");
  const last = xff.split(",").map((x) => x.trim()).filter(Boolean).pop();
  return String(last || (req && (req.ip || (req.socket && req.socket.remoteAddress))) || "");
}

// Meta signed_request = base64url(signature) "." base64url(JSON payload); signature =
// HMAC-SHA256(payload part, app secret). → { userId, issuedAt, sig } or null (bad shape,
// wrong algorithm, wrong signature, no user id). Constant-time compare.
const b64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
export function parseSignedRequest(signed, secret) {
  if (!secret || typeof signed !== "string" || signed.length > 4096) return null;
  const dot = signed.indexOf(".");
  if (dot <= 0 || dot !== signed.lastIndexOf(".")) return null;
  const sigPart = signed.slice(0, dot), payloadPart = signed.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(sigPart) || !/^[A-Za-z0-9_-]+$/.test(payloadPart)) return null;
  const expected = createHmac("sha256", String(secret)).update(payloadPart).digest();
  const got = b64url(sigPart);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let payload;
  try { payload = JSON.parse(b64url(payloadPart).toString("utf8")); } catch { return null; }
  if (!payload || String(payload.algorithm || "").toUpperCase() !== "HMAC-SHA256") return null;
  const userId = String(payload.user_id ?? "").trim();
  if (!/^\d{1,40}$/.test(userId)) return null;
  const issuedAt = Number(payload.issued_at);
  return { userId, issuedAt: Number.isFinite(issuedAt) ? issuedAt : null, sig: sigPart };
}
// Test helper (and the shape Meta sends): sign a payload the way Meta does.
export function signRequestForTest(payload, secret) {
  const enc = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const p = enc(JSON.stringify(payload));
  return `${enc(createHmac("sha256", String(secret)).update(p).digest())}.${p}`;
}
