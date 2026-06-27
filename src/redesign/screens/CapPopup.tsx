// Phase 5f — free-tier cap popup (near + hard), redesign-styled. Mirrors the
// production modal (App.tsx:4471-4496): 🚀 near-cap celebration / 🎉 hard stop,
// with an Upgrade CTA. Subscriptions stay manual (Wise + Telegram) — Upgrade
// routes to the Subscription screen.
import type { CSSProperties } from "react";
import type { CapPopupKind, FreeStatus } from "../adapters/useFreeCap";
import { useT, tpl } from "../i18n";

const overlay: CSSProperties = { position: "absolute", inset: 0, zIndex: 12, background: "rgba(8,6,24,.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
const modal: CSSProperties = { width: "100%", maxWidth: 340, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,.4)", padding: "24px 22px", textAlign: "center" };
const upgradeBtn: CSSProperties = { width: "100%", padding: "13px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 18px var(--accent-soft)" };
const outBtn: CSSProperties = { width: "100%", padding: "12px 0", border: "1px solid var(--border-strong)", borderRadius: 12, background: "transparent", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", marginTop: 9 };

export default function CapPopup({
  kind, freeStatus, onUpgrade, onClose, onViewOrders,
}: {
  kind: Exclude<CapPopupKind, "">;
  freeStatus: FreeStatus | null;
  onUpgrade: () => void;
  onClose: () => void;
  onViewOrders: () => void;
}) {
  const t = useT();
  const isHard = kind === "hard";
  const count = freeStatus?.count ?? 0;
  const cap = freeStatus?.cap ?? 200;
  const resetDays = freeStatus?.cycle_resets_in_days ?? 30;
  const left = Math.max(0, cap - count);
  const title = isHard ? tpl(t.rd_cap_hard_title, { cap }) : t.rd_cap_near_title;
  const msg = isHard
    ? tpl(resetDays === 1 ? t.rd_cap_hard_msg_one : t.rd_cap_hard_msg_many, { cap, days: resetDays })
    : tpl(t.rd_cap_near_msg, { left, cap });
  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 12 }} aria-hidden="true">{isHard ? "🎉" : "🚀"}</div>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text)", margin: "0 0 8px" }}>{title}</h3>
        <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55, margin: "0 0 18px" }}>{msg}</p>
        <button style={upgradeBtn} onClick={onUpgrade}>{t.rd_cap_upgrade}</button>
        {isHard
          ? <button style={outBtn} onClick={onViewOrders}>{t.rd_cap_view_orders}</button>
          : <button style={outBtn} onClick={onClose}>{t.rd_cap_later}</button>}
      </div>
    </div>
  );
}
