// BLUETOOTH-OFF print failures (2026-10-01). The native shells already reject a
// print made with the phone's Bluetooth OFF — iOS `BT_OFF`, Android BLE `BT_OFF`,
// Android Classic `BT_PRINT_FAILED` "Bluetooth print failed: Bluetooth is off",
// scan `BT_DISABLED` — but that reached only console.warn (invisible). This turns
// it into ONE simple modal per burst. JS-only: no native/print-routing change.
import { useCallback, useRef, useState } from "react";

const BT_OFF_CODES = new Set(["BT_OFF", "BT_DISABLED"]);
// PURE — code-first, message fallback (Android Classic rejects with the generic
// BT_PRINT_FAILED code but says "Bluetooth is off" / "Bluetooth is turned off").
export function isBluetoothOff(code: string, message: string): boolean {
  if (code && BT_OFF_CODES.has(code)) return true;
  return /bluetooth\s+is\s+(?:turned\s+)?off/i.test(message || "");
}

// Failures closer together than this are ONE burst (several queued stickers
// failing in a row) → one modal, even if the seller taps OK mid-burst.
export const BT_OFF_BURST_MS = 15_000;
// PURE — open a new modal only when none is showing AND the previous BT-off
// failure is outside the burst window.
export function shouldOpenBtOff(open: boolean, lastFailAt: number | null, now: number): boolean {
  return !open && (lastFailAt === null || now - lastFailAt > BT_OFF_BURST_MS);
}

// `report` is STABLE (refs only) so it can sit inside the once-registered native
// failure handler. Returns true when it consumed a Bluetooth-off failure.
export function useBtOffModal(now: () => number = Date.now) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const lastFailAt = useRef<number | null>(null);
  const nowRef = useRef(now);
  const report = useCallback((code: string, message: string): boolean => {
    if (!isBluetoothOff(code, message)) return false;
    const t = nowRef.current();
    if (shouldOpenBtOff(openRef.current, lastFailAt.current, t)) { openRef.current = true; setOpen(true); }
    lastFailAt.current = t;
    return true;
  }, []);
  const close = useCallback(() => { openRef.current = false; setOpen(false); }, []);
  return { open, report, close };
}
