// Screen 18 — Printer settings. dc.html v3 L1174–1237. Visual only — no real
// printer connection (Phase 5). psType is set on entry from the General Settings
// printer picker (no in-screen switcher, per dc.html). Back → General Settings.
import type { CSSProperties } from "react";

const PS_SIZES = ["100x60mm (Standard)", "80x60mm", "80x50mm", "70x50mm", "60x40mm"];
const label: CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const input: CSSProperties = { width: "100%", padding: "11px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, outline: "none" };
const groupLabel: CSSProperties = { fontSize: 11, letterSpacing: ".12em", fontWeight: 800, color: "var(--text-muted)", margin: "14px 2px 8px" };
const gridBtn: CSSProperties = { padding: "12px 0", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const tab = (active: boolean): CSSProperties => ({ flex: 1, padding: "13px 0", borderRadius: 11, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, textAlign: "center", border: "none", ...(active ? { background: "var(--surface)", color: "var(--accent-fg)", boxShadow: "var(--shadow)" } : { background: "transparent", color: "var(--text-dim)" }) });

export default function PrinterSettings({
  onBack, psType, psOut, onSetPsOut, psSize, psSizeOpen, onTogglePsSize, onPickPsSize,
}: {
  onBack: () => void;
  psType: "wifi" | "bt";
  psOut: "receipt" | "sticker"; onSetPsOut: (o: "receipt" | "sticker") => void;
  psSize: string; psSizeOpen: boolean; onTogglePsSize: () => void; onPickPsSize: (s: string) => void;
}) {
  const wifi = psType === "wifi";
  const status = wifi
    ? { title: "192.168.18.234:9100", sub: "Saved WiFi printer · 192.168.18.234:9100", dot: "#22c55e", bg: "rgba(34,197,94,.10)", border: "rgba(34,197,94,.35)" }
    : { title: "No printer connected", sub: "Recommended: AIMO D520BT (TSPL, 100×60mm)", dot: "#ef4444", bg: "rgba(239,68,68,.10)", border: "rgba(239,68,68,.35)" };
  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>‹ Back</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>Printer settings</div>
      </div>

      <div style={{ padding: "16px 14px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: status.bg, border: `1px solid ${status.border}`, borderRadius: 14, padding: 14 }}>
          <span style={{ width: 13, height: 13, borderRadius: "50%", background: status.dot, flexShrink: 0, boxShadow: `0 0 7px ${status.dot}` }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{status.title}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{status.sub}</div>
          </div>
        </div>

        {wifi ? (
          <div>
            <div style={groupLabel}>OUTPUT FORMAT</div>
            <div style={{ display: "flex", gap: 8, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 13, padding: 5, marginBottom: 12 }}>
              <button onClick={() => onSetPsOut("receipt")} style={tab(psOut === "receipt")}>Receipt</button>
              <button onClick={() => onSetPsOut("sticker")} style={tab(psOut === "sticker")}>Sticker</button>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 13, boxShadow: "var(--shadow)" }}>
              <label style={label}>Printer IP address</label>
              <input defaultValue="192.168.18.234" style={{ ...input, marginBottom: 11 }} />
              <label style={label}>Port</label>
              <input defaultValue="9100" style={input} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 12 }}>
              <button style={gridBtn}>Find</button>
              <button style={gridBtn}>Test Connection</button>
              <button style={{ ...gridBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)", boxShadow: "0 4px 14px var(--accent-soft)" }}>Connect</button>
              <button style={gridBtn}>Test Print</button>
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
            </div>
            <button style={{ width: "100%", marginTop: 14, padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 16px var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#fff" strokeWidth="1.9" /><path d="m20 20-3.5-3.5" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" /></svg>Scan paired Bluetooth printers</button>
          </div>
        )}

        <button onClick={onBack} style={{ width: "100%", marginTop: 16, padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 16px var(--accent-soft)" }}>Save printer settings</button>
      </div>
    </div>
  );
}
