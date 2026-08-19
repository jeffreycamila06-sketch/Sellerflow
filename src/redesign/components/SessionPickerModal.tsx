// SESSION PICKER (required, on Connect) — explicit session model, sub-step 2.
// Shown when NO session is running: the seller MUST choose a length before the
// live feed starts. Tapping a length = the pick (creates the session, then the
// feed starts). The only non-pick exit is Cancel / ✕, which ABORTS the connect —
// there is NO path that starts a feed without a session. Static (no animation) →
// reduced-motion-safe by construction, matching ExpiryModal's convention.
import { type CSSProperties } from "react";
import { useT, tpl } from "../i18n";

const SESSION_OPTS = [1, 2, 3, 4]; // match Dashboard's pill (4-day added 2026-07-13)

export default function SessionPickerModal({
  onPick, onCancel,
}: {
  onPick: (days: number) => void; // creates the session, then Connect proceeds
  onCancel: () => void;           // abort connect — no feed, no session
}) {
  const t = useT();
  const dayUnit = (n: number) => `${n} ${n > 1 ? t.rd_dash_days : t.rd_dash_day}`;

  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 };
  const cardStyle: CSSProperties = { width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: 22, padding: "22px 20px 18px", boxShadow: "0 24px 60px rgba(9,7,24,.5)", fontFamily: "var(--font-ui)", position: "relative", marginBottom: "max(8px, env(safe-area-inset-bottom))" };
  const opt: CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface-2)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)", marginTop: 9 };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t.rd_sp_title}>
      <div style={cardStyle} data-testid="session-picker">
        <button onClick={onCancel} aria-label={t.rd_sp_cancel} data-testid="session-picker-cancel" style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 999, border: "none", background: "var(--chip-bg)", color: "var(--text-dim)", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em" }}>{t.rd_sp_title}</div>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", margin: "8px 0 6px", lineHeight: 1.5 }}>{t.rd_sp_sub}</p>
        {SESSION_OPTS.map((n) => (
          <button key={n} onClick={() => onPick(n)} data-testid={`session-pick-${n}`} style={opt}>
            <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15 }}>{n}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{dayUnit(n)}</span>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>{n === 1 ? t.rd_dash_ship_same_day : tpl(t.rd_dash_nday_live, { n })}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
