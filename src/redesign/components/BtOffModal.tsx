// "Bluetooth is off" — a small centered modal shown when a native print failed
// because the phone's Bluetooth is OFF (see adapters/btOff.ts). One OK button,
// nothing else. The order is already saved; "Not printed" + Reprint unchanged.
import { type CSSProperties } from "react";
import { useT } from "../i18n";

const btOffIcon = (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M7 7l10 10-5 5V2l5 5L7 17" stroke="#2563eb" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 4l16 16" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export default function BtOffModal({ onClose }: { onClose: () => void }) {
  const t = useT() as unknown as Record<string, string>;
  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
  const card: CSSProperties = { width: "100%", maxWidth: 320, background: "var(--surface)", borderRadius: 20, padding: "24px 20px 18px", boxShadow: "0 24px 60px rgba(9,7,24,.5)", fontFamily: "var(--font-ui)", textAlign: "center" };
  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t.rd_bt_off_title}>
      <div style={card} data-testid="bt-off-modal">
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: "#e8f0fe", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>{btOffIcon}</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{t.rd_bt_off_title}</div>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", margin: "8px 0 18px", lineHeight: 1.5 }}>{t.rd_bt_off_body}</p>
        <button type="button" onClick={onClose} data-testid="bt-off-ok" style={{ width: "100%", padding: "12px 0", borderRadius: 12, border: "none", background: "var(--accent)", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_bt_off_ok}</button>
      </div>
    </div>
  );
}
