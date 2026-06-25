// Screen 14 — Customer Data (admin export table). dc.html v2 L912–932.
import { CUSTOMERS, fmt } from "../data";
import { headerBar, headerTitle, mono } from "../ui";

export default function CustomerData({ onLegal }: { onLegal: () => void }) {
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={headerTitle}>Customer data</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Admin export</div>
          </div>
          <button style={{ background: "#fff", color: "var(--accent)", fontSize: 12, fontWeight: 700, padding: "7px 12px", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>Export CSV</button>
        </div>
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <div style={{ display: "flex", padding: "10px 14px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em", color: "var(--text-muted)" }}>
            <span style={{ flex: 1.6 }}>CUSTOMER</span><span style={{ flex: 0.8, textAlign: "right" }}>ORDERS</span><span style={{ flex: 1.1, textAlign: "right" }}>SPENT</span>
          </div>
          {CUSTOMERS.map((c) => (
            <div key={c.handle} style={{ display: "flex", alignItems: "center", padding: "11px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: 1.6, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--handle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.handle}</div>
              </div>
              <div style={{ flex: 0.8, textAlign: "right", fontFamily: mono, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{c.orders}</div>
              <div style={{ flex: 1.1, textAlign: "right", fontFamily: mono, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>₱{fmt(c.spent)}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.5, padding: "0 2px" }}>Customer data is encrypted and handled per our <span onClick={onLegal} style={{ color: "var(--accent-fg)", fontWeight: 700, cursor: "pointer" }}>Privacy Policy</span>. Export access is logged.</div>
      </div>
    </div>
  );
}
