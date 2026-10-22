// Screen 18 — Printer settings. REAL native connection wired to the SAME
// window.SellerFlowPrinter bridge production uses (printerBridge.ts, copied verbatim):
// WiFi find/test/connect/test-print + Bluetooth scan/select/clear/test. psOut/psSize
// persist + feed the payload (unchanged). Back → General Settings.
//
// ⚠️ NATIVE-ONLY / PREVIEW-UNVERIFIABLE: on web/preview there is no bridge, so every
// action returns the friendly "open the app" status (safe no-op). Only verifiable in
// a real APK.
//
// PRINTER SETUP v2 ("no switch, fewer taps" — flowV2 + an app build with the generic
// printer method): the scan list shows PRINTERS ONLY with a "✓ Works with SFL" / "New"
// pill; a known printer saves at once and prints one test sticker; a new printer prints
// one test sticker, asks "Did it look like this?", retries once in the other command
// language, then says it isn't supported yet. Everyone else keeps today's screen.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  callMobilePrinterBridge, btCall, hasNativePrinter, hasBtBridge, buildTestBuyer,
  hasGenericPrinterBridge, testGenericPrinter, genericDebugLine, hasNiimbotBridge, niimbotOsTooOld,
  type MobilePrinterResult, type BluetoothScanResult, type BluetoothPrinterDevice,
} from "../adapters/printerBridge";
import { buildNativeStickerPayload, buildGenericStickerBytes, buildNiimbotImage, niimbotErrorKey, printStickerBtRouted, isPrinterNotSetup, isClassicTextSticker, setClassicTextSticker, isStickerQrOn, setStickerQrOn, type Settings } from "../adapters/printing";
import { bytesToBase64 } from "../adapters/stickerRaster";
import { isKnownPrinter, isPrinterOnlyRow, knownPrinterLang, nextLang, brandOf, type PrinterLang } from "../adapters/printerModels";
import { TELEGRAM_URL } from "../../lib/telegram";
import ExactStickerPreview from "../components/ExactStickerPreview";
import { useT } from "../i18n";
import { isAppShell } from "../adapters/appShell";

const PS_SIZES = ["100x60mm (Standard)", "80x60mm", "80x50mm", "70x50mm", "60x40mm"];
const label: CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const input: CSSProperties = { width: "100%", padding: "11px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, outline: "none" };
const groupLabel: CSSProperties = { fontSize: 11, letterSpacing: ".12em", fontWeight: 800, color: "var(--text-muted)", margin: "14px 2px 8px" };
const gridBtn: CSSProperties = { padding: "12px 0", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const tab = (active: boolean): CSSProperties => ({ flex: 1, padding: "13px 0", borderRadius: 11, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, textAlign: "center", border: "none", ...(active ? { background: "var(--surface)", color: "var(--accent-fg)", boxShadow: "var(--shadow)" } : { background: "transparent", color: "var(--text-dim)" }) });
const rowBtn: CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" };
const pill = (known: boolean): CSSProperties => ({ flexShrink: 0, whiteSpace: "nowrap", fontSize: 10.5, fontWeight: 800, padding: "4px 8px", borderRadius: 999, border: `1px solid ${known ? "var(--ok)" : "var(--accent)"}`, color: known ? "var(--ok)" : "var(--accent-fg)", background: "var(--surface-2)" });

type V2Stage = "idle" | "saving" | "testing" | "retry" | "ask" | "unsupported" | "brand" | "fail";

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
  isAdmin?: boolean; // admin-only debug line after a generic test print
}) {
  const t = useT();
  const wifi = psType === "wifi";
  const testBuyer = () => { const b = buildTestBuyer(); return testComment ? { ...b, orders: [{ ...b.orders[0], item: testComment }] } : b; };
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
  // Printer setup v2: gated accounts on an app build with the native generic-printer method.
  // Older apps (and the web, which has no bridge) keep today's screen exactly.
  const v2 = flowV2 && hasGenericPrinterBridge();
  const [btScanned, setBtScanned] = useState(false);
  const [btShowAll, setBtShowAll] = useState(false);
  const [v2Pick, setV2Pick] = useState<BluetoothPrinterDevice | null>(null);
  const [v2Stage, setV2Stage] = useState<V2Stage>("idle");
  const [v2Lang, setV2Lang] = useState<PrinterLang>("tspl");
  const [v2Debug, setV2Debug] = useState("");
  const [v2Fail, setV2Fail] = useState(""); // a Niimbot test failure, in the seller's words
  const v2PictureBuyer = useMemo(() => testBuyer(), [testComment]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Classic text mode" — mirrors the localStorage flag printing.ts routes on.
  const [classicText, setClassicText] = useState(() => isClassicTextSticker());
  // "Print QR on sticker" — per-device, DEFAULT OFF (localStorage; printing.ts threads it
  // into the sticker raster). Stamps a QR of the buyer @username so Parcel Scan can read
  // the handle back off the printed label.
  const [stickerQr, setStickerQr] = useState(() => isStickerQrOn());

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
    const r = v2
      ? await btCall<BluetoothScanResult>("scanBluetoothLabelPrinters", { includeGenericPrinters: true, showAllDevices: showAll })
      : await btCall<BluetoothScanResult>("scanBluetoothLabelPrinters");
    setBtScanning(false);
    if (v2) { setBtScanned(true); setBtShowAll(showAll); setV2Pick(null); setV2Stage("idle"); }
    if (r) { setBtPrinters(r.printers || []); if (r.savedPrinter) setBtSaved(r.savedPrinter); setBtMsg(r.ok === false ? t.rd_ps_scan_unavail : ""); } // never the raw printer text
    else setBtMsg(t.rd_ps_scan_unavail);
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
  async function clearBt() { await btCall<BluetoothScanResult>("clearBluetoothLabelPrinter"); setBtSaved(null); setBtMsg(t.rd_ps_bt_cleared); }
  async function testBt() {
    if (!btReady) { setBtMsg(t.rd_ps_open_app_test); return; }
    if (!settings) return;
    setBtMsg(t.rd_ps_sending_test);
    // Routed like a real order: bitmap SDK stream by default, TEXT only when
    // Classic mode is ON / the bitmap method is missing (printStickerBtRouted).
    const r = await printStickerBtRouted(testBuyer(), cur, storeName, settings);
    if (r.ok) { setBtMsg(t.rd_ps_test_sent); return; }
    setBtMsg(isPrinterNotSetup(r.code, r.message) ? t.rd_prn_title : t.rd_ps_test_failed);
  }

  // ── Printer setup v2 ────────────────────────────────────────────────────────
  // Known printer (D520BT or a listed model): save at once, then one test sticker through
  // the SAME route a real order takes. New printer: one test sticker per language (TSPL,
  // ESC/POS, CPCL — the same sticker image each time), ask after each, then "not supported
  // yet". A Niimbot (by name) goes through the vendor-SDK driver when the app has it (one test
  // label = the same sticker image, 50×30, then the same question); an app without the driver
  // → "not supported yet". Every test = ONE native call; nothing is re-sent on its own.
  const genericTransport = (p: BluetoothPrinterDevice) => (p.transport === "spp" ? "spp" : "ble"); // Android paired classic printers keep RFCOMM
  async function pickV2(p: BluetoothPrinterDevice) {
    if (v2Stage !== "idle" || !settings) return;
    setV2Pick(p); setV2Debug(""); setBtMsg("");
    if (brandOf(p) === "niimbot") {
      if (niimbotOsTooOld()) { setV2Fail(t.rd_nb_os_too_old); setV2Stage("fail"); return; } // iOS < 17.2: no test print, say why
      if (hasNiimbotBridge()) await tryNiimbot(p); else setV2Stage("brand");
      return;
    }
    if (isKnownPrinter(p)) {
      setV2Stage("saving");
      const save = p.model === "D520BT"
        ? { address: p.address, name: p.name, transport: p.transport }
        : { address: p.address, name: p.name, transport: genericTransport(p), model: "generic", lang: knownPrinterLang(p.name) ?? "tspl" };
      const r = await btCall<BluetoothScanResult>("setBluetoothLabelPrinter", save);
      setBtSaved(r?.savedPrinter || p);
      const printed = await printStickerBtRouted(testBuyer(), cur, storeName, settings);
      setBtMsg(printed.ok ? t.rd_ps_test_sent : t.rd_ps_test_failed);
      setV2Stage("idle"); setV2Pick(null);
      return;
    }
    await tryLang(p, "tspl");
  }
  async function tryLang(p: BluetoothPrinterDevice, lang: PrinterLang) {
    if (!settings) return;
    setV2Lang(lang); setV2Stage(lang === "tspl" ? "testing" : "retry");
    // Every try = the SAME sticker image real orders will print, in that language (ready bytes).
    const payload = buildNativeStickerPayload(testBuyer(), cur, storeName, settings);
    const r = await testGenericPrinter(p.address, { data: bytesToBase64(await buildGenericStickerBytes(lang, payload, payload.buyer.platform)), ...(p.transport === "spp" ? { transport: "spp" } : {}) });
    setV2Debug(genericDebugLine(r));
    if (r.ok) { setV2Stage("ask"); return; }
    await nextOrGiveUp(p, lang);
  }
  async function tryNiimbot(p: BluetoothPrinterDevice) {
    if (!settings) return;
    setV2Stage("testing");
    const payload = buildNativeStickerPayload(testBuyer(), cur, storeName, settings);
    const r = await testGenericPrinter(p.address, { transport: "niimbot", name: p.name, image: await buildNiimbotImage(payload, payload.buyer.platform) });
    setV2Debug(genericDebugLine(r));
    if (r.ok) { setV2Stage("ask"); return; }
    const k = niimbotErrorKey(r.code);
    setV2Fail(k ? t[k] : t.rd_ps_test_failed); setV2Stage("fail");
  }
  async function nextOrGiveUp(p: BluetoothPrinterDevice, lang: PrinterLang) {
    const n = nextLang(lang, hasNiimbotBridge()); // CPCL only on a build that can store it
    if (n) { await tryLang(p, n); return; }
    setV2Stage("unsupported");
  }
  async function answerV2(yes: boolean) {
    const p = v2Pick;
    if (!p) return;
    const niimbot = brandOf(p) === "niimbot";
    if (!yes) { if (niimbot) setV2Stage("brand"); else await nextOrGiveUp(p, v2Lang); return; }
    const save = niimbot
      ? { address: p.address, name: p.name, transport: "niimbot", model: "generic" } // no language: the driver takes the image
      : { address: p.address, name: p.name, transport: genericTransport(p), model: "generic", lang: v2Lang };
    const r = await btCall<BluetoothScanResult>("setBluetoothLabelPrinter", save);
    // The language the seller just confirmed must be the one native STORED (an older build
    // that only knows tspl/escpos echoes tspl, or nothing): never keep a wrong language —
    // clear the save and say "not supported yet" instead.
    if (!niimbot && (r?.savedPrinter?.lang ?? "tspl") !== v2Lang) {
      await btCall<BluetoothScanResult>("clearBluetoothLabelPrinter");
      setBtSaved(null); setBtMsg(""); setV2Stage("unsupported");
      return;
    }
    setBtSaved(r?.savedPrinter || p); setBtMsg(t.rd_ps_bt_saved);
    setV2Pick(null); setV2Stage("idle");
  }
  const v2Row = (p: BluetoothPrinterDevice) => {
    const known = isKnownPrinter(p);
    return (
      <button key={p.id || p.address} data-testid="ps-v2-row" onClick={() => void pickV2(p)} disabled={v2Stage !== "idle"} style={{ ...rowBtn, opacity: v2Stage !== "idle" ? 0.6 : 1 }}>
        <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || t.rd_ps_bt_device}</span><span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.address}{p.transport === "spp" ? <span data-testid="ps-v2-classic" style={{ fontFamily: "var(--font-ui)", marginLeft: 6 }}>· {t.rd_ps_v2_classic}</span> : null}</span></span>
        <span data-testid={known ? "ps-v2-known" : "ps-v2-new"} style={pill(known)}>{known ? t.rd_ps_v2_works : t.rd_ps_v2_new}</span>
      </button>
    );
  };
  // Printers only — or, after "Show all Bluetooth devices", every named device the scan returned.
  const v2Printers = btShowAll ? btPrinters.filter((p) => !!(p.name || "").trim()) : btPrinters.filter(isPrinterOnlyRow);

  const dot = status.ok ? "var(--ok)" : nativeReady ? "var(--warn)" : "var(--text-muted)";

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_back}</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>{t.rd_ps_title}</div>
      </div>

      <div style={{ padding: "16px 14px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 14, boxShadow: "var(--shadow)" }}>
          <span style={{ width: 13, height: 13, borderRadius: "50%", background: dot, flexShrink: 0, boxShadow: `0 0 7px ${dot}` }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{wifi ? t.rd_ps_wifi_printer : t.rd_ps_bt_printer}</div>
            {/* Task D: the BT subtitle must never show the WiFi getPrinter
                message (`status` is populated by the LAN bridge on mount). WiFi
                keeps its own status.message; BT shows its paired device or the
                Bluetooth-accurate "No Bluetooth printer paired". */}
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{wifi ? (status.message || t.rd_ps_not_connected) : (btSaved ? (btSaved.name || t.rd_ps_aimo) : t.rd_ps_bt_none)}</div>
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
            <div style={{ display: "grid", gridTemplateColumns: btSaved ? "1fr 1fr" : "1fr", gap: 9, marginTop: 12 }}>
              <button onClick={() => void scanBt()} disabled={btScanning} style={{ ...gridBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)", boxShadow: "0 4px 14px var(--accent-soft)", opacity: btScanning ? 0.6 : 1 }}>🔍 {btScanning ? t.rd_ps_scanning : t.rd_ps_scan}</button>
              {btSaved && <button onClick={() => void testBt()} style={gridBtn}>{t.rd_ps_test_print}</button>}
            </div>
            {!v2 && btPrinters.length > 0 && (
              <div style={listBox}>
                {btPrinters.map(btRow)}
              </div>
            )}
            {v2 && btScanned && (
              <div data-testid="ps-v2-list">
                {v2Printers.length > 0
                  ? <div style={listBox}>{v2Printers.map(v2Row)}</div>
                  : <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 10 }}>{t.rd_ps_v2_none}</div>}
                {!btShowAll && (
                  <button data-testid="ps-v2-show-all" onClick={() => void scanBt(true)} disabled={btScanning || v2Stage !== "idle"} style={{ display: "block", width: "100%", marginTop: 10, padding: "12px 6px", border: "none", background: "transparent", color: "var(--accent-fg)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "center", textDecoration: "underline" }}>{t.rd_ps_v2_show_all}</button>
                )}
              </div>
            )}
            {v2 && v2Pick && (
              <div data-testid="ps-v2-panel" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", marginTop: 12 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v2Pick.name || t.rd_ps_bt_device}</div>
                {v2Stage === "saving" && <div data-testid="ps-v2-msg" style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 8 }}>{t.rd_ps_v2_saved_testing}</div>}
                {v2Stage === "testing" && <div data-testid="ps-v2-msg" style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 8 }}>{t.rd_ps_gen_testing}</div>}
                {v2Stage === "retry" && <div data-testid="ps-v2-msg" style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 8 }}>{t.rd_ps_v2_other}</div>}
                {v2Stage === "ask" && settings && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ maxWidth: 220 }}><ExactStickerPreview settings={brandOf(v2Pick) === "niimbot" ? { ...settings, stickerSize: "50x30" } : settings} cur={cur} shopName={storeName} v2={!!testComment} flags={{}} buyer={v2PictureBuyer} extraAtlas /></div>
                    <div data-testid="ps-v2-ask" style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 10 }}>{t.rd_ps_v2_ask}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 8 }}>
                      <button data-testid="ps-v2-yes" onClick={() => void answerV2(true)} style={{ ...gridBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)" }}>{t.rd_ps_v2_yes}</button>
                      <button data-testid="ps-v2-no" onClick={() => void answerV2(false)} style={gridBtn}>{t.rd_ps_v2_no}</button>
                    </div>
                  </div>
                )}
                {(v2Stage === "unsupported" || v2Stage === "brand" || v2Stage === "fail") && (
                  <div style={{ marginTop: 10 }}>
                    <div data-testid="ps-v2-msg" style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.45 }}>{v2Stage === "brand" ? t.rd_ps_v2_brand_soon : v2Stage === "fail" ? v2Fail : t.rd_ps_gen_unsupported}</div>
                    {/* A real anchor, tapped directly — the only external open that works in the iOS shell. */}
                    <a data-testid="ps-v2-contact" href={TELEGRAM_URL} target="_blank" rel="noreferrer" style={{ ...gridBtn, display: "block", textAlign: "center", textDecoration: "none", marginTop: 10 }}>{t.rd_ps_v2_contact}</a>
                  </div>
                )}
                {isAdmin && v2Debug && <div data-testid="ps-v2-debug" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-muted)", marginTop: 8, wordBreak: "break-all" }}>{v2Debug}</div>}
              </div>
            )}
            {btMsg && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 10 }}>{btMsg}</div>}
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
