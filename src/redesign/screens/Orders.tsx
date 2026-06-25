// Screen 2 — Orders. dc.html L285–325.
import type { CSSProperties } from "react";
import { ORDERS, avColor, initials, fmt, statusColor } from "../data";

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px" };
const title: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" };
const filterActive: CSSProperties = { background: "#fff", color: "var(--accent)", fontSize: 12, fontWeight: 700, padding: "6px 13px", borderRadius: 20, whiteSpace: "nowrap" };
const filterIdle: CSSProperties = { background: "rgba(255,255,255,.16)", fontSize: 12, fontWeight: 600, padding: "6px 13px", borderRadius: 20, whiteSpace: "nowrap" };
const mono = "var(--font-mono)";

export default function Orders({ onGoPrint }: { onGoPrint: () => void }) {
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={title}>Orders</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "6px 11px", borderRadius: 9 }}>Today · 6</div>
        </div>
        <div className="sfl-scroll" style={{ display: "flex", gap: 7, marginTop: 13, overflowX: "auto" }}>
          <div style={filterActive}>All</div>
          <div style={filterIdle}>Unpaid · 2</div>
          <div style={filterIdle}>Paid · 2</div>
          <div style={filterIdle}>Shipped</div>
        </div>
      </div>
      <div style={{ padding: "14px 14px 22px", display: "flex", flexDirection: "column", gap: 11 }}>
        {ORDERS.map((o) => (
          <div key={o.id} onClick={onGoPrint} title="Print slip" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, padding: "13px 14px", boxShadow: "var(--shadow)", cursor: "pointer" }}>
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
                <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: "var(--text)", marginTop: 1 }}>₱{fmt(o.total)}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".03em", color: statusColor(o.status), background: "var(--surface-2)", border: "1px solid var(--border)", padding: "3px 9px", borderRadius: 7 }}>{o.status}</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>{o.platform}</span>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginLeft: "auto" }}>{o.time} ago</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
