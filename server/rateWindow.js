// Fixed-window per-user rate limit (same style as gmValidateAllowed in server.js):
// the first hit opens a window; at most `max` hits per `windowMs` per user. Old
// windows are dropped as they are seen, so the map never grows past active users.
export function createWindowLimiter({ max, windowMs }) {
  const hits = new Map(); // userId → { count, windowStart }
  return function allowed(userId, now = Date.now()) {
    const key = String(userId || "");
    const h = hits.get(key);
    if (!h || now - h.windowStart > windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      if (hits.size > 5000) for (const [k, v] of hits) if (now - v.windowStart > windowMs) hits.delete(k);
      return true;
    }
    h.count += 1;
    return h.count <= max;
  };
}

// Audit Oct 13 item 12: the 7-11 E-Map store check — 30 per minute per seller. Every check
// is a request from the shared server IP to 7-11; one seller looping it could get that IP
// blocked for everyone.
export const EMAP_CHECK_MAX_PER_MIN = 30;
