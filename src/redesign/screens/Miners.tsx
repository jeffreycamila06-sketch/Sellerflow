// Screen 4 — Miners (analytics). dc.html L363–419.
import type { CSSProperties } from "react";
import { MINERS, avColor, initials, fmt } from "../data";

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px" };
const statCard: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, padding: 14, boxShadow: "var(--shadow)" };
const statLbl: CSSProperties = { fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600 };
const bigNum: CSSProperties = { fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 25, color: "var(--text)", marginTop: 4, letterSpacing: "-.02em" };
const mono = "var(--font-mono)";

export default function Miners() {
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" }}>Miners</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>Buyers who claimed "mine"</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "6px 11px", borderRadius: 9 }}>30 days ▾</div>
        </div>
      </div>
      <div style={{ padding: "14px 14px 22px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div style={statCard}>
            <div style={statLbl}>Total buyers</div>
            <div style={bigNum}>1,284</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ok)", marginTop: 3 }}>▲ 12% this month</div>
          </div>
          <div style={statCard}>
            <div style={statLbl}>Total orders</div>
            <div style={bigNum}>3,947</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ok)", marginTop: 3 }}>▲ 8% this month</div>
          </div>
          <div style={statCard}>
            <div style={statLbl}>Total spent</div>
            <div style={{ ...bigNum, fontSize: 22 }}>₱1.28M</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", marginTop: 3 }}>₱325 avg order</div>
          </div>
          <div style={statCard}>
            <div style={statLbl}>Platforms</div>
            <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
              <div style={{ flex: 1, textAlign: "center", background: "var(--surface-2)", borderRadius: 9, padding: "7px 0" }}>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: "var(--text)" }}>64%</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>TikTok</div>
              </div>
              <div style={{ flex: 1, textAlign: "center", background: "var(--surface-2)", borderRadius: 9, padding: "7px 0" }}>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: "var(--text)" }}>36%</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>Facebook</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)", margin: "4px 2px 10px" }}>Top buyers</div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "var(--shadow)", overflow: "hidden" }}>
          {MINERS.map((m, i) => (
            <div key={m.handle} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: "var(--text-muted)", width: 16 }}>{i + 1}</div>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: avColor(m.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(m.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{m.name}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)" }}>{m.handle}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontFamily: mono, fontSize: 14.5, fontWeight: 700, color: "var(--text)" }}>₱{fmt(m.spent)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{m.orders} orders</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
