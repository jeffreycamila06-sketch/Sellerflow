// ONE STICKER — READABILITY GUARD (Jeff: every language prints clean and readable; the system adjusts,
// not the seller).
//
// For each printed line the engine asks: with the seller's weight (and, on the lighter heads, the
// 1-dot ink), does every letter keep its shape? A letter "closes" when, compared with the same
// letter in Normal without the extra ink at the SAME size:
//   • a counter fills in (fewer open holes — e, a, 口, 田 …), or
//   • two strokes run into each other (fewer separate pieces of ink — i, 二, 三, ห …).
// If anything closes, the line prints one step lighter — first without the 1-dot ink, then
// Extra → Bold → Normal (each with the ink first, then without) — until every letter is open.
// Never bigger or smaller: only lighter. The preview draws the same decision (one function), and the
// seller's saved setting stays as chosen.
import type { GlyphBits, SansWeight } from "./oneStickerFonts";

export interface Topology { holes: number[]; parts: number }
/** Open counters (white areas closed in by ink; their sizes) and separate pieces of ink. PURE. */
export function topology(g: GlyphBits): Topology {
  if (!g.w || !g.h) return { holes: [], parts: 0 };
  const W = g.w + 2, H = g.h + 2; // 1-dot white frame
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.buf[y * g.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) ink[(y + 1) * W + x + 1] = 1;
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  // ink pieces (8-connected)
  let parts = 0;
  for (let i = 0; i < W * H; i++) {
    if (!ink[i] || seen[i]) continue;
    parts++; seen[i] = 1; stack.push(i);
    while (stack.length) {
      const p = stack.pop()!, x = p % W, y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const q = Y * W + X; if (ink[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
  }
  // white areas (4-connected); the one touching the frame is the outside
  const holes: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (ink[i] || seen[i]) continue;
    let area = 0, outside = false;
    seen[i] = 1; stack.push(i);
    while (stack.length) {
      const p = stack.pop()!, x = p % W, y = (p - x) / W;
      area++;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) outside = true;
      for (const [X, Y] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const q = Y * W + X; if (!ink[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (!outside) holes.push(area);
  }
  return { holes, parts };
}
/** Is `heavy` still the same shape as the Normal, no-ink `ref` of the same letter? PURE. */
export function stillOpen(heavy: Topology, ref: Topology): boolean {
  if (heavy.parts < ref.parts) return false; // strokes ran into each other
  if (!ref.holes.length) return true;
  // every counter of the reference needs an open counter: at least 2 dots and ≥ 30 % of the smallest one
  const minRef = Math.min(...ref.holes);
  const need = Math.max(2, Math.floor(minRef * 0.3));
  return heavy.holes.filter((a) => a >= need).length >= ref.holes.length;
}

/** The candidates from the seller's choice down to Normal without ink, lighter each step. PURE. */
export function lighterSteps(weight: SansWeight, ink: boolean): { weight: SansWeight; ink: boolean }[] {
  const ws: SansWeight[] = weight === 900 ? [900, 700, 400] : weight === 700 ? [700, 400] : [400];
  const out: { weight: SansWeight; ink: boolean }[] = [];
  for (const w of ws) { if (ink) out.push({ weight: w, ink: true }); out.push({ weight: w, ink: false }); }
  return out;
}
