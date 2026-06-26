// Screen 18 — Printer settings. dc.html v3 L1174–1237. psOut/psSize ARE wired
// (persisted + feed the print payload via buildSettingsFromRedesign). The
// CONNECTION bits (IP/port, Find/Test/Connect, BT pairing) are Soon — real printer
// connection is APK-native — so they're disabled and the status is honest.
// psType is set on entry from the General Settings printer picker. Back → General Settings.
import type { CSSProperties } from "react";
import SoonBadge from "../components/SoonBadge";

const deadBtn: CSSProperties = { opacity: 0.45, cursor: "not-allowed" };
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
  // Honest status — the redesign does not yet persist/connect a printer (connection
  // is APK-native, Soon). Output format + size below ARE saved and used.
  const status = wifi
    ? { title: "WiFi printer not connected", sub: "Output format & size below are saved. Connecting (IP/port) is coming soon.", dot: "var(--warn)", bg: "rgba(217,119,6,.10)", border: "rgba(217,119,6,.35)" }
    : { title: "No Bluetooth printer", sub: "AIMO D520BT (TSPL, 100×60mm) — pairing coming soon. Sticker size below is saved.", dot: "var(--warn)", bg: "rgba(217,119,6,.10)", border: "rgba(217,119,6,.35)" };
  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>‹ Back</button>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>Printer settings</div>
          <SoonBadge label="Soon · connection" />
        </div>
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
              <input defaultValue="192.168.18.234" disabled style={{ ...input, marginBottom: 11, ...deadBtn }} />
              <label style={label}>Port</label>
              <input defaultValue="9100" disabled style={{ ...input, ...deadBtn }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 12 }}>
              <button disabled style={{ ...gridBtn, ...deadBtn }}>Find</button>
              <button disabled style={{ ...gridBtn, ...deadBtn }}>Test Connection</button>
              <button disabled style={{ ...gridBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)", boxShadow: "0 4px 14px var(--accent-soft)", ...deadBtn }}>Connect</button>
              <button disabled style={{ ...gridBtn, ...deadBtn }}>Test Print</button>
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
            <button disabled style={{ width: "100%", marginTop: 14, padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, boxShadow: "0 6px 16px var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, ...deadBtn }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#fff" strokeWidth="1.9" /><path d="m20 20-3.5-3.5" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" /></svg>Scan paired Bluetooth printers</button>
          </div>
        )}

        <button onClick={onBack} style={{ width: "100%", marginTop: 16, padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 16px var(--accent-soft)" }}>Save printer settings</button>
      </div>
    </div>
  );
}
