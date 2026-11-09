// The new Live print pattern screen's fit work (notes + "+" limits), run WITHOUT freezing the phone
// (Jeff 2026-11-09, item 6): the layouts are step generators (oneSticker.ts — one step = one layout pass,
// ≈ 1–5 ms on a laptop); they run in idle time in small slices (≤ SLICE_MS each, then the phone gets the
// screen back), and a finished answer is kept per settings so going back to a setting is instant.
import { screenFitNotesSteps, screenStepCapsSteps, type FitNote, type OneStickerInput, type OneStickerSettings, type PartKey, type RenderOpts, type Steps } from "./oneSticker";
import type { Fonts } from "./oneStickerText";

export const SLICE_MS = 8;
export type StepCaps = Partial<Record<PartKey, number>>;
export interface ScreenFit { notes: FitNote[]; caps: StepCaps }
export interface RunStats { slices: number; longestSliceMs: number; totalMs: number }

type Sched = (cb: () => void) => () => void;
const idle: Sched = (cb) => {
  const w = globalThis as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (typeof w.requestIdleCallback === "function") { const h = w.requestIdleCallback(cb, { timeout: 100 }); return () => w.cancelIdleCallback?.(h); }
  const h = setTimeout(cb, 0);
  return () => clearTimeout(h);
};
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Run a step generator in idle slices; `done` gets the value and the timing. Returns a cancel. */
export function runInSlices<T>(g: Steps<T>, done: (v: T, stats: RunStats) => void, schedule: Sched = idle, sliceMs = SLICE_MS): () => void {
  let cancelled = false, cancelNext: (() => void) | null = null;
  const stats: RunStats = { slices: 0, longestSliceMs: 0, totalMs: 0 };
  const slice = () => {
    if (cancelled) return;
    const t0 = now();
    for (;;) {
      const r = g.next(); // at least one step per slice
      if (r.done) { const ms = now() - t0; stats.slices++; stats.totalMs += ms; stats.longestSliceMs = Math.max(stats.longestSliceMs, ms); done(r.value, stats); return; }
      if (now() - t0 >= sliceMs) break;
    }
    const ms = now() - t0; stats.slices++; stats.totalMs += ms; stats.longestSliceMs = Math.max(stats.longestSliceMs, ms);
    cancelNext = schedule(slice);
  };
  cancelNext = schedule(slice);
  return () => { cancelled = true; cancelNext?.(); };
}

// the last answers, newest last (a handful of settings — undoing a tap is instant)
const CACHE_MAX = 40;
const cache = new Map<string, ScreenFit>();
export function cachedFit(key: string): ScreenFit | undefined { return cache.get(key); }
export function rememberFit(key: string, v: ScreenFit): void {
  cache.delete(key); cache.set(key, v);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}
export function __clearScreenFitCache(): void { cache.clear(); }

/** Notes first (shown as soon as they are ready), then the "+" limits — both in idle slices. */
export function startScreenFit(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts,
  onNotes: (n: FitNote[]) => void, onDone: (fit: ScreenFit, stats: { notes: RunStats; caps: RunStats }) => void, schedule: Sched = idle): () => void {
  let cancelCaps: (() => void) | null = null;
  const cancelNotes = runInSlices(screenFitNotesSteps(s, inp, fonts, opts), (notes, ns) => {
    onNotes(notes);
    cancelCaps = runInSlices(screenStepCapsSteps(s, inp, fonts, opts), (caps, cs) => onDone({ notes, caps }, { notes: ns, caps: cs }), schedule);
  }, schedule);
  return () => { cancelNotes(); cancelCaps?.(); };
}
