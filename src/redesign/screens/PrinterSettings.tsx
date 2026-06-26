// Screen 18 — Printer settings. REAL native connection wired to the SAME
// window.SellerFlowPrinter bridge production uses (printerBridge.ts, copied verbatim):
// WiFi find/test/connect/test-print + Bluetooth scan/select/clear/test. psOut/psSize
// persist + feed the payload (unchanged). Back → General Settings.
//
// ⚠️ NATIVE-ONLY / PREVIEW-UNVERIFIABLE: on web/preview there is no bridge, so every
// action returns the friendly "open the app" status (safe no-op). Only verifiable in
// a real APK.
import { useEffect, useState, type CSSProperties } from "react";
import {
  callMobilePrinterBridge, btCall, hasNativePrinter, hasBtBridge, buildTestStickerPayload,
  type MobilePrinterResult, type BluetoothScanResult, type BluetoothPrinterDevice, type StickerPrintResult,
} from "../adapters/printerBridge";
import type { Settings } from "../adapters/printing";

const PS_SIZES = ["100x60mm (Standard)", "80x60mm", "80x50mm", "70x50mm", "60x40mm"];
const label: CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const input: CSSProperties = { width: "100%", padding: "11px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, outline: "none" };
const groupLabel: CSSProperties = { fontSize: 11, letterSpacing: ".12em", fontWeight: 800, color: "var(--text-muted)", margin: "14px 2px 8px" };
const gridBtn: CSSProperties = { padding: "12px 0", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const tab = (active: boolean): CSSProperties => ({ flex: 1, padding: "13px 0", borderRadius: 11, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, textAlign: "center", border: "none", ...(active ? { background: "var(--surface)", color: "var(--accent-fg)", boxShadow: "var(--shadow)" } : { background: "transparent", color: "var(--text-dim)" }) });

export default function PrinterSettings({
  onBack, psType, psOut, onSetPsOut, psSize, psSizeOpen, onTogglePsSize, onPickPsSize,
  cur = "NT$", storeName = "SellerFlowLive", settings,
}: {
  onBack: () => void;
  psType: "wifi" | "bt";
  psOut: "receipt" | "sticker"; onSetPsOut: (o: "receipt" | "sticker") => void;
  psSize: string; psSizeOpen: boolean; onTogglePsSize: () => void; onPickPsSize: (s: string) => void;
  cur?: string; storeName?: string; settings?: Settings;
}) {
  const wifi = psType === "wifi";
  const nativeReady = hasNativePrinter();
  const btReady = hasBtBridge();
  const [status, setStatus] = useState<MobilePrinterResult>({ ok: false, message: nativeReady ? "Tap Find to check the saved printer." : "Open the SellerFlow app on your phone to connect a printer." });
  const [host, setHost] = useState("");
  const [port, setPort] = useState("9100");
  const [btScanning, setBtScanning] = useState(false);
  const [btPrinters, setBtPrinters] = useState<BluetoothPrinterDevice[]>([]);
  const [btSaved, setBtSaved] = useState<BluetoothPrinterDevice | null>(null);
  const [btMsg, setBtMsg] = useState("");

  // On mount: hydrate the saved LAN printer + BT printer from the native bridge
  // (App.tsx refreshMobilePrinterStatus + getBluetoothLabelPrinter). No-op on web.
  useEffect(() => { if (nativeReady) void refreshStatus(); /* eslint-disable-next-line */ }, [nativeReady]);
  useEffect(() => { if (btReady) void btCall<BluetoothScanResult>("getBluetoothLabelPrinter").then((r) => { if (r?.savedPrinter) setBtSaved(r.savedPrinter); }); /* eslint-disable-next-line */ }, [btReady]);

  async function refreshStatus() {
    const r = await callMobilePrinterBridge("getPrinter"); setStatus(r);
    if (r.host || r.savedPrinter?.host) setHost(r.host || r.savedPrinter?.host || "");
    if (r.port || r.savedPrinter?.port) setPort(String(r.port || r.savedPrinter?.port || 9100));
  }
  const clampPort = () => Math.max(1, Math.min(65535, Number(port) || 9100));
  async function saveLan() { const r = await callMobilePrinterBridge("setPrinter", { host: host.trim(), port: clampPort() }); setStatus(r); }
  async function testConn() { const r = await callMobilePrinterBridge("testConnection", { host: host.trim(), port: clampPort() }); setStatus(r); if (r.ok) await saveLan(); }
  async function testPrint() { setStatus(await callMobilePrinterBridge("testPrint")); }

  async function scanBt() {
    if (!btReady) { setBtMsg("Open the SellerFlow app on your phone to scan Bluetooth printers."); return; }
    setBtScanning(true); setBtMsg("");
    const r = await btCall<BluetoothScanResult>("scanBluetoothLabelPrinters");
    setBtScanning(false);
    if (r) { setBtPrinters(r.printers || []); if (r.savedPrinter) setBtSaved(r.savedPrinter); setBtMsg(r.message || ""); }
    else setBtMsg("Bluetooth scan unavailable.");
  }
  async function selectBt(p: BluetoothPrinterDevice) {
    const r = await btCall<BluetoothScanResult>("setBluetoothLabelPrinter", { address: p.address, name: p.name });
    setBtSaved(r?.savedPrinter || p); setBtMsg(r?.message || "Bluetooth printer saved.");
  }
  async function clearBt() { await btCall<BluetoothScanResult>("clearBluetoothLabelPrinter"); setBtSaved(null); setBtMsg("Bluetooth printer cleared."); }
  async function testBt() {
    if (!btReady) { setBtMsg("Open the SellerFlow app on your phone to test-print."); return; }
    if (!settings) return;
    setBtMsg("Sending test sticker…");
    const r = await btCall<StickerPrintResult>("printStickerNative", buildTestStickerPayload(cur, storeName, settings));
    setBtMsg(r?.ok ? (r.message || "Test sticker sent.") : (r?.message || "Test sticker failed — check pairing."));
  }

  const dot = status.ok ? "var(--ok)" : nativeReady ? "var(--warn)" : "var(--text-muted)";

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>‹ Back</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>Printer settings</div>
      </div>

      <div style={{ padding: "16px 14px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 14, boxShadow: "var(--shadow)" }}>
          <span style={{ width: 13, height: 13, borderRadius: "50%", background: dot, flexShrink: 0, boxShadow: `0 0 7px ${dot}` }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{wifi ? "WiFi printer" : "Bluetooth sticker printer"}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{status.message || (wifi ? "Not connected" : "AIMO D520BT (TSPL, 100×60mm)")}</div>
          </div>
        </div>
        {!nativeReady && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>Printer connection runs in the SellerFlow app — these controls work on your phone, not in the web preview.</div>}

        {wifi ? (
          <div>
            <div style={groupLabel}>OUTPUT FORMAT</div>
            <div style={{ display: "flex", gap: 8, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 13, padding: 5, marginBottom: 12 }}>
              <button onClick={() => onSetPsOut("receipt")} style={tab(psOut === "receipt")}>Receipt</button>
              <button onClick={() => onSetPsOut("sticker")} style={tab(psOut === "sticker")}>Sticker</button>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 13, boxShadow: "var(--shadow)" }}>
              <label style={label}>Printer IP address</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.18.234" inputMode="decimal" style={{ ...input, marginBottom: 11 }} />
              <label style={label}>Port</label>
              <input value={port} onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ""))} placeholder="9100" inputMode="numeric" style={input} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 12 }}>
              <button onClick={() => void refreshStatus()} style={gridBtn}>Find</button>
              <button onClick={() => void testConn()} style={gridBtn}>Test Connection</button>
              <button onClick={() => void saveLan()} style={{ ...gridBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)", boxShadow: "0 4px 14px var(--accent-soft)" }}>Connect</button>
              <button onClick={() => void testPrint()} style={gridBtn}>Test Print</button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", marginTop: 16 }}>
              <label style={label}>Sticker size</label>
              <button onClick={onTogglePsSize} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{psSize}</span>
                <span style={{ color: "var(--text-muted)", transition: "transform .2s", transform: psSizeOpen ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>▾</span>
              </button>
              {psSizeOpen && (
                <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 11, overflow: "hidden" }}>
                  {PS_SIZES.map((z) => {
                    const on = z === psSize;
                    return (
                      <button key={z} onClick={() => onPickPsSize(z)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", border: "none", borderBottom: "1px solid var(--border)", background: on ? "var(--accent-softer)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
                        <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${on ? "var(--accent)" : "var(--border-strong)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: on ? "var(--accent)" : "transparent" }} /></span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{z}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {btSaved && (
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{btSaved.name}</div><div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{btSaved.address}</div></div>
                  <button onClick={() => void clearBt()} style={{ ...gridBtn, padding: "7px 12px" }}>Clear</button>
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: btSaved ? "1fr 1fr" : "1fr", gap: 9, marginTop: 12 }}>
              <button onClick={() => void scanBt()} disabled={btScanning} style={{ ...gridBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)", boxShadow: "0 4px 14px var(--accent-soft)", opacity: btScanning ? 0.6 : 1 }}>🔍 {btScanning ? "Scanning…" : "Scan"}</button>
              {btSaved && <button onClick={() => void testBt()} style={gridBtn}>Test Print</button>}
            </div>
            {btPrinters.length > 0 && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, marginTop: 12, overflow: "hidden" }}>
                {btPrinters.map((p) => (
                  <button key={p.id || p.address} onClick={() => void selectBt(p)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
                    <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{p.name || "Bluetooth printer"}</span><span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{p.address}</span></span>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: p.paired ? "var(--ok)" : "var(--accent-fg)" }}>{p.paired ? "Paired" : "Nearby"}</span>
                  </button>
                ))}
              </div>
            )}
            {btMsg && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 10 }}>{btMsg}</div>}
          </div>
        )}

        <button onClick={onBack} style={{ width: "100%", marginTop: 16, padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 16px var(--accent-soft)" }}>Done</button>
      </div>
    </div>
  );
}
