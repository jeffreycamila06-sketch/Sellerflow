// "Need help?" contact modal — REUSES the proven iOS-safe Telegram-anchor pattern
// (ContactSupportPopup / ExpiryModal): the primary action is a REAL
// <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener"> styled as a
// button. WKWebView on iOS opens a real anchor reliably; window.open does NOT
// (documented twice in the expiry/update sagas). Two actions: secondary "Next time"
// (just closes, no navigation) + primary "Proceed" (opens Telegram, closes on tap —
// the established ContactSupportPopup convention). Display only; no socket/live touch.
import type { CSSProperties } from "react";
import { useT } from "../i18n";
import { TELEGRAM_URL } from "../../lib/telegram";

const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
const modal: CSSProperties = { width: "100%", maxWidth: 340, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, boxShadow: "0 24px 60px rgba(9,7,24,.45)", padding: "24px 22px", textAlign: "center", fontFamily: "var(--font-ui)" };
const proceedBtn: CSSProperties = { width: "100%", padding: "13px 0", border: "none", borderRadius: 12, background: "#0088cc", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 6px 16px rgba(0,136,204,.35)" };
const laterBtn: CSSProperties = { width: "100%", padding: "12px 0", border: "1px solid var(--border-strong)", borderRadius: 12, background: "transparent", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", marginTop: 9 };

// Lifebuoy / help icon (accent-tinted — NOT a destructive/red icon).
const lifebuoy = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.7" />
    <path d="m5.6 5.6 3.8 3.8M14.6 14.6l3.8 3.8M18.4 5.6l-3.8 3.8M9.4 14.6l-3.8 3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);
const tgPlane = <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg>;

export default function SupportContactModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t.rd_sh_help} data-testid="support-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 52, height: 52, borderRadius: 15, background: "var(--accent-soft)", color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>{lifebuoy}</div>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text)", margin: "0 0 8px" }}>{t.rd_sh_help}</h3>
        <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55, margin: "0 0 18px" }}>{t.rd_help_body}</p>
        <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" onClick={onClose} data-testid="support-proceed" style={proceedBtn}>{tgPlane} {t.rd_help_proceed}</a>
        <button onClick={onClose} data-testid="support-later" style={laterBtn}>{t.rd_help_later}</button>
      </div>
    </div>
  );
}
