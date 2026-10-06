// PARCEL CHECK — attention alert (2026-09-27). A store/phone verdict lands
// asynchronously (~seconds after encode, via the extension), often after the
// seller has moved to the next parcel. So a NEW 'restricted'/'full' verdict
// fires an audible chime + raises a sticky "N need attention" banner that
// persists until acknowledged — impossible to miss. PURE helpers here; the
// audio is a tiny WebAudio tone (no asset), guarded for tests/SSR.

export interface VerdictLite { id: string; storeFullStatus?: string | null; phoneCheckStatus?: string | null }

// A store that can't take the parcel now: 'full', or (1.16 frozen check) 'frozen_unavailable' —
// counted the same way everywhere 'full' is (chime, banner, the Full tab).
export const storeUnavailable = (s: string | null | undefined): boolean => s === "full" || s === "frozen_unavailable";

// Rows that TRANSITIONED into a problem verdict between prev and fresh (by id):
// restricted is the more urgent (buyer can't pick up at all); full = store
// full. A row already flagged in prev does NOT re-fire (only genuine
// transitions), so re-polls don't re-chime.
export function newlyFlagged(prev: VerdictLite[], fresh: VerdictLite[]): { restricted: number; full: number } {
  const was = new Map(prev.map((r) => [r.id, r]));
  let restricted = 0, full = 0;
  for (const f of fresh) {
    const p = was.get(f.id);
    if (f.phoneCheckStatus === "restricted" && p?.phoneCheckStatus !== "restricted") restricted++;
    else if (storeUnavailable(f.storeFullStatus) && !storeUnavailable(p?.storeFullStatus)) full++;
  }
  return { restricted, full };
}

// How many loaded rows currently need attention (explicit problem verdicts only
// — null/'unknown' never count). Drives the banner's count.
export function attentionCount(rows: VerdictLite[]): number {
  return rows.filter((r) => r.phoneCheckStatus === "restricted" || storeUnavailable(r.storeFullStatus)).length;
}

// ── audio ── a single lazily-created context, resumed on a user gesture
// (mobile autoplay policy → unlock on the encode/Save tap).
let ctx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  try {
    const AC = (typeof window !== "undefined" && (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) || null;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    return ctx;
  } catch { return null; }
}
export function unlockAudio(): void {
  const c = audioCtx();
  if (c && c.state === "suspended") { try { void c.resume(); } catch { /* ignore */ } }
}
function beep(c: AudioContext, freq: number, startMs: number, durMs: number): void {
  const osc = c.createOscillator(); const gain = c.createGain();
  osc.type = "sine"; osc.frequency.value = freq;
  const t = c.currentTime + startMs / 1000;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
  osc.connect(gain); gain.connect(c.destination);
  osc.start(t); osc.stop(t + durMs / 1000 + 0.02);
}
// restricted = two urgent high beeps; full = one softer low beep.
export function playChime(kind: "restricted" | "full"): void {
  const c = audioCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") void c.resume();
    if (kind === "restricted") { beep(c, 880, 0, 130); beep(c, 880, 210, 130); }
    else { beep(c, 440, 0, 220); }
  } catch { /* audio best-effort — never throws into the caller */ }
}
