// Native QR scanner — which QR in the camera view is "the" sticker (Jeff, 2026-11-22).
//
// This is the ONE written rule. The phone apps run the same rule natively, every camera frame:
//   iPhone  → mobile/ios/App/App/SellerFlowScannerPlugin.swift  (enum QrCentrePick)
//   Android → mobile/android/app/src/main/java/com/sellerflow/live/QrCentrePick.java
// Both are checked against the SAME examples (src/lib/__tests__/fixtures/qrCentrePick.examples.json,
// turned into Swift / Java test cases by scripts/gen-qr-pick-cases.mjs; a CI test fails when the
// generated files are out of date or the constants differ).
//
// The rule:
//   1. Only a QR whose CENTRE is inside the square frame counts (edges count as inside).
//   2. The same text seen twice (two copies of one sticker) is ONE QR — its nearest copy counts.
//   3. One QR left → it wins. Two or more → the nearest to the frame's centre wins ONLY when it is
//      nearer than the next different QR by at least PICK_MARGIN × the frame's side. Otherwise it is
//      a "tie": nothing is read and the scanner shows "Point at one QR".
//   4. A winner is read only when the SAME winner comes out of PICK_FRAMES frames in a row. A frame
//      with no winner (no QR, or a tie) starts the count again.
// Coordinates are the scanner's on-screen points; only differences and the frame side matter.

export const PICK_MARGIN = 0.15;
export const PICK_FRAMES = 2;

export interface QrHit { text: string; cx: number; cy: number }
export interface QrFrame { cx: number; cy: number; side: number }
export type PickVerdict = { kind: "none" } | { kind: "one"; text: string } | { kind: "tie" };

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** One camera frame → none / one winner / tie. Pure. */
export function pickCentreQr(hits: readonly QrHit[], frame: QrFrame): PickVerdict {
  if (!frame || !finite(frame.cx) || !finite(frame.cy) || !finite(frame.side) || frame.side <= 0) return { kind: "none" };
  const half = frame.side / 2;
  const best = new Map<string, number>(); // text → nearest distance
  for (const h of hits || []) {
    if (!h || typeof h.text !== "string" || h.text === "" || !finite(h.cx) || !finite(h.cy)) continue;
    const dx = h.cx - frame.cx, dy = h.cy - frame.cy;
    if (Math.abs(dx) > half || Math.abs(dy) > half) continue; // centre outside the frame
    const d = Math.hypot(dx, dy);
    const prev = best.get(h.text);
    if (prev === undefined || d < prev) best.set(h.text, d);
  }
  if (best.size === 0) return { kind: "none" };
  const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]);
  if (ranked.length === 1) return { kind: "one", text: ranked[0][0] };
  const gap = ranked[1][1] - ranked[0][1];
  return gap >= PICK_MARGIN * frame.side ? { kind: "one", text: ranked[0][0] } : { kind: "tie" };
}

export interface PickStreak { text: string; count: number }
export interface PickStep { streak: PickStreak | null; read: string | null; tie: boolean }

/** The next frame's verdict → the new streak, the text to read (or null), and whether to show "Point at one QR". */
export function stepPick(prev: PickStreak | null, v: PickVerdict): PickStep {
  if (!v || v.kind === "none") return { streak: null, read: null, tie: false };
  if (v.kind === "tie") return { streak: null, read: null, tie: true };
  const count = prev && prev.text === v.text ? prev.count + 1 : 1;
  return { streak: { text: v.text, count }, read: count >= PICK_FRAMES ? v.text : null, tie: false };
}
