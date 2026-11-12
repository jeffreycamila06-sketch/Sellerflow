// Admin downgrade (sql/154) — stop the running live of an account the admin just REMOVED.
// PURE (injected deps), unit-tested by vitest; server.js only wires it.
//
// Why it exists: the Facebook / Instagram / Shopee pollers keep their token in memory and
// do not re-read the account row on every tick, so a deleted row alone does not stop a
// live that is already running. The seller's own Remove stops it first (…/disconnect);
// this is the same stop for the admin's removal.
//
// SAFETY: it stops ONLY an account whose row is really gone (stillConnected → false). An
// account that is still connected — or whose row could not be read — is never stopped, so
// this route can never cut a live of an account the seller still has. TikTok is not
// handled here (a removed TikTok name is refused at its next connect).

export const ADMIN_STOP_MAX_ITEMS = 20;
const PLATFORMS = new Set(["facebook", "instagram", "shopee"]);

// body.accounts → [{platform, key}] (known platforms, non-empty keys, no repeats, capped).
export function parseStopItems(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const it of raw) {
    const platform = String((it && it.platform) || "").trim().toLowerCase();
    const key = String((it && it.key) == null ? "" : it.key).trim();
    if (!PLATFORMS.has(platform) || !key || key.length > 64) continue;
    const id = `${platform}:${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ platform, key });
    if (out.length >= ADMIN_STOP_MAX_ITEMS) break;
  }
  return out;
}

// runtimes: { facebook|instagram|shopee: { stillConnected(userId, key) → Promise<boolean>,
//             stop(userId, key) → boolean } } — a platform that is not running is omitted.
// → { stopped, results: [{ platform, stopped, reason }] }   reason: stopped | not_running |
//   still_connected | check_failed | unavailable. Never throws.
export async function stopRemovedAccounts({ userId, items, runtimes }) {
  const results = [];
  let stopped = 0;
  for (const it of items) {
    const rt = runtimes && runtimes[it.platform];
    if (!rt) { results.push({ platform: it.platform, stopped: false, reason: "unavailable" }); continue; }
    let connected;
    try { connected = await rt.stillConnected(userId, it.key); }
    catch { results.push({ platform: it.platform, stopped: false, reason: "check_failed" }); continue; }
    if (connected !== false) { results.push({ platform: it.platform, stopped: false, reason: "still_connected" }); continue; }
    let did = false;
    try { did = rt.stop(userId, it.key) === true; } catch { did = false; }
    if (did) stopped += 1;
    results.push({ platform: it.platform, stopped: did, reason: did ? "stopped" : "not_running" });
  }
  return { stopped, results };
}
