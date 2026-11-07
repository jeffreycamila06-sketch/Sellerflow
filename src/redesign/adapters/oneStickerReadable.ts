// ONE STICKER — READABILITY GUARD (Jeff: every language prints clean and readable; the system adjusts,
// not the seller).
//
// For each printed line the engine asks: with the seller's weight (and, on the lighter heads, the
// 1-dot ink), does every letter keep its shape? A letter "closes" when, compared with the same
// letter in Normal without the extra ink at the SAME size:
//   • a counter fills in (no open hole left where the Normal letter has one — e, a, 口, 田 …;
//     pinholes of a few dots in the Normal outline do not count), or
//   • two strokes run into each other (fewer separate pieces of ink — i, 二, 三, ห …), or
//   • two neighbouring letters touch (fewer separate pieces of ink in the whole line).
// If anything closes, the line prints one step lighter — first without the 1-dot ink, then
// Extra → Bold → Normal (each with the ink first, then without) — until every letter is open.
// Never bigger or smaller: only lighter. The preview draws the same decision (one function), and the
// seller's saved setting stays as chosen.
import type { GlyphBits, SansWeight } from "./oneStickerFonts";

export interface Topology {
  holes: number[];      // area of each enclosed white area (open counter), in dots
  cells: number[][];    // the dots of each hole, as pen-space keys (x + 0x8000) * 0x10000 + (y + 0x8000)
  parts: number;        // separate pieces of ink (8-connected)
}
const keyOf = (x: number, y: number) => (x + 0x8000) * 0x10000 + (y + 0x8000);
/** Open counters and separate pieces of ink; `ox`/`oy` = where the bitmap sits in pen space. PURE. */
export function topology(g: GlyphBits, ox = g.x0, oy = g.y0): Topology {
  if (!g.w || !g.h) return { holes: [], cells: [], parts: 0 };
  const W = g.w + 2, H = g.h + 2; // 1-dot white frame
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.buf[y * g.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) ink[(y + 1) * W + x + 1] = 1;
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  const parts = countParts(ink, seen, W, H, stack);
  // white areas (4-connected): first the outside (it touches the 1-dot frame), then every enclosed one
  const flood = (start: number, dots: number[] | null) => {
    seen[start] = 1; stack.push(start);
    while (stack.length) {
      const p = stack.pop()!, x = p % W;
      if (dots) dots.push(keyOf(x - 1 + ox, (p - x) / W - 1 + oy));
      if (x + 1 < W && !ink[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (x > 0 && !ink[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (p + W < W * H && !ink[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
      if (p - W >= 0 && !ink[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
    }
  };
  flood(0, null);
  const holes: number[] = [], cells: number[][] = [];
  for (let i = 0; i < W * H; i++) {
    if (ink[i] || seen[i]) continue;
    const dots: number[] = [];
    flood(i, dots);
    holes.push(dots.length); cells.push(dots);
  }
  return { holes, cells, parts };
}
function countParts(ink: Uint8Array, seen: Uint8Array, W: number, H: number, stack: number[]): number {
  // ink pieces (8-connected)
  let parts = 0;
  for (let i = 0; i < W * H; i++) {
    if (!ink[i] || seen[i]) continue;
    parts++; seen[i] = 1; stack.push(i);
    while (stack.length) {
      const p = stack.pop()!, x = p % W, y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const Y = y + dy; if (Y < 0 || Y >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx; if (X < 0 || X >= W) continue;
          const q = Y * W + X; if (ink[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }
  }
  return parts;
}
/** Holes this small in the Normal reference are pinholes of the outline (a few dots where two
 *  strokes nearly meet), not real counters — a heavier weight may close them without hurting. */
export const pinhole = (px: number): number => Math.max(3, Math.round((px * px) / 400));
const holeSets = new WeakMap<Topology, Set<number>[]>();
function holeSet(t: Topology, r: number): Set<number> {
  let sets = holeSets.get(t);
  if (!sets) { sets = []; holeSets.set(t, sets); }
  return (sets[r] ??= new Set(t.cells[r]));
}
/** White dots a counter needs to stay open: 30 % of the Normal counter, but never more than a clearly
 *  visible hole at this size (a Black "8" at 11 mm has much smaller counters than Normal — still open). */
export const openNeed = (refArea: number, px: number): number => Math.max(2, Math.min(Math.floor(refArea * 0.3), Math.round((px * px) / 150)));
/** Is `heavy` still the same shape as the Normal, no-ink `ref` of the same letter? Every real counter
 *  of the reference needs its own open counter IN THE SAME PLACE (openNeed dots of it overlapping),
 *  and no two strokes may have run into each other. PURE. */
export function stillOpen(heavy: Topology, ref: Topology, px = 0): boolean {
  if (heavy.parts < ref.parts) return false; // strokes ran into each other
  const min = pinhole(px);
  const used = new Set<number>();
  for (let r = 0; r < ref.holes.length; r++) {
    if (ref.holes[r] < min) continue;
    const need = openNeed(ref.holes[r], px);
    const set = holeSet(ref, r);
    let ok = false;
    for (let h = 0; h < heavy.holes.length && !ok; h++) {
      if (used.has(h)) continue;
      let n = 0;
      for (const k of heavy.cells[h]) if (set.has(k) && ++n >= need) break;
      if (n >= need) { used.add(h); ok = true; }
    }
    if (!ok) return false;
  }
  return true;
}

/** The candidates from the seller's choice down to Normal without ink, lighter each step. PURE. */
export function lighterSteps(weight: SansWeight, ink: boolean): { weight: SansWeight; ink: boolean }[] {
  const ws: SansWeight[] = weight === 900 ? [900, 700, 400] : weight === 700 ? [700, 400] : [400];
  const out: { weight: SansWeight; ink: boolean }[] = [];
  for (const w of ws) { if (ink) out.push({ weight: w, ink: true }); out.push({ weight: w, ink: false }); }
  return out;
}
