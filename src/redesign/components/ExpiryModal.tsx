// Plan-expiry modal — overlay + card, tone escalating amber→red per tier. The
// action is a REAL <a target="_blank" rel="noreferrer"> styled as a button — the
// exact proven mechanism the working Settings Telegram redirect uses, which the
// Capacitor iOS WKWebView opens reliably (the slide gesture did NOT open on real
// iOS, twice). PLATFORM-SPLIT for iOS 3.1.1: Android/web "plan"/"Renew now"; iOS
// "account"/"Contact support" — NONE of the forbidden billing words (asserted).
// Always dismissible (no force); server-side gates do the real enforcement.
import { type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { expiryTone, type ExpiryTier } from "../adapters/planExpiryModal";

// Renew/contact destination — the SAME link Settings support/subscription use.
const RENEW_URL = "https://t.me/SellerFlowLive1995";

const clock = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="1.7" />
    <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function ExpiryModal({
  tier, daysLeft, ios, onDismiss, onAction,
}: {
  tier: ExpiryTier;
  daysLeft: number;
  ios: boolean;
  onDismiss: () => void;
  onAction: () => void; // dismissal side-effect on tap; the anchor href does the opening
}) {
  const t = useT() as unknown as Record<string, string>;
  const tone = expiryTone(tier);
  const days = Number.isFinite(daysLeft) ? Math.max(1, daysLeft) : tier === "3d" ? 3 : 7;

  const headline = ios
    ? (tier === "expired" ? t.rd_exp_ios_h_expired : tier === "1d" ? t.rd_exp_ios_h_today : tpl(t.rd_exp_ios_h_soon, { days }))
    : (tier === "expired" ? t.rd_exp_h_expired : tier === "1d" ? t.rd_exp_h_today : tpl(t.rd_exp_h_soon, { days }));
  const body = ios ? t.rd_exp_ios_body : t.rd_exp_body;
  const action = ios ? t.rd_exp_ios_action : t.rd_exp_action;

  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 };
  const cardStyle: CSSProperties = { width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: 22, padding: "22px 20px 20px", boxShadow: "0 24px 60px rgba(9,7,24,.5)", fontFamily: "var(--font-ui)", position: "relative", marginBottom: "max(8px, env(safe-area-inset-bottom))" };
  const btn: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "15px 0", borderRadius: 14, background: tone.accent, color: "#fff", fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700, textDecoration: "none", cursor: "pointer", boxShadow: "0 8px 20px rgba(9,7,24,.28)" };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={headline}>
      <div style={cardStyle} data-testid="expiry-modal">
        <button onClick={onDismiss} aria-label={t.rd_upd_close} data-testid="expiry-close" style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 999, border: "none", background: "var(--chip-bg)", color: "var(--text-dim)", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        <div style={{ width: 52, height: 52, borderRadius: 15, background: tone.soft, color: tone.accent, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>{clock}</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em" }}>{headline}</div>
        <p style={{ fontSize: 14, color: "var(--text-dim)", margin: "8px 0 20px", lineHeight: 1.5 }}>{body}</p>
        <a href={RENEW_URL} target="_blank" rel="noreferrer" onClick={onAction} data-testid="expiry-action" style={btn}>{action}</a>
      </div>
    </div>
  );
}
