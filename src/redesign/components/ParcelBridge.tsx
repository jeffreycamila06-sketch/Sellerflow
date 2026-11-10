// Parcel Scan bridge (Jeff 2026-11-11, Option A): the ⇄ button at the top right of the 7-11 and
// the FamilyMart Parcel Scan headers, and the small store badge next to each title. Display only —
// the button just opens the other Parcel Scan (RedesignApp passes it only when the seller may use both).
import type { CSSProperties } from "react";
import { useT } from "../i18n";

export type BridgeStore = "711" | "fm";
const LABEL: Record<BridgeStore, string> = { "711": "7-11", fm: "全家" };

const badge: CSSProperties = {
  display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 999,
  background: "rgba(255,255,255,.22)", color: "var(--on-header)", fontSize: 11.5, fontWeight: 800,
  lineHeight: 1.4, whiteSpace: "nowrap", flexShrink: 0, fontFamily: "var(--font-ui)",
};
const button: CSSProperties = {
  position: "absolute", top: "50%", right: 12, transform: "translateY(-50%)",
  minHeight: 44, minWidth: 80, padding: "0 12px", borderRadius: 11, border: "1px solid rgba(255,255,255,.35)",
  background: "rgba(255,255,255,.18)", color: "var(--on-header)", fontFamily: "var(--font-ui)",
  fontSize: 14, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
};

/** Small badge after the title: which store this screen encodes for. */
export function StoreBadge({ store }: { store: BridgeStore }) {
  return <span style={badge} data-testid="parcel-store-badge" data-store={store}>{LABEL[store]}</span>;
}

/** "⇄ 全家" / "⇄ 7-11" — opens the OTHER Parcel Scan (`to`). */
export function BridgeButton({ to, onClick }: { to: BridgeStore; onClick: () => void }) {
  const t = useT();
  const aria = to === "fm" ? t.rd_ps_bridge_to_fm : t.rd_ps_bridge_to_711;
  return (
    <button type="button" onClick={onClick} aria-label={aria} title={aria} style={button} data-testid="parcel-bridge" data-to={to}>
      <span aria-hidden="true">⇄</span> {LABEL[to]}
    </button>
  );
}
