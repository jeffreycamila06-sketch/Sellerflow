// Real printer connection status for the Settings printer picker (was hardcoded
// sample: LAN always "Ready", BT always "Off"). Read-on-OPEN only (no poll); the
// LAN check is a real reachability ping over the LOCAL network (zero Supabase
// egress). Web/preview has no native bridge → everything is "disconnected" (honest,
// never a fake "connected"). NATIVE-ONLY truth: only the real APK resolves status.
//
// Uses ONLY existing bridge actions (getBluetoothLabelPrinter / getPrinter /
// testConnection) — the same ones PrinterSettings already calls. No native change.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  btCall, callMobilePrinterBridge, hasBtBridge, hasNativePrinter,
  type BluetoothScanResult,
} from "./printerBridge";

export type PrinterConnState = "checking" | "connected" | "disconnected";

// PURE — BT is "connected" when the BT bridge exists AND a printer is saved/bonded
// (BT Classic/SPP connects at print time, so saved+bonded is the right proxy).
export function btStatusFrom(hasBridge: boolean, savedPrinter: unknown): PrinterConnState {
  return hasBridge && !!savedPrinter ? "connected" : "disconnected";
}

// PURE — LAN is "connected" only when the native bridge exists, a host is saved,
// AND the reachability ping (testConnection) returned ok.
export function lanStatusFrom(hasBridge: boolean, host: string, pingOk: boolean): PrinterConnState {
  return hasBridge && !!host && pingOk ? "connected" : "disconnected";
}

// Batch B #6 — the picker also shows the REAL saved-device detail (BT device
// name / LAN host:port) instead of the old fictional hardware labels
// ("192.168.1.42", "Xprinter XP-365B"). "" = nothing saved → the screen shows
// an honest generic label. The detail comes from the SAME bridge calls the
// status check already makes — zero extra native calls.
export interface PrinterStatuses { lan: PrinterConnState; bt: PrinterConnState; lanDetail: string; btDetail: string; refresh: () => void }

// `enabled` = the picker is open. BT and LAN are checked in parallel so the slow
// LAN ping never blocks the fast BT query.
export function usePrinterStatus(enabled: boolean): PrinterStatuses {
  const [lan, setLan] = useState<PrinterConnState>("disconnected");
  const [bt, setBt] = useState<PrinterConnState>("disconnected");
  const [lanDetail, setLanDetail] = useState("");
  const [btDetail, setBtDetail] = useState("");
  const btBusy = useRef(false);
  const lanBusy = useRef(false);

  const checkBt = useCallback(async () => {
    if (btBusy.current) return;
    if (!hasBtBridge()) { setBt("disconnected"); setBtDetail(""); return; }
    btBusy.current = true;
    setBt("checking");
    try {
      const r = await btCall<BluetoothScanResult>("getBluetoothLabelPrinter");
      setBt(btStatusFrom(true, r?.savedPrinter));
      const saved = r?.savedPrinter as { name?: string; address?: string } | undefined;
      setBtDetail(saved ? saved.name || saved.address || "" : "");
    } catch { setBt("disconnected"); setBtDetail(""); }
    finally { btBusy.current = false; }
  }, []);

  const checkLan = useCallback(async () => {
    if (lanBusy.current) return;
    if (!hasNativePrinter()) { setLan("disconnected"); setLanDetail(""); return; }
    lanBusy.current = true;
    setLan("checking");
    try {
      const g = await callMobilePrinterBridge("getPrinter");
      const host = g.host || g.savedPrinter?.host || "";
      if (!host) { setLan(lanStatusFrom(true, "", false)); setLanDetail(""); return; }
      const port = g.port || g.savedPrinter?.port || 9100;
      setLanDetail(`${host}:${port}`);
      const ping = await callMobilePrinterBridge("testConnection", { host, port });
      setLan(lanStatusFrom(true, host, !!ping.ok));
    } catch { setLan("disconnected"); setLanDetail(""); }
    finally { lanBusy.current = false; }
  }, []);

  const refresh = useCallback(() => { void checkBt(); void checkLan(); }, [checkBt, checkLan]);

  // Read-on-open: run once each time the picker opens. No poll.
  useEffect(() => { if (enabled) refresh(); }, [enabled, refresh]);

  return { lan, bt, lanDetail, btDetail, refresh };
}
