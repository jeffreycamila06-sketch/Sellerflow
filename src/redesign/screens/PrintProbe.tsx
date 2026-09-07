// DEV-ONLY diagnostic screen (NOT in production nav) — reached ONLY via 5 rapid taps
// on the Printer Settings header title, or ?printprobe=1 in a browser. Sends raw TSPL
// probe payloads through the SAME native BLE/SPP transport as testStickerPrint
// (window.SellerFlowPrinter.printRawTspl), never through the production sticker path.
// Plain English (dev tool, single user) — deliberately NOT i18n'd. Trivially removable:
// delete this file + adapters/printProbe.ts + the one "printprobe" gate in RedesignApp.
import { useState, type CSSProperties } from "react";
import { btCallOutcome, hasBtBridge } from "../adapters/printerBridge";
import { buildProbes, toBase64 } from "../adapters/printProbe";

const SIZES = ["100x60", "80x60", "80x50", "70x50", "60x40"];

export default function PrintProbe({ onBack, psSize }: { onBack: () => void; psSize: string }) {
  const [size, setSize] = useState<string>(() => {
    const m = /(\d+)x(\d+)/i.exec(psSize || "");
    return m ? `${m[1]}x${m[2]}` : "100x60";
  });
  const [msg, setMsg] = useState("Probe screen opened. Load a label, pick the size that matches the media, then tap a probe.");
  const [busy, setBusy] = useState(false);
  const probes = buildProbes(size);

  const send = async (label: string, bytes: Uint8Array) => {
    if (busy) return;
    if (!hasBtBridge()) { setMsg("No native Bluetooth bridge — open this in the app (dev build), not a browser."); return; }
    setBusy(true);
    setMsg(`Sending "${label}" (${bytes.length} bytes)…`);
    try {
      const r = await btCallOutcome("printRawTspl", { data: toBase64(bytes), label });
      setMsg(r.ok ? `Sent "${label}" (${bytes.length} bytes). Check the label.` : `Failed "${label}": ${r.message || r.code || "unknown"}`);
    } catch (e) {
      setMsg(`Error "${label}": ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  const header: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 };
  const backBtn: CSSProperties = { display: "flex", alignItems: "center", background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" };
  const sizeBtn = (on: boolean): CSSProperties => ({ flex: 1, padding: "9px 0", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 700, background: on ? "var(--accent)" : "var(--surface-2)", color: on ? "var(--accent-text)" : "var(--text-dim)" });
  const probeBtn: CSSProperties = { width: "100%", textAlign: "left", padding: "13px 14px", borderRadius: 12, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, fontFamily: "var(--font-ui)", marginBottom: 9 };

  return (
    <div>
      <div style={header}>
        <button onClick={onBack} style={backBtn}>← Back</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18 }}>Print Probe · DEV</div>
      </div>
      <div style={{ padding: "16px 14px 28px" }}>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 12 }}>
          Diagnoses new-board doubled glyphs. Raw TSPL over the same Bluetooth transport as Test Print — production sticker path untouched. Print each on the NEW board and the OLD board and compare.
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>LABEL SIZE (match loaded media)</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {SIZES.map((z) => <button key={z} onClick={() => setSize(z)} style={sizeBtn(z === size)}>{z}</button>)}
        </div>
        {probes.map((p) => (
          <button key={p.id} style={probeBtn} disabled={busy} onClick={() => void send(p.label, p.bytes)}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{p.label}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>{p.note} · {p.bytes.length} bytes</div>
          </button>
        ))}
        <div style={{ marginTop: 14, padding: "11px 13px", borderRadius: 11, background: "var(--surface-2)", border: "1px solid var(--border)", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, minHeight: 40 }}>{msg}</div>
      </div>
    </div>
  );
}
