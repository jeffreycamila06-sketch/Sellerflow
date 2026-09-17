// I2 (not-printed persistence) — a small localStorage set of "this order's web
// sticker didn't print" markers, so the Dashboard "Not printed" badge + one-tap
// Reprint SURVIVE a reload (the in-memory badge alone was lost on refresh → an
// un-printed parcel silently shipped label-less).
//
// KEY CHOICE (deviation from the audit's "orderNum", documented): the marker key
// is the order's STABLE identifier — the TikTok msgId when present, else an
// "o:<orderNum>" fallback. orderNum is create-time Date.now() (orderLogic:33),
// but a RELOADED order rebuilds its orderNum from the DB created_at
// (orderLogic:96), which is the later insert time — so a create-time orderNum
// never matches the reloaded order. msgId is the only id that a restored comment
// row carries unchanged across a reload, so it is what makes the badge persist.
// FB rows (no msgId) fall back to o:<orderNum> → session-only in practice (they
// don't restore with a stable key anyway); that's the accepted limit.
//
// Per-seller key + a hard cap so the set can't grow unbounded on a shared device.
// Web-only (the caller gates on !isAppShell); best-effort (a disabled/full
// localStorage degrades to a no-op, never throws).

const CAP = 200;
const keyFor = (sellerId: string | null | undefined): string => `sfl_rd_notprinted_${sellerId || "anon"}`;

// Stable per-order marker: prefer the TikTok msgId; else the create-time orderNum
// (FB / no-msgId → session-scoped in practice).
export function notPrintedKeyOf(orderNum: number | string, msgId?: string | null): string {
  const m = String(msgId || "").trim();
  return m || `o:${orderNum}`;
}

export function loadNotPrinted(sellerId: string | null | undefined): string[] {
  try {
    const raw = localStorage.getItem(keyFor(sellerId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((k): k is string => typeof k === "string") : [];
  } catch { return []; }
}

function save(sellerId: string | null | undefined, keys: string[]): string[] {
  const capped = keys.length > CAP ? keys.slice(-CAP) : keys; // keep the most recent
  try { localStorage.setItem(keyFor(sellerId), JSON.stringify(capped)); } catch { /* best-effort */ }
  return capped;
}

// Add a marker (idempotent) → returns the new capped list.
export function addNotPrinted(sellerId: string | null | undefined, key: string): string[] {
  const cur = loadNotPrinted(sellerId);
  if (cur.includes(key)) return cur;
  return save(sellerId, [...cur, key]);
}

// Remove a marker (on a successful (re)print) → returns the new list.
export function removeNotPrinted(sellerId: string | null | undefined, key: string): string[] {
  const cur = loadNotPrinted(sellerId);
  if (!cur.includes(key)) return cur;
  return save(sellerId, cur.filter((k) => k !== key));
}
