// Screen 13 — Shipping. dc.html v2 L888–909.
import { SHIPPING, avColor, initials, statusColor } from "../data";
import { headerBar, headerTitle, card, mono } from "../ui";

export default function Shipping() {
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={headerTitle}>Shipping</div>
          <div style={{ fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "6px 11px", borderRadius: 9 }}>4 to ship</div>
        </div>
      </div>
      <div style={{ padding: "14px 14px 22px", display: "flex", flexDirection: "column", gap: 11 }}>
        {SHIPPING.map((s) => (
          <div key={s.id} style={{ ...card, padding: "13px 14px", borderRadius: 15 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: avColor(s.buyer), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(s.buyer)}</div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{s.buyer}</div><div style={{ fontFamily: mono, fontSize: 11.5, color: "var(--text-muted)" }}>{s.id}</div></div>
              <span style={{ fontSize: 11, fontWeight: 800, color: statusColor(s.status), background: "var(--surface-2)", border: "1px solid var(--border)", padding: "3px 9px", borderRadius: 7, flexShrink: 0 }}>{s.status}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)" }}>{s.courier}</span>
              <span style={{ fontFamily: mono, fontSize: 11.5, color: "var(--accent-fg)", fontWeight: 600 }}>{s.track}</span>
              <span style={{ fontSize: 11.5, color: "var(--accent-fg)", fontWeight: 700, marginLeft: "auto" }}>Track ›</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
