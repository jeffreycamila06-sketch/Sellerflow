// Screen 2 — Orders. dc.html L285–325.
// Phase 5b: reads today's REAL live-session orders (loadTodaysLiveSession +
// rebuildSessionFromRows) via the useLiveOrders adapter; falls back to sample
// when unconfigured, shows loading / empty states otherwise. Read-only.
import type { CSSProperties } from "react";
import { ORDERS, avColor, initials, fmt, statusColor, type Order } from "../data";
import type { ReadState } from "../adapters/useReadData";
import { useT } from "../i18n";

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px" };
const title: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" };
const mono = "var(--font-mono)";

export default function Orders({ onGoPrint, cur, orders = ORDERS, state = "sample", onExport, onGoShipping }: { onGoPrint: () => void; cur: string; orders?: Order[]; state?: ReadState; onExport?: () => void; onGoShipping?: () => void }) {
  const t = useT();
  const live = state === "live";
  const badge = state === "loading" ? `${t.rd_ord_today} · …` : `${t.rd_ord_today} · ${orders.length}`;
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={title}>{t.rd_ord_title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {/* 7-11 shipping entry point (Jeff: inside Orders) */}
            {onGoShipping && <button onClick={onGoShipping} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "6px 10px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>🚚 {t.rd_sh_shipping}</button>}
            {onExport && orders.length > 0 && <button onClick={onExport} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "6px 10px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_export}</button>}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "6px 11px", borderRadius: 9 }}>{badge}</div>
          </div>
        </div>
        {/* Batch B #3 — the All/Unpaid/Paid/Shipped chip row was removed: the
            chips were non-clickable divs and there is NO status lifecycle
            behind them (every real order is "New" → the three counts were
            permanently 0). The real order count lives in the header badge. */}
      </div>
      <div style={{ padding: "14px 14px 22px", display: "flex", flexDirection: "column", gap: 11 }}>
        {state === "loading" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>{t.rd_ord_loading}</div>}
        {state === "empty" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>{t.rd_ord_empty}</div>}
        {orders.map((o, idx) => (
          <div key={`${o.id}-${idx}`} onClick={onGoPrint} title={t.rd_ord_print_slip} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, padding: "13px 14px", boxShadow: "var(--shadow)", cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: avColor(o.buyer), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(o.buyer)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)" }}>{o.buyer}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)" }}>{o.handle}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{o.id}</div>
                <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: "var(--text)", marginTop: 1 }}>{cur}{fmt(o.total)}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".03em", color: statusColor(o.status), background: "var(--surface-2)", border: "1px solid var(--border)", padding: "3px 9px", borderRadius: 7 }}>{o.status}</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>{o.platform}</span>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginLeft: "auto" }}>{live ? o.time : `${o.time} ${t.rd_ord_ago}`}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
