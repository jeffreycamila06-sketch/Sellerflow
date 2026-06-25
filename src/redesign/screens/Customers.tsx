// Screen 7 — Customers (list + comment archive). dc.html v2 L647–689.
import { CUSTOMERS, ARCHIVE, avColor, initials, fmt } from "../data";
import { headerBar, headerTitle, mono } from "../ui";

export default function Customers() {
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={headerTitle}>Customers</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "6px 11px", borderRadius: 9 }}>1,284 total</div>
        </div>
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.16)", borderRadius: 11, padding: "9px 12px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <span style={{ fontSize: 13, opacity: 0.85 }}>Search name or @handle</span>
        </div>
      </div>
      <div style={{ padding: "14px 14px 22px" }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "var(--shadow)", overflow: "hidden", marginBottom: 18 }}>
          {CUSTOMERS.map((c) => (
            <div key={c.handle} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: avColor(c.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(c.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{c.name}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)" }}>{c.handle} · {c.platform}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>₱{fmt(c.spent)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{c.orders} orders · {c.last}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)", margin: "0 2px 10px" }}>Comment archive</div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "var(--shadow)", padding: 6 }}>
          {ARCHIVE.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "9px 8px" }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: avColor(a.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(a.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{a.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--handle)" }}>{a.handle}</span>
                  <span style={{ fontSize: 10.5, color: "var(--text-muted)", marginLeft: "auto" }}>{a.time}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 1 }}>{a.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
