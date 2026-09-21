// "End session?" confirmation (Session V2, owner-only). Shown when the owner taps the
// red End Session button; only Confirm calls end_session(). Cancel / ✕ closes with no
// effect. Static (reduced-motion-safe), centered dialog.
import { type CSSProperties } from "react";
import { useT } from "../i18n";

export default function EndSessionConfirm({
  onConfirm, onCancel,
}: {
  onConfirm: () => void; // end_session() → board clears → toast
  onCancel: () => void;
}) {
  const t = useT();
  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
  const card: CSSProperties = { width: "100%", maxWidth: 380, background: "var(--surface)", borderRadius: 20, padding: "22px 20px 18px", boxShadow: "0 24px 60px rgba(9,7,24,.5)", fontFamily: "var(--font-ui)" };
  const btn = (variant: "cancel" | "danger"): CSSProperties => ({ flex: 1, padding: "13px 0", borderRadius: 13, border: variant === "cancel" ? "1px solid var(--border-strong)" : "none", background: variant === "danger" ? "#D64545" : "var(--surface-2)", color: variant === "danger" ? "#fff" : "var(--text)", fontFamily: "var(--font-ui)", fontSize: 14.5, fontWeight: 700, cursor: "pointer" });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t.rd_os_confirm_title}>
      <div style={card} data-testid="end-session-confirm">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em" }}>{t.rd_os_confirm_title}</div>
        <p style={{ fontSize: 14, color: "var(--text-dim)", margin: "10px 0 18px", lineHeight: 1.55 }}>{t.rd_os_confirm_body}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} data-testid="end-session-cancel" style={btn("cancel")}>{t.rd_os_confirm_cancel}</button>
          <button onClick={onConfirm} data-testid="end-session-go" style={btn("danger")}>{t.rd_os_confirm_go}</button>
        </div>
      </div>
    </div>
  );
}
