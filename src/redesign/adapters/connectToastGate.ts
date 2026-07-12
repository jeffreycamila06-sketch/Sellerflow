// CONNECT-TRUTH Item A (audit condition) — ATTEMPT-GATED success toast.
// The "Connected!" toast used to fire on the POST's r.ok — the same
// POST-ok-as-truth lie the connect-truth branch removes. Hooking it to the
// ttConnected RISE alone would over-correct: the pill also rises on
// BACKGROUND recoveries (health-cycle reconnect success, join snapshot after
// a socket blip) — a "Connected!" toast popping up mid-live with zero user
// action is wrong. So the toast fires ONLY when a rise lands within a short
// window after an actual Connect tap:
//   • arm()   — called at the tap (BEFORE the POST: the server emits the
//               connected event before the HTTP response, so arming on r.ok
//               would often be too late);
//   • disarm() — called when the attempt fails (a later background rise must
//               not claim the stale intent);
//   • the rise consumes the arm (fires once), and an arm older than
//     windowMs is ignored (an abandoned attempt never toasts later).
// Pure client display logic — no connection/status machinery touched.
import { useCallback, useEffect, useRef } from "react";

export const CONNECT_TOAST_WINDOW_MS = 15 * 1000;

export function useConnectToastGate(connected: boolean, onFire: () => void, windowMs: number = CONNECT_TOAST_WINDOW_MS): { arm: () => void; disarm: () => void } {
  const armedAtRef = useRef(0);
  const onFireRef = useRef(onFire);
  // Effect mirror (not render-mirror — react-hooks/refs): declared BEFORE the
  // rise effect, so it commits the fresh handler first on every render.
  useEffect(() => { onFireRef.current = onFire; }, [onFire]);
  const arm = useCallback(() => { armedAtRef.current = Date.now(); }, []);
  const disarm = useCallback(() => { armedAtRef.current = 0; }, []);
  const prevRef = useRef(connected);
  useEffect(() => {
    const rose = connected && !prevRef.current;
    prevRef.current = connected;
    if (!rose) return;                                             // falls / re-asserts: not a rise
    if (!armedAtRef.current) return;                               // background rise (health cycle / snapshot) → silent
    if (Date.now() - armedAtRef.current > windowMs) { armedAtRef.current = 0; return; } // stale attempt → silent
    armedAtRef.current = 0;                                        // consume — fires once per tap
    onFireRef.current();
  }, [connected, windowMs]);
  return { arm, disarm };
}
