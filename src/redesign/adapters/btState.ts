// Bluetooth READINESS for the Printer settings → Bluetooth screen (printer setup polish).
// The phone is checked the moment the screen opens — BEFORE any Scan tap — so the OS
// "Allow Bluetooth" prompt appears right then and an OFF / NOT ALLOWED phone gets a card
// that says what to do. There is no native "Bluetooth state" method in the shipped apps,
// so the probe is the existing scan call: it answers at once when Bluetooth is off or not
// allowed (Android rejects BT_DISABLED / BT_PERMISSION before scanning and asks for the
// permission; iOS resolves {ok:false, message}) and only runs a real scan when ready.
//
// While the phone is OFF or NOT READY we re-check every BT_RECHECK_MS and when the app comes
// back to the foreground; an unclear answer is retried once after BT_RETRY_MS before it is
// shown as "not ready". NOT ALLOWED is re-checked ONLY on foreground return — on Android every
// probe re-asks the system permission, so a timer would pop the dialog every 3 s after
// "Don't allow". Once ready there is no polling (a ready probe = a full scan; a later
// scan/print failure reports its code back through `report` and the cards return).
import { useCallback, useEffect, useRef, useState } from "react";
import { isBluetoothOff } from "./btOff";

export type BtState = "checking" | "off" | "notAllowed" | "notReady" | "ready";
export interface BtProbeOutcome { ok: boolean; code: string; message: string }

export const BT_RECHECK_MS = 3000;
export const BT_RETRY_MS = 2000;

// PURE — what one bridge answer says about the phone's Bluetooth. Code first, message
// second (iOS resolves with a message only). BT_BUSY = another printer task is running,
// which can only happen on a working Bluetooth → ready.
export function btProbeState(o: BtProbeOutcome): "ready" | "off" | "notAllowed" | "unknown" {
  if (o.ok) return "ready";
  if (isBluetoothOff(o.code, o.message)) return "off";
  if (o.code === "BT_PERMISSION" || /permission|not allowed|unauthori[sz]ed/i.test(o.message || "")) return "notAllowed";
  if (o.code === "BT_BUSY" || /busy/i.test(o.message || "")) return "ready";
  return "unknown";
}

export const btBlocked = (s: BtState): boolean => s === "off" || s === "notAllowed" || s === "notReady";

export interface BluetoothState {
  state: BtState;
  recovered: boolean; // ready AFTER having been off / not allowed / not ready — shows the green note
  report: (code: string, message: string) => boolean; // a scan/print failure → off / not allowed card; true when consumed
  clearRecovered: () => void;
}

export function useBluetoothState(enabled: boolean, probe: () => Promise<BtProbeOutcome>): BluetoothState {
  const [state, setState] = useState<BtState>("checking");
  const [recovered, setRecovered] = useState(false);
  const stateRef = useRef<BtState>("checking");
  const enabledRef = useRef(false);
  const inFlight = useRef(false);
  const retried = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probeRef = useRef(probe);
  useEffect(() => { probeRef.current = probe; }, [probe]);

  const apply = useCallback((s: BtState) => { stateRef.current = s; setState(s); }, []);
  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  // Timers call the latest `run` through a ref (a self-reference inside the callback is not allowed).
  const runRef = useRef<() => Promise<void>>(async () => {});
  const schedule = useCallback((ms: number) => { clearTimer(); timer.current = setTimeout(() => { void runRef.current(); }, ms); }, []);

  const run = useCallback(async () => {
    if (inFlight.current || !enabledRef.current) return;
    clearTimer();
    inFlight.current = true;
    let o: BtProbeOutcome;
    try { o = await probeRef.current(); } catch { o = { ok: false, code: "", message: "" }; }
    inFlight.current = false;
    if (!enabledRef.current) return;
    const r = btProbeState(o);
    if (r === "ready") { if (btBlocked(stateRef.current)) setRecovered(true); retried.current = false; apply("ready"); return; }
    if (r === "unknown" && !retried.current) { retried.current = true; schedule(BT_RETRY_MS); return; } // silent retry, state unchanged
    apply(r === "unknown" ? "notReady" : r);
    if (r !== "notAllowed") schedule(BT_RECHECK_MS); // not allowed: foreground return only (no permission popup loop)
  }, [apply, schedule]);
  useEffect(() => { runRef.current = run; }, [run]);

  /* eslint-disable react-hooks/set-state-in-effect -- the check on open: state resets, then the probe sets it after the await (the repo's convention) */
  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) { clearTimer(); return; }
    retried.current = false;
    setRecovered(false);
    apply("checking");
    void run();
    const onVisible = () => { if (document.visibilityState === "visible" && stateRef.current !== "ready") void run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { enabledRef.current = false; clearTimer(); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, apply, run]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const report = useCallback((code: string, message: string): boolean => {
    const r = btProbeState({ ok: false, code, message });
    if (r !== "off" && r !== "notAllowed") return false;
    setRecovered(false);
    apply(r);
    if (enabledRef.current && r !== "notAllowed") schedule(BT_RECHECK_MS);
    return true;
  }, [apply, schedule]);

  const clearRecovered = useCallback(() => setRecovered(false), []);
  return { state, recovered, report, clearRecovered };
}
