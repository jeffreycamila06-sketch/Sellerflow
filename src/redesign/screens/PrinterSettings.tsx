// Screen 18 — Printer settings. REAL native connection wired to the SAME
// window.SellerFlowPrinter bridge production uses (printerBridge.ts, copied verbatim):
// WiFi find/test/connect/test-print + Bluetooth scan/select/clear/test. psOut/psSize
// persist + feed the payload (unchanged). Back → General Settings.
//
// ⚠️ NATIVE-ONLY / PREVIEW-UNVERIFIABLE: on web/preview there is no bridge, so every
// action returns the friendly "open the app" status (safe no-op). Only verifiable in
// a real APK.
//
// PRINTER SETUP v2 (flowV2 + an app build new enough to store a generic printer — the
// approved flow, Oct 30): the phone's Bluetooth is checked the moment the Bluetooth screen
// opens (btState) — OFF → red card, NOT ALLOWED → amber card, not ready → red card, Scan
// greyed; ready → Scan active (+ a green note after a fix). Scan lists ONLY the tested
// printers (printerModels.WHITELIST: AIMO D520BT, Flash Y41BT, Niimbot B-series) with a brand
// pill; "Printer not listed? Contact Admin" under it (admin keeps "Show all" for testing).
// Tap a printer → saved at once + one test sticker → green "Printer saved" card with Test
// print. No "Did it look like this?" question, no language tries. Everyone else keeps
// today's screen.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  callMobilePrinterBridge, btCall, btScanOutcome, hasNativePrinter, hasBtBridge, buildTestBuyerV2, savedTestBuyer,
  hasGenericPrinterBridge, hasNiimbotBridge, niimbotOsTooOld,
  type MobilePrinterResult, type BluetoothScanResult, type BluetoothPrinterDevice,
} from "../adapters/printerBridge";
import { printStickerBtRouted, isPrinterNotSetup, isClassicTextSticker, setClassicTextSticker, isStickerQrOn, setStickerQrOn, type Settings } from "../adapters/printing";
import { knownPrinterInfo, knownPrinterLang } from "../adapters/printerModels";
import { useBluetoothState, btBlocked, type BtProbeOutcome } from "../adapters/btState";
import { TELEGRAM_URL } from "../../lib/telegram";
import { useT, tpl } from "../i18n";
import { isAppShell } from "../adapters/appShell";

const PS_SIZES = ["100x60mm (Standard)", "80x60mm", "80x50mm", "70x50mm", "60x40mm"];
const label: CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const input: CSSProperties = { width: "100%", padding: "11px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, outline: "none" };
const groupLabel: CSSProperties = { fontSize: 11, letterSpacing: ".12em", fontWeight: 800, color: "var(--text-muted)", margin: "14px 2px 8px" };
const gridBtn: CSSProperties = { padding: "12px 0", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const tab = (active: boolean): CSSProperties => ({ flex: 1, padding: "13px 0", borderRadius: 11, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, textAlign: "center", border: "none", ...(active ? { background: "var(--surface)", color: "var(--accent-fg)", boxShadow: "var(--shadow)" } : { background: "transparent", color: "var(--text-dim)" }) });
const rowBtn: CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" };
const brandPill: CSSProperties = { flexShrink: 0, whiteSpace: "nowrap", fontSize: 10.5, fontWeight: 800, padding: "4px 8px", borderRadius: 999, border: "1px solid var(--accent)", color: "var(--accent-fg)", background: "var(--surface-2)" };
const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", marginTop: 12 };

// Bluetooth / saved-printer cards — one shape, three tones. Red = the phone's Bluetooth is
// off or not ready, amber = Bluetooth not allowed for the app, green = printer saved.
type Tone = "red" | "amber" | "green";
const TONES: Record<Tone, { bg: string; border: string; fg: string }> = {
  red: { bg: "var(--danger-soft)", border: "var(--danger)", fg: "var(--danger)" },
  amber: { bg: "var(--warn-soft)", border: "var(--warn)", fg: "var(--warn)" },
  green: { bg: "var(--ok-soft, rgba(5,150,105,.1))", border: "var(--ok)", fg: "var(--ok)" },
};
function BtCard({ tone, title, line, steps, small, testid, children }: { tone: Tone; title: string; line?: string; steps?: string[]; small?: string; testid: string; children?: ReactNode }) {
  const c = TONES[tone];
  return (
    <div role={tone === "green" ? "status" : "alert"} data-testid={testid} style={{ ...card, background: c.bg, border: `1px solid ${c.border}`, boxShadow: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: c.fg, flexShrink: 0 }} />
        <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--text)", lineHeight: 1.3 }}>{title}</div>
      </div>
      {line && <div style={{ fontSize: 13, color: "var(--text)", marginTop: 8, lineHeight: 1.45 }}>{line}</div>}
      {steps && steps.length > 0 && (
        <ul style={{ margin: "6px 0 0", padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 4 }}>
          {steps.map((s) => <li key={s} style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.45 }}>{s}</li>)}
        </ul>
      )}
      {small && <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.45 }}>{small}</div>}
      {children}
    </div>
  );
}

type Stage = "idle" | "printing" | "saved" | "fail";

export default function PrinterSettings({
  onBack, psType, psOut, onSetPsOut, psSize, psSizeOpen, onTogglePsSize, onPickPsSize,
  cur = "NT$", storeName = "SellerFlowLive", settings, showClassicToggle = false, stickerQrAllowed = false,
  stickerQrMoved = false, testComment, flowV2 = false, isAdmin = false,
}: {
  onBack: () => void;
  psType: "wifi" | "bt";
  psOut: "receipt" | "sticker"; onSetPsOut: (o: "receipt" | "sticker") => void;
  psSize: string; psSizeOpen: boolean; onTogglePsSize: () => void; onPickPsSize: (s: string) => void;
  cur?: string; storeName?: string; settings?: Settings;
  showClassicToggle?: boolean; // admin/test-account only (canUseClassicText) — default HIDDEN
  stickerQrAllowed?: boolean; // all plans; hidden only off-market (canUseStickerQr) — default HIDDEN
  stickerQrMoved?: boolean; // admins (LIVE layout v2 gate): the toggle lives in LIVE print pattern instead
  testComment?: string; // LIVE layout v2 users: the test sticker's comment ("COMMENT / PRICE"); others keep buildTestBuyer's "PRICE"
  flowV2?: boolean; // printer setup v2 (printerFlowV2Enabled): admin / test_printers / the printer_flow_v2 switch
  isAdmin?: boolean; // admin-only: the "Show all Bluetooth devices" link (unknown printers, for testing)
}) {
  const t = useT();
  const wifi = psType === "wifi";
  // the saved printer's test sticker (D520BT = the old one; generic / Niimbot = the Chinese v2); the admin sample comment rides either
  const testBuyer = () => { const b = savedTestBuyer(); return testComment ? { ...b, orders: [{ ...b.orders[0], item: testComment }] } : b; };
  const nativeReady = hasNativePrinter();
  // PHONE APP only: sticker QR is excluded on 60×40 (too small to scan fast). On WEB
  // (no native bridge) the browser-print QR follows the seller's own paper/driver
  // settings, so there is no size gate and no 60×40 note there.
  const qrUnsupportedSize = nativeReady && /^60x40/.test(psSize);
  const btReady = hasBtBridge();
  const [status, setStatus] = useState<MobilePrinterResult>({ ok: false, message: nativeReady ? t.rd_ps_tap_find : t.rd_ps_open_app_connect });
  const [host, setHost] = useState("");
  const [port, setPort] = useState("9100");
  const [btScanning, setBtScanning] = useState(false);
  const [btPrinters, setBtPrinters] = useState<BluetoothPrinterDevice[]>([]);
  const [btSaved, setBtSaved] = useState<BluetoothPrinterDevice | null>(null);
  const [btMsg, setBtMsg] = useState("");
  // Printer setup v2: gated accounts on an app build new enough to store a generic printer.
  // Older apps (and the web, which has no bridge) keep today's screen exactly.
  const v2 = flowV2 && hasGenericPrinterBridge();
  const [btScanned, setBtScanned] = useState(false);
  const [btShowAll, setBtShowAll] = useState(false);
  const [pick, setPick] = useState<BluetoothPrinterDevice | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [testPrinted, setTestPrinted] = useState(false); // the saved card is green only when the test sticker really printed
  const [failText, setFailText] = useState(""); // a printer we can't drive yet, in the seller's words
  // "Classic text mode" — mirrors the localStorage flag printing.ts routes on.
  const [classicText, setClassicText] = useState(() => isClassicTextSticker());
  // "Print QR on sticker" — per-device, DEFAULT OFF (localStorage; printing.ts threads it
  // into the sticker raster). Stamps a QR of the buyer @username so Parcel Scan can read
  // the handle back off the printed label.
  const [stickerQr, setStickerQr] = useState(() => isStickerQrOn());

  // v2 Bluetooth check — runs the moment the Bluetooth screen opens (the probe is the scan
  // call: instant answer when off / not allowed; the OS permission prompt appears now).
  const probe = useCallback(async (): Promise<BtProbeOutcome> => {
    const r = await btScanOutcome({ includeGenericPrinters: true });
    return { ok: r.ok, code: r.code, message: r.message };
  }, []);
  const bt = useBluetoothState(v2 && !wifi && btReady, probe);
  const blocked = btBlocked(bt.state);
  const scanEnabled = !v2 || (bt.state === "ready" && !btScanning);

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

  async function scanBt(showAll = false) {
    if (!btReady) { setBtMsg(t.rd_ps_open_app_scan); return; }
    setBtScanning(true); setBtMsg("");
    if (!v2) {
      const r = await btCall<BluetoothScanResult>("scanBluetoothLabelPrinters");
      setBtScanning(false);
      if (r) { setBtPrinters(r.printers || []); if (r.savedPrinter) setBtSaved(r.savedPrinter); setBtMsg(r.ok === false ? t.rd_ps_scan_unavail : ""); } // never the raw printer text
      else setBtMsg(t.rd_ps_scan_unavail);
      return;
    }
    const r = await btScanOutcome({ includeGenericPrinters: true, showAllDevices: showAll });
    setBtScanning(false); bt.clearRecovered();
    setBtScanned(true); setBtShowAll(showAll); setPick(null); setStage("idle");
    if (r.savedPrinter) setBtSaved(r.savedPrinter);
    if (r.ok) { setBtPrinters(r.printers); return; }
    setBtPrinters([]);
    if (!bt.report(r.code, r.message)) setBtMsg(t.rd_ps_scan_unavail); // off / not allowed → the card; anything else = one plain line
  }
  async function selectBt(p: BluetoothPrinterDevice) {
    const r = await btCall<BluetoothScanResult>("setBluetoothLabelPrinter", { address: p.address, name: p.name, transport: p.transport });
    setBtSaved(r?.savedPrinter || p); setBtMsg(t.rd_ps_bt_saved);
  }
  const btRow = (p: BluetoothPrinterDevice) => (
    <button key={p.id || p.address} onClick={() => void selectBt(p)} style={rowBtn}>
      <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{p.name || t.rd_ps_bt_device}</span><span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{p.address}</span></span>
      <span style={{ fontSize: 10.5, fontWeight: 800, color: p.paired ? "var(--ok)" : "var(--accent-fg)" }}>{p.paired ? t.rd_ps_paired : t.rd_ps_nearby}</span>
    </button>
  );
  const listBox: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, marginTop: 12, overflow: "hidden" };
  async function clearBt() { await btCall<BluetoothScanResult>("clearBluetoothLabelPrinter"); setBtSaved(null); setBtMsg(t.rd_ps_bt_cleared); setStage("idle"); setPick(null); }
  async function testBt() {
    if (!btReady) { setBtMsg(t.rd_ps_open_app_test); return; }
    if (!settings) return;
    setBtMsg(t.rd_ps_sending_test);
    // Routed like a real order: bitmap SDK stream by default, TEXT only when
    // Classic mode is ON / the bitmap method is missing (printStickerBtRouted).
    const r = await printStickerBtRouted(testBuyer(), cur, storeName, settings);
    if (r.ok) { setBtMsg(t.rd_ps_test_sent); setTestPrinted(true); return; } // an amber "didn't print" card turns green
    if (v2 && bt.report(r.code, r.message)) { setBtMsg(""); return; } // Bluetooth off / not allowed → the card says what to do
    setBtMsg(isPrinterNotSetup(r.code, r.message) ? t.rd_prn_title : t.rd_ps_test_failed);
  }

  // ── Printer setup v2: tap a printer → saved at once → one test sticker → green card ────────
  // D520BT = the unchanged D520 save + today's test buyer (golden-pinned stream). A listed
  // generic model (Y41BT) = generic save in its known language + the Chinese v2 test sticker.
  // A Niimbot = the vendor-SDK driver when the app has it (iOS 17.2+), else "not supported yet".
  // An unknown device (admin "Show all" only) is saved as a generic TSPL printer.
  const genericTransport = (p: BluetoothPrinterDevice) => (p.transport === "spp" ? "spp" : "ble"); // Android paired classic printers keep RFCOMM
  async function pickPrinter(p: BluetoothPrinterDevice) {
    if (stage === "printing" || !settings) return;
    const info = knownPrinterInfo(p);
    setPick(p); setBtMsg("");
    if (info?.brand === "Niimbot") {
      if (niimbotOsTooOld()) { setFailText(t.rd_nb_os_too_old); setStage("fail"); return; } // iOS < 17.2: no test print, say why
      if (!hasNiimbotBridge()) { setFailText(t.rd_ps_v2_brand_soon); setStage("fail"); return; }
    }
    setStage("printing");
    const d520 = p.model === "D520BT" || info?.brand === "AIMO";
    const save = d520
      ? { address: p.address, name: p.name, transport: p.transport }
      : info?.brand === "Niimbot"
        ? { address: p.address, name: p.name, transport: "niimbot", model: "generic" } // no language: the driver takes the image
        : { address: p.address, name: p.name, transport: genericTransport(p), model: "generic", lang: knownPrinterLang(p.name) ?? "tspl" };
    // Save first (the print router reads the saved printer), print one test sticker, THEN show it as saved.
    const r = await btCall<BluetoothScanResult>("setBluetoothLabelPrinter", save);
    const printed = await printStickerBtRouted(d520 ? testBuyer() : buildTestBuyerV2(), cur, storeName, settings);
    if (!printed.ok) bt.report(printed.code, printed.message); // Bluetooth off / not allowed → that card; anything else → the amber saved card
    setTestPrinted(printed.ok);
    setBtSaved(r?.savedPrinter || p);
    setBtPrinters([]); setBtScanned(false);
    setStage("saved");
  }
  const printerRow = (p: BluetoothPrinterDevice) => {
    const info = knownPrinterInfo(p);
    return (
      <button key={p.id || p.address} data-testid="ps-row" onClick={() => void pickPrinter(p)} disabled={stage === "printing"} style={{ ...rowBtn, minHeight: 56, opacity: stage === "printing" ? 0.6 : 1 }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || t.rd_ps_bt_device}</span>
          <span data-testid="ps-row-model" style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: info ? "var(--font-ui)" : "var(--font-mono)" }}>{info ? `${info.brand} ${info.model}`.trim() : p.address}</span>
        </span>
        {info && <span data-testid="ps-row-brand" style={brandPill}>{info.brand}</span>}
      </button>
    );
  };
  // The whitelist — or, after the admin's "Show all Bluetooth devices", every named device the scan returned.
  const listedPrinters = btShowAll ? btPrinters.filter((p) => !!(p.name || "").trim()) : btPrinters.filter((p) => knownPrinterInfo(p) !== null);

  // Top status: v2 Bluetooth = red (Bluetooth problem) / amber (ready, no printer) / green (printer saved).
  const v2Bt = v2 && !wifi;
  const dot = v2Bt
    ? (blocked ? "var(--danger)" : btSaved ? "var(--ok)" : "var(--warn)")
    : status.ok ? "var(--ok)" : nativeReady ? "var(--warn)" : "var(--text-muted)";
  const v2Title = blocked ? t.rd_bts_st_attention : btSaved ? tpl(t.rd_bts_st_connected, { name: btSaved.name || t.rd_ps_aimo }) : t.rd_bts_st_none;

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_back}</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>{t.rd_ps_title}</div>
      </div>

      <div style={{ padding: "16px 14px 24px" }}>
        <div data-testid="ps-status" style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 14, boxShadow: "var(--shadow)" }}>
          <span data-testid="ps-status-dot" data-tone={v2Bt ? (blocked ? "red" : btSaved ? "green" : "amber") : undefined} style={{ width: 13, height: 13, borderRadius: "50%", background: dot, flexShrink: 0, boxShadow: `0 0 7px ${dot}` }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v2Bt ? v2Title : wifi ? t.rd_ps_wifi_printer : t.rd_ps_bt_printer}</div>
            {/* Task D: the BT subtitle must never show the WiFi getPrinter
                message (`status` is populated by the LAN bridge on mount). WiFi
                keeps its own status.message; BT shows its paired device or the
                Bluetooth-accurate "No Bluetooth printer paired". */}
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{v2Bt ? t.rd_ps_bt_printer : wifi ? (status.message || t.rd_ps_not_connected) : (btSaved ? (btSaved.name || t.rd_ps_aimo) : t.rd_ps_bt_none)}</div>
          </div>
        </div>
        {!nativeReady && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>{t.rd_ps_native_note}</div>}

        {wifi ? (
          <div>
            <div style={groupLabel}>{t.rd_ps_output_format}</div>
            <div style={{ display: "flex", gap: 8, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 13, padding: 5, marginBottom: 12 }}>
              <button onClick={() => onSetPsOut("receipt")} style={tab(psOut === "receipt")}>{t.rd_ps_receipt}</button>
              <button onClick={() => onSetPsOut("sticker")} style={tab(psOut === "sticker")}>{t.rd_ps_sticker}</button>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 13, boxShadow: "var(--shadow)" }}>
              <label style={label}>{t.rd_ps_ip}</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.18.234" inputMode="decimal" style={{ ...input, marginBottom: 11 }} />
              <label style={label}>{t.rd_ps_port}</label>
              <input value={port} onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ""))} placeholder="9100" inputMode="numeric" style={input} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 12 }}>
              <button onClick={() => void refreshStatus()} style={gridBtn}>{t.rd_ps_find}</button>
              <button onClick={() => void testConn()} style={gridBtn}>{t.rd_ps_test_conn}</button>
              <button onClick={() => void saveLan()} style={{ ...gridBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)", boxShadow: "0 4px 14px var(--accent-soft)" }}>{t.rd_dash_connect}</button>
              <button onClick={() => void testPrint()} style={gridBtn}>{t.rd_ps_test_print}</button>
            </div>
          </div>
        ) : (
          <div>
            {/* v2: the Bluetooth cards — checked on open, re-checked by themselves. */}
            {v2 && bt.state === "off" && (
              <BtCard tone="red" testid="ps-bt-off" title={t.rd_bts_off_title} line={t.rd_bts_off_line} steps={[t.rd_bts_off_ios, t.rd_bts_off_android]} small={t.rd_bts_auto} />
            )}
            {v2 && bt.state === "notAllowed" && (
              <BtCard tone="amber" testid="ps-bt-perm" title={t.rd_bts_perm_title} line={t.rd_bts_perm_line} steps={[t.rd_bts_perm_ios, t.rd_bts_perm_android]} small={t.rd_bts_perm_auto} />
            )}
            {v2 && bt.state === "notReady" && (
              <BtCard tone="red" testid="ps-bt-notready" title={t.rd_bts_notready} small={t.rd_bts_auto} />
            )}
            {v2 && bt.state === "ready" && bt.recovered && (
              <div role="status" data-testid="ps-bt-ready" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "10px 13px", borderRadius: 12, background: "var(--ok-soft, rgba(5,150,105,.1))", border: "1px solid var(--ok)", fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
                <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--ok)", flexShrink: 0 }} />{t.rd_bts_ready}
              </div>
            )}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", marginTop: 16 }}>
              <label style={label}>{t.rd_ps_sticker_size}</label>
              {/* WEB (laptop): the browser print follows the Windows driver's paper
                  size and SellerFlow auto-fits one label — no in-app size to pick.
                  PHONE (native thermal): keep the size selector + the tiers. */}
              {!isAppShell() ? (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, padding: "10px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 11 }}>{t.rd_ps_web_driver_size}</div>
              ) : (<>
              <button onClick={onTogglePsSize} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{psSize}</span>
                <span style={{ color: "var(--text-muted)", transition: "transform .2s", transform: psSizeOpen ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>▾</span>
              </button>
              {psSizeOpen && (
                <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 11, overflow: "hidden" }}>
                  {(v2 ? [...PS_SIZES, "50x30mm"] : PS_SIZES).map((z) => {
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
              </>)}
              {btSaved && (
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{btSaved.name}</div><div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{btSaved.address}</div></div>
                  <button onClick={() => void clearBt()} style={{ ...gridBtn, padding: "7px 12px" }}>{t.rd_ps_clear}</button>
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: btSaved && stage !== "saved" ? "1fr 1fr" : "1fr", gap: 9, marginTop: 12 }}>
              <button data-testid="ps-scan" onClick={() => void scanBt()} disabled={!scanEnabled} aria-disabled={!scanEnabled} style={{ ...gridBtn, minHeight: 46, border: "none", background: scanEnabled ? "var(--accent)" : "var(--surface-2)", color: scanEnabled ? "var(--accent-text)" : "var(--text-muted)", boxShadow: scanEnabled ? "0 4px 14px var(--accent-soft)" : "inset 0 0 0 1px var(--border-strong)", cursor: scanEnabled ? "pointer" : "not-allowed", opacity: btScanning ? 0.6 : 1 }}>🔍 {btScanning ? t.rd_ps_scanning : t.rd_ps_scan}</button>
              {btSaved && stage !== "saved" && <button data-testid="ps-test-print" onClick={() => void testBt()} style={{ ...gridBtn, minHeight: 46 }}>{t.rd_ps_test_print}</button>}
            </div>
            {v2 && bt.state === "checking" && <div data-testid="ps-bt-checking" style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 10 }}>{t.rd_bts_checking}</div>}
            {!v2 && btPrinters.length > 0 && (
              <div style={listBox}>
                {btPrinters.map(btRow)}
              </div>
            )}
            {v2 && btScanned && stage !== "printing" && (
              <div data-testid="ps-v2-list">
                {listedPrinters.length > 0
                  ? <div style={listBox}>{listedPrinters.map(printerRow)}</div>
                  : <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 10 }}>{t.rd_ps_v2_none}</div>}
                {/* "Show all Bluetooth devices" lists AirPods/laptops too — admin-only (sellers got confused); a seller is pointed to Admin instead */}
                {!btShowAll && !isAdmin && (
                  <a data-testid="ps-v2-not-listed" href={TELEGRAM_URL} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 10, padding: "12px 6px", fontSize: 12.5, color: "var(--accent-fg)", fontWeight: 600, textAlign: "center", textDecoration: "none" }}>{t.rd_ps_v2_not_listed}</a>
                )}
                {!btShowAll && isAdmin && (
                  <button data-testid="ps-v2-show-all" onClick={() => void scanBt(true)} disabled={btScanning} style={{ display: "block", width: "100%", marginTop: 10, padding: "12px 6px", border: "none", background: "transparent", color: "var(--accent-fg)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "center", textDecoration: "underline" }}>{t.rd_ps_v2_show_all}</button>
                )}
              </div>
            )}
            {v2 && pick && stage === "printing" && (
              <div data-testid="ps-printing" role="status" style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
                <span aria-hidden style={{ width: 11, height: 11, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, animation: "sflDot 1s ease-in-out infinite" }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{tpl(t.rd_bts_printing, { name: pick.name || t.rd_ps_bt_device })}</div>
              </div>
            )}
            {v2 && pick && stage === "saved" && btSaved && (
              <BtCard tone={testPrinted ? "green" : "amber"} testid={testPrinted ? "ps-saved" : "ps-saved-warn"} title={testPrinted ? t.rd_bts_saved_title : t.rd_bts_saved_warn_title} line={tpl(t.rd_bts_saved_sub, { name: btSaved.name || pick.name || t.rd_ps_bt_device, size: psSize.replace(/\s*\(.*\)$/, "") })} small={testPrinted ? t.rd_bts_saved_line : t.rd_bts_saved_warn_line}>
                <button data-testid="ps-saved-test" onClick={() => void testBt()} style={{ ...gridBtn, width: "100%", minHeight: 46, marginTop: 12 }}>{t.rd_ps_test_print}</button>
              </BtCard>
            )}
            {v2 && pick && stage === "fail" && (
              <div data-testid="ps-v2-panel" style={card}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pick.name || t.rd_ps_bt_device}</div>
                <div data-testid="ps-v2-msg" style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.45, marginTop: 8 }}>{failText}</div>
                {/* A real anchor, tapped directly — the only external open that works in the iOS shell. */}
                <a data-testid="ps-v2-contact" href={TELEGRAM_URL} target="_blank" rel="noreferrer" style={{ ...gridBtn, display: "block", textAlign: "center", textDecoration: "none", marginTop: 10 }}>{t.rd_ps_v2_contact}</a>
              </div>
            )}
            {btMsg && <div data-testid="ps-bt-msg" style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 10 }}>{btMsg}</div>}
            {/* BITMAP-vs-TEXT escape hatch (new-board fix). Default OFF = bitmap
                mode (when the native passthrough exists — method-presence gated in
                printing.ts); ON = the byte-frozen classic TEXT path. Per-device
                localStorage, same pattern as the other printer prefs.
                ADMIN/TEST-ONLY (showClassicToggle ← canUseClassicText): hidden from
                regular sellers so nobody flips it onto the doubling TEXT path; the
                router also ignores the flag for users who can't see this card.
                Printer setup v2 hides the card (its stored behaviour is unchanged). */}
            {showClassicToggle && !v2 && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_ps_classic_text}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.45 }}>{t.rd_ps_classic_text_desc}</div>
              </div>
              <button
                aria-pressed={classicText}
                onClick={() => { const next = !classicText; setClassicTextSticker(next); setClassicText(next); }}
                style={{ width: 52, height: 30, borderRadius: 15, border: "none", cursor: "pointer", flexShrink: 0, position: "relative", background: classicText ? "var(--accent)" : "var(--surface-2)", boxShadow: classicText ? "0 3px 10px var(--accent-soft)" : "inset 0 0 0 1px var(--border-strong)", transition: "background .15s" }}
              >
                <span style={{ position: "absolute", top: 3, left: classicText ? 25 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.25)", transition: "left .15s" }} />
              </button>
            </div>
            )}
            {/* "Print QR on sticker" — all plans, hidden off-market (stickerQrAllowed);
                per-device, DEFAULT OFF. Adds a QR of the buyer @username to the sticker
                so Parcel Scan can read the handle back off the label — phone app via the
                bitmap sticker path, web via the browser-print sticker (printSlip SVG).
                The print-time gate (setStickerQrEntitled) is the authority regardless of
                a stored toggle. Nothing changes until turned on. */}
            {stickerQrAllowed && !stickerQrMoved && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_ps_sticker_qr}</div>
                {/* 60×40 is too small to hold a fast-scanning QR → toggle disabled + hint. */}
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.45 }} data-testid="ps-sticker-qr-hint">{qrUnsupportedSize ? t.rd_ps_sticker_qr_unavail : t.rd_ps_sticker_qr_desc}</div>
              </div>
              <button
                aria-pressed={qrUnsupportedSize ? false : stickerQr}
                disabled={qrUnsupportedSize}
                data-testid="ps-sticker-qr-toggle"
                onClick={() => { if (qrUnsupportedSize) return; const next = !stickerQr; setStickerQrOn(next); setStickerQr(next); }}
                style={{ width: 52, height: 30, borderRadius: 15, border: "none", cursor: qrUnsupportedSize ? "not-allowed" : "pointer", flexShrink: 0, position: "relative", opacity: qrUnsupportedSize ? 0.4 : 1, background: (!qrUnsupportedSize && stickerQr) ? "var(--accent)" : "var(--surface-2)", boxShadow: (!qrUnsupportedSize && stickerQr) ? "0 3px 10px var(--accent-soft)" : "inset 0 0 0 1px var(--border-strong)", transition: "background .15s" }}
              >
                <span style={{ position: "absolute", top: 3, left: (!qrUnsupportedSize && stickerQr) ? 25 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.25)", transition: "left .15s" }} />
              </button>
            </div>
            )}
          </div>
        )}

        <button onClick={onBack} style={{ width: "100%", marginTop: 16, padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 16px var(--accent-soft)" }}>{t.rd_ps_done}</button>
      </div>
    </div>
  );
}
