// Plan-expiry modal — same overlay + card + SlideAction shell as the update
// modal, tone escalating amber→red per tier. PLATFORM-SPLIT for iOS 3.1.1: the
// Android/web variant says "plan"/"renew"; the iOS variant says "account"/
// "contact support" and contains NONE of the forbidden billing words (asserted
// in tests). Slide destination is the same Telegram support link on both. Always
// dismissible (no force) — this is a UI nudge; server-side gates do enforcement.
import { type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { expiryTone, type ExpiryTier } from "../adapters/planExpiryModal";
import SlideAction from "./SlideAction";

const clock = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="1.7" />
    <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function ExpiryModal({
  tier, daysLeft, ios, onDismiss, onComplete,
}: {
  tier: ExpiryTier;
  daysLeft: number;
  ios: boolean;
  onDismiss: () => void;
  onComplete: () => void;
}) {
  const t = useT() as unknown as Record<string, string>;
  const tone = expiryTone(tier);
  const days = Number.isFinite(daysLeft) ? Math.max(1, daysLeft) : tier === "3d" ? 3 : 7;

  const headline = ios
    ? (tier === "expired" ? t.rd_exp_ios_h_expired : tier === "1d" ? t.rd_exp_ios_h_today : tpl(t.rd_exp_ios_h_soon, { days }))
    : (tier === "expired" ? t.rd_exp_h_expired : tier === "1d" ? t.rd_exp_h_today : tpl(t.rd_exp_h_soon, { days }));
  const body = ios ? t.rd_exp_ios_body : t.rd_exp_body;
  const slideLabel = ios ? t.rd_exp_ios_slide : t.rd_exp_slide;
  const slideDone = ios ? t.rd_exp_ios_slide_done : t.rd_exp_slide_done;

  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 };
  const cardStyle: CSSProperties = { width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: 22, padding: "22px 20px 20px", boxShadow: "0 24px 60px rgba(9,7,24,.5)", fontFamily: "var(--font-ui)", position: "relative", marginBottom: "max(8px, env(safe-area-inset-bottom))" };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={headline}>
      <div style={cardStyle} data-testid="expiry-modal">
        <button onClick={onDismiss} aria-label={t.rd_upd_close} data-testid="expiry-close" style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 999, border: "none", background: "var(--chip-bg)", color: "var(--text-dim)", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        <div style={{ width: 52, height: 52, borderRadius: 15, background: tone.soft, color: tone.accent, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>{clock}</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em" }}>{headline}</div>
        <p style={{ fontSize: 14, color: "var(--text-dim)", margin: "8px 0 20px", lineHeight: 1.5 }}>{body}</p>
        <SlideAction label={slideLabel} doneLabel={slideDone} onComplete={onComplete} fill={tone.fill} knobFg={tone.accent} testid="expiry" />
      </div>
    </div>
  );
}
