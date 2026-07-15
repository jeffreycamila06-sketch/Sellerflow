// "No printer connected" modal — shown when an order printed but the native
// bridge reported no printer is set up yet (BT_NOT_SET / PRINTER_NOT_SET). The
// order was ALREADY saved (Option A) — this only nudges the seller to finish
// printer setup, then reprint from Orders. Mirrors the ExpiryModal/UpdateModal
// shape (overlay + bottom card). The primary action is an INTERNAL button
// (navigate to Printer Settings) — NOT an external anchor — so no iOS anchor
// gymnastics apply. All copy is i18n ×7.
import { type CSSProperties } from "react";
import { useT } from "../i18n";

// Amber tone — a config warning, not an error. Fixed palette (self-contained,
// like the Landing/Raffle overlays) so it renders identically in both themes.
const AMBER = "#d97706";
const AMBER_SOFT = "rgba(217,119,6,.14)";

const printerOff = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M6 9V4h9m3 0h.5A1.5 1.5 0 0 1 20 5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 17H4.5A1.5 1.5 0 0 1 3 15.5V11A2 2 0 0 1 5 9h4m8 0h2a2 2 0 0 1 2 2v4.5a1.5 1.5 0 0 1-1.5 1.5H18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 14h5m-5 4h8v3H8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

export default function PrinterModal({
  onGoSettings, onDismiss,
}: {
  onGoSettings: () => void;
  onDismiss: () => void;
}) {
  const t = useT() as unknown as Record<string, string>;

  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 };
  const cardStyle: CSSProperties = { width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: 22, padding: "22px 20px 20px", boxShadow: "0 24px 60px rgba(9,7,24,.5)", fontFamily: "var(--font-ui)", position: "relative", marginBottom: "max(8px, env(safe-area-inset-bottom))" };
  const primary: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "15px 0", borderRadius: 14, background: "var(--accent)", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700, border: "none", cursor: "pointer", boxShadow: "0 8px 20px rgba(9,7,24,.28)" };
  const secondary: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "13px 0", marginTop: 8, borderRadius: 14, background: "transparent", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer" };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t.rd_prn_title}>
      <div style={cardStyle} data-testid="printer-modal">
        <button onClick={onDismiss} aria-label={t.rd_prn_dismiss} data-testid="printer-close" style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 999, border: "none", background: "var(--chip-bg)", color: "var(--text-dim)", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        <div style={{ width: 52, height: 52, borderRadius: 15, background: AMBER_SOFT, color: AMBER, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>{printerOff}</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em" }}>{t.rd_prn_title}</div>
        <p style={{ fontSize: 14, color: "var(--text-dim)", margin: "8px 0 20px", lineHeight: 1.5 }}>{t.rd_prn_body}</p>
        <button onClick={onGoSettings} data-testid="printer-go" style={primary}>{t.rd_prn_go}</button>
        <button onClick={onDismiss} data-testid="printer-dismiss" style={secondary}>{t.rd_prn_dismiss}</button>
      </div>
    </div>
  );
}
