// Screen 3 — Products. dc.html L327–361.
import type { CSSProperties } from "react";
import { PRODUCTS, avColor, initials, fmt } from "../data";

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px" };
const title: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" };
const filterActive: CSSProperties = { background: "#fff", color: "var(--accent)", fontSize: 12, fontWeight: 700, padding: "6px 13px", borderRadius: 20, whiteSpace: "nowrap" };
const filterIdle: CSSProperties = { background: "rgba(255,255,255,.16)", fontSize: 12, fontWeight: 600, padding: "6px 13px", borderRadius: 20, whiteSpace: "nowrap" };
const mono = "var(--font-mono)";

const stockColor = (stock: number) => (stock === 0 ? "var(--danger)" : stock < 10 ? "var(--warn)" : "var(--ok)");
const stockLabel = (stock: number) => (stock === 0 ? "Out of stock" : stock < 10 ? `Low · ${stock} left` : `${stock} in stock`);
const barW = (stock: number) => `${Math.min(100, Math.round((stock / 120) * 100))}%`;

export default function Products({ cur }: { cur: string }) {
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={title}>Products</div>
          <button style={{ display: "flex", alignItems: "center", gap: 5, background: "#fff", color: "var(--accent)", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>+ Add</button>
        </div>
        <div className="sfl-scroll" style={{ display: "flex", gap: 7, marginTop: 13, overflowX: "auto" }}>
          <div style={filterActive}>All · 6</div>
          <div style={filterIdle}>Beauty</div>
          <div style={filterIdle}>Apparel</div>
          <div style={filterIdle}>Home</div>
        </div>
      </div>
      <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
        {PRODUCTS.map((p) => (
          <div key={p.sku} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, overflow: "hidden", boxShadow: "var(--shadow)" }}>
            <div style={{ height: 84, background: avColor(p.name), display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: "rgba(255,255,255,.9)", fontFamily: "var(--font-display)" }}>{initials(p.name)}</span>
              <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9.5, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,.3)", padding: "3px 7px", borderRadius: 6 }}>{p.cat}</span>
            </div>
            <div style={{ padding: "11px 11px 12px" }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", lineHeight: 1.25 }}>{p.name}</div>
              <div style={{ fontFamily: mono, fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{p.sku}</div>
              <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: "var(--text)", marginTop: 7 }}>{cur}{fmt(p.price)}</div>
              <div style={{ height: 5, borderRadius: 3, background: "var(--surface-3)", marginTop: 9, overflow: "hidden" }}>
                <div style={{ height: "100%", width: barW(p.stock), background: stockColor(p.stock), borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: stockColor(p.stock), marginTop: 6 }}>{stockLabel(p.stock)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
