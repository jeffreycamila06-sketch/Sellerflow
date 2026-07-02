// Raffle Roleta — PURE logic (no React / no Supabase). Entries are COMPUTED from
// the already-loaded live session orders (LiveOrder.orderNum is EPOCH MS — the
// protected invariant — so it doubles as the order's created_at). No entries
// table, no new query: filter since enabled_at, group by buyer, cap 3.
// The winner is picked FIRST via a weighted draw (entries = weights, rand
// injected for testability), THEN the wheel animates deterministically onto the
// winner's slice (spinTarget). All unit-tested.
import type { LiveOrder, Buyer } from "../../lib/orderTypes";

export interface RaffleEntry {
  key: string;         // stable buyer identity (handle+platform, fallback #bNum)
  bNum: number;
  label: string;       // display: @handle, else name, else #bNum
  displayName: string; // buyer's name from the order ("" when the order has none)
  entries: number;     // 1..3 (MAX 3 per buyer — fairness cap)
  colorIndex: number;  // 0..7 — stable per buyer; wheel slice + legend dot match
}

export const RAFFLE_MAX_ENTRIES = 3;

// 8-color wheel palette (redesign accent family). Literal hexes on purpose —
// the wheel is a fixed festive palette, independent of the seller's theme.
export const RAFFLE_COLORS = ["#6366F1", "#14B8A6", "#F97316", "#EC4899", "#3B82F6", "#F59E0B", "#22C55E", "#EF4444"];

const buyerKey = (o: LiveOrder): string =>
  o.handle ? `${o.handle.toLowerCase()}|${o.platform}` : `#${o.bNum}`;
const buyerLabel = (o: LiveOrder): string =>
  o.handle ? `@${o.handle.replace(/^@+/, "")}` : (o.name || `#${o.bNum}`);

// Orders placed while Games is ON → one entry each, capped at 3 per buyer.
// Boundary is INCLUSIVE (orderNum >= enabledAtMs). Order of appearance is kept
// (first buyer to order = first slice).
export function computeRaffleEntries(orders: LiveOrder[], enabledAtMs: number): RaffleEntry[] {
  const byBuyer = new Map<string, RaffleEntry>();
  for (const o of orders) {
    if (!Number.isFinite(o.orderNum) || o.orderNum < enabledAtMs) continue;
    const key = buyerKey(o);
    const existing = byBuyer.get(key);
    if (existing) existing.entries = Math.min(existing.entries + 1, RAFFLE_MAX_ENTRIES);
    else byBuyer.set(key, { key, bNum: o.bNum, label: buyerLabel(o), displayName: (o.name || "").trim(), entries: 1, colorIndex: byBuyer.size % RAFFLE_COLORS.length });
  }
  return Array.from(byBuyer.values());
}

// Weighted draw: entries (1..3) are the weights. `rand` ∈ [0,1) is injected so
// tests are deterministic (production passes Math.random()). Returns the index
// into `pool`, or -1 when the pool is empty.
export function pickWeightedWinner(pool: RaffleEntry[], rand: number): number {
  const total = pool.reduce((s, e) => s + e.entries, 0);
  if (total <= 0) return -1;
  let r = Math.min(Math.max(rand, 0), 0.999999) * total;
  for (let i = 0; i < pool.length; i++) {
    r -= pool[i].entries;
    if (r < 0) return i;
  }
  return pool.length - 1;
}

// Absolute wheel rotation (deg) that lands slice `idx` (of `count` equal slices)
// under the top pointer, always spinning FORWARD ≥5 full turns from `prev`.
// `rand` adds a small jitter inside the slice (±30% of its width) so landings
// don't look robotic — still fully deterministic for a given rand.
export function spinTarget(prev: number, idx: number, count: number, rand: number): number {
  const slice = 360 / Math.max(1, count);
  const center = (idx + 0.5) * slice;
  const jitter = (Math.min(Math.max(rand, 0), 1) - 0.5) * slice * 0.6;
  const targetMod = ((360 - center - jitter) % 360 + 360) % 360; // slice center at pointer (0°)
  const base = Math.floor(prev / 360) * 360 + 5 * 360;           // ≥5 forward turns
  return base + targetMod;
}

// conic-gradient stops for the wheel (equal slices, buyer-stable colors).
export function wheelGradient(pool: RaffleEntry[]): string {
  if (pool.length === 0) return RAFFLE_COLORS[0];
  const slice = 360 / pool.length;
  return `conic-gradient(${pool
    .map((e, i) => `${RAFFLE_COLORS[e.colorIndex]} ${(i * slice).toFixed(2)}deg ${((i + 1) * slice).toFixed(2)}deg`)
    .join(", ")})`;
}

// Winner display: "Name (@handle)" when both exist. When there is no handle the
// label already IS the name (or #bNum), so the label alone avoids "Name (Name)".
export function entryDisplay(e: RaffleEntry): string {
  return e.displayName && e.label.startsWith("@") ? `${e.displayName} (${e.label})` : e.label;
}

// Winner ticket → SYNTHETIC Buyer fed through the EXISTING printSlip pipeline
// (same idiom as buildTestStickerPayload's test buyer). No TSPL/native touch:
// buyer.num → "Buyer #N", name/handle → the existing name/@handle lines, the
// single order's item carries the ticket label — "WINNER" (≤12 chars: the
// order-item column truncates at 12, so "RAFFLE WINNER" printed cut off).
// orderNum = nowMs (epoch ms > 1e12) so the native builder derives the correct
// Taipei print time; nowMs is injected for deterministic tests. ASCII-only
// label — the AIMO D520BT renders ASCII + Simplified Chinese only.
export function buildWinnerTicketBuyer(e: RaffleEntry, nowMs: number): Buyer {
  const handle = e.label.startsWith("@") ? e.label.slice(1) : "";
  const platform = e.key.includes("|") ? e.key.split("|")[1] : "TikTok";
  const taipei = (opt: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", ...opt }).format(new Date(nowMs));
  const order: LiveOrder = {
    orderNum: nowMs, item: "WINNER", qty: 1, price: 0, total: 0,
    time: taipei({ hour: "2-digit", minute: "2-digit", hour12: false }),
    handle, name: e.displayName || e.label, bNum: e.bNum, platform, status: "New",
    date: taipei({ year: "numeric", month: "2-digit", day: "2-digit" }),
  };
  return { handle, name: e.displayName || e.label, platform, num: e.bNum, orders: [order], totalSpent: 0, totalOrders: 1 };
}
