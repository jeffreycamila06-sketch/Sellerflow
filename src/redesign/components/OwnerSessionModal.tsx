// OWNER "Start Session" modal (Session V2, owner-only) — shown on Connect when no
// session is running, IN PLACE OF the 1–5 day SessionPickerModal (which is left
// byte-for-byte unchanged for every other seller). One button: start a fixed 5-day
// session (start_session(5)); buyer# begins at 1 and runs continuously for 5 Taipei
// days, auto-ending Saturday 00:00 for a Monday start. Static (reduced-motion-safe),
// mirrors SessionPickerModal's shell.
import { type CSSProperties } from "react";
import { useT } from "../i18n";
import { SESSION_V2_DAYS } from "../adapters/sessionV2";

export default function OwnerSessionModal({
  onStart, onCancel,
}: {
  onStart: () => void; // start_session(5), then Connect proceeds
  onCancel: () => void; // abort connect — no feed, no session
}) {
  const t = useT();
  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 };
  const cardStyle: CSSProperties = { width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: 22, padding: "22px 20px 18px", boxShadow: "0 24px 60px rgba(9,7,24,.5)", fontFamily: "var(--font-ui)", position: "relative", marginBottom: "max(8px, env(safe-area-inset-bottom))" };
  const startBtn: CSSProperties = { width: "100%", marginTop: 14, padding: "15px 0", borderRadius: 14, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: "0 6px 16px var(--accent-soft)" };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t.rd_os_title}>
      <div style={cardStyle} data-testid="owner-session-modal">
        <button onClick={onCancel} aria-label={t.rd_sp_cancel} data-testid="owner-session-cancel" style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 999, border: "none", background: "var(--chip-bg)", color: "var(--text-dim)", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em" }}>{t.rd_os_title}</div>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", margin: "8px 0 2px", lineHeight: 1.55 }}>{t.rd_os_sub}</p>
        <button onClick={onStart} data-testid="owner-session-start" style={startBtn}>{t.rd_os_start}</button>
      </div>
    </div>
  );
}
