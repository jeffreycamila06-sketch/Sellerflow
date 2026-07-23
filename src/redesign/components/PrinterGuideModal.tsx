// Printer setup guide — a short informational modal shown BEFORE the technical
// setup screen when the seller picks a printer type that isn't set up yet. Two
// variants (kind): "wifi" (receipt printer over WiFi/LAN — mentions IP) and "bt"
// (Bluetooth sticker printer — NO IP anywhere). Tapping OK reveals the setup
// screen; the ✕ closes without proceeding. Mirrors PrinterModal's shape (overlay
// + bottom card, INTERNAL buttons — no external anchor). All copy is i18n ×7.
import { type CSSProperties } from "react";
import { useT } from "../i18n";

const ACCENT_SOFT = "var(--accent-soft)";

const wifiIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8 15.5a5 5 0 0 1 8 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" />
  </svg>
);
const btIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M7 7.5 17 16l-5 4V4l5 4L7 16.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

export default function PrinterGuideModal({
  kind, onOk, onClose,
}: {
  kind: "wifi" | "bt";
  onOk: () => void;
  onClose: () => void;
}) {
  const t = useT() as unknown as Record<string, string>;
  const wifi = kind === "wifi";
  const title = wifi ? t.rd_wg_title : t.rd_bg_title;
  const steps = wifi
    ? [t.rd_wg_1, t.rd_wg_2, t.rd_wg_3, t.rd_wg_4]
    : [t.rd_bg_1, t.rd_bg_2, t.rd_bg_3, t.rd_bg_4];

  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 };
  const cardStyle: CSSProperties = { width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: 22, padding: "22px 20px 20px", boxShadow: "0 24px 60px rgba(9,7,24,.5)", fontFamily: "var(--font-ui)", position: "relative", marginBottom: "max(8px, env(safe-area-inset-bottom))" };
  const primary: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "15px 0", borderRadius: 14, background: "var(--accent)", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700, border: "none", cursor: "pointer", boxShadow: "0 8px 20px rgba(9,7,24,.28)" };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={cardStyle} data-testid={`printer-guide-${kind}`}>
        <button onClick={onClose} aria-label={t.rd_prn_dismiss} data-testid="printer-guide-close" style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 999, border: "none", background: "var(--chip-bg)", color: "var(--text-dim)", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        <div style={{ width: 52, height: 52, borderRadius: 15, background: ACCENT_SOFT, color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>{wifi ? wifiIcon : btIcon}</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em", marginBottom: 14 }}>{title}</div>
        <ol style={{ margin: "0 0 20px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 11 }}>
          {steps.map((s, i) => (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
              <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 999, background: ACCENT_SOFT, color: "var(--accent-fg)", fontSize: 12.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{i + 1}</span>
              <span style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.5 }}>{s}</span>
            </li>
          ))}
        </ol>
        <button onClick={onOk} data-testid="printer-guide-ok" style={primary}>{t.rd_pg_ok}</button>
      </div>
    </div>
  );
}
