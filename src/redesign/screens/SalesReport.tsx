// Screen 12 — Sales Report. dc.html v2 L859–885.
import { SALES } from "../data";
import { headerBar, headerTitle, card, mono } from "../ui";
import SoonBadge from "../components/SoonBadge";

const maxSale = Math.max(...SALES.map((s) => s.v));

export default function SalesReport({ cur }: { cur: string }) {
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}><div style={headerTitle}>Sales report</div><SoonBadge /></div>
          <div style={{ fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "6px 11px", borderRadius: 9 }}>This week ▾</div>
        </div>
        <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 6 }}>Weekly aggregation isn’t connected yet — sample data shown.</div>
      </div>
      <div style={{ padding: "16px 14px 22px" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div style={{ ...card, flex: 1, borderRadius: 15, padding: 14 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>This week</div>
            <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 22, color: "var(--text)", marginTop: 4, letterSpacing: "-.02em" }}>{cur}114.4k</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ok)", marginTop: 3 }}>▲ 18% vs last</div>
          </div>
          <div style={{ ...card, flex: 1, borderRadius: 15, padding: 14 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Orders</div>
            <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 22, color: "var(--text)", marginTop: 4, letterSpacing: "-.02em" }}>352</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", marginTop: 3 }}>{cur}325 avg</div>
          </div>
        </div>

        <div style={{ ...card, padding: "16px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 14 }}>Daily sales</div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, height: 130 }}>
            {SALES.map((s) => (
              <div key={s.d} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 7 }}>
                <div style={{ width: "100%", height: `${Math.round((s.v / maxSale) * 100)}%`, background: "var(--accent)", borderRadius: "6px 6px 3px 3px", minHeight: 6 }} />
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-muted)" }}>{s.d}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 11 }}>Top product</div>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: "#ec4899", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff" }}>ML</div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>Matte Lipstick — Red</div><div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>184 sold this week</div></div>
            <div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{cur}45.8k</div>
          </div>
        </div>
      </div>
    </div>
  );
}
