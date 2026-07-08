// "Time for an update" modal (OKX-style) — shown on a cold app open when the
// running native binary is older than the web-declared latest. NATIVE-only
// (RedesignApp gates it); web browsers never mount it. Slide-to-update opens the
// store. All copy is i18n ×7 and deliberately payment-free (iOS 3.1.1-safe).
import { type CSSProperties } from "react";
import { useT } from "../i18n";
import { resolveMessageKey } from "../adapters/nativeVersion";
import SlideAction from "./SlideAction";

const rocket = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M5 15c-1.5 1-2 4-2 4s3-.5 4-2m9.5-11.5C13 7 9.5 11 8 14l2 2c3-1.5 7-5 8.5-8.5.4-1 .5-2 .5-3 0 0-2 .1-3 .5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M8.5 6.5C7 6 5.5 6.5 4.5 7.5L7 10M17.5 15.5c.5 1.5 0 3-1 4L14 17" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

export default function UpdateModal({
  messageKey, force, onDismiss, onComplete,
}: {
  messageKey: string;
  force: boolean;
  onDismiss: () => void;
  onComplete: () => void;
}) {
  const t = useT() as unknown as Record<string, string>;
  const msg = t[resolveMessageKey(messageKey)] ?? t.rd_upd_msg_generic;

  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 };
  const cardStyle: CSSProperties = { width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: 22, padding: "22px 20px 20px", boxShadow: "0 24px 60px rgba(9,7,24,.5)", fontFamily: "var(--font-ui)", position: "relative", marginBottom: "max(8px, env(safe-area-inset-bottom))" };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t.rd_upd_title}>
      <div style={cardStyle} data-testid="update-modal">
        {!force && (
          <button onClick={onDismiss} aria-label={t.rd_upd_close} data-testid="update-close" style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 999, border: "none", background: "var(--chip-bg)", color: "var(--text-dim)", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        )}
        <div style={{ width: 52, height: 52, borderRadius: 15, background: "var(--accent-soft)", color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>{rocket}</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em" }}>{t.rd_upd_title}</div>
        <p style={{ fontSize: 14, color: "var(--text-dim)", margin: "8px 0 20px", lineHeight: 1.5 }}>{msg}</p>
        <SlideAction label={t.rd_upd_slide} doneLabel={t.rd_upd_opening} onComplete={onComplete} testid="update" />
      </div>
    </div>
  );
}
