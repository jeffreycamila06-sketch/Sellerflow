// Screen 4 — Miners (analytics). dc.html L363–419.
// Phase 5j: top buyers + totals are DERIVED from the already-loaded real customers
// (no dedicated aggregation backend) when `live`; sample fallback otherwise. Real
// CSV export of the derived data.
import type { CSSProperties } from "react";
import { MINERS, avColor, initials, fmt, type Miner } from "../data";
import { useT } from "../i18n";

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px" };
const statCard: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, padding: 14, boxShadow: "var(--shadow)" };
const statLbl: CSSProperties = { fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600 };
const bigNum: CSSProperties = { fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 25, color: "var(--text)", marginTop: 4, letterSpacing: "-.02em" };
const mono = "var(--font-mono)";

export interface MinerStats { buyers: number; orders: number; spent: number; avg: number; tiktokPct: number; fbPct: number }

export default function Miners({ cur, miners = MINERS, stats, live = false, onExport }: { cur: string; miners?: Miner[]; stats?: MinerStats; live?: boolean; onExport?: () => void }) {
  const t = useT();
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" }}>{t.rd_min_title}</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{t.rd_min_sub}</div>
          </div>
          {onExport
            ? <button onClick={onExport} title={t.rd_exp_top5_note} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "6px 11px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_export}</button>
            : <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "6px 11px", borderRadius: 9 }}>{t.rd_min_30days}</div>}
        </div>
        {/* #7 export-scope label: the CSV covers the top-5 buyers the RPC returns */}
        {onExport && <div style={{ fontSize: 10.5, opacity: 0.75, marginTop: 7 }}>{t.rd_exp_top5_note}</div>}
      </div>
      <div style={{ padding: "14px 14px 22px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div style={statCard}>
            <div style={statLbl}>{t.rd_min_total_buyers}</div>
            <div style={bigNum}>{live && stats ? fmt(stats.buyers) : "1,284"}</div>
            {!live && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ok)", marginTop: 3 }}>{t.rd_min_up12}</div>}
          </div>
          <div style={statCard}>
            <div style={statLbl}>{t.rd_min_total_orders}</div>
            <div style={bigNum}>{live && stats ? fmt(stats.orders) : "3,947"}</div>
            {!live && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ok)", marginTop: 3 }}>{t.rd_min_up8}</div>}
          </div>
          <div style={statCard}>
            <div style={statLbl}>{t.rd_min_total_spent}</div>
            <div style={{ ...bigNum, fontSize: 22 }}>{cur}{live && stats ? fmt(stats.spent) : "1.28M"}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", marginTop: 3 }}>{cur}{live && stats ? fmt(stats.avg) : "325"} {t.rd_min_avg_order}</div>
          </div>
          <div style={statCard}>
            <div style={statLbl}>{t.rd_min_platforms}</div>
            <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
              <div style={{ flex: 1, textAlign: "center", background: "var(--surface-2)", borderRadius: 9, padding: "7px 0" }}>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{live && stats ? stats.tiktokPct : 64}%</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>TikTok</div>
              </div>
              <div style={{ flex: 1, textAlign: "center", background: "var(--surface-2)", borderRadius: 9, padding: "7px 0" }}>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{live && stats ? stats.fbPct : 36}%</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>Facebook</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)", margin: "4px 2px 10px" }}>{t.rd_min_top_buyers}</div>
        {live && miners.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>{t.rd_min_empty}</div>}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "var(--shadow)", overflow: "hidden", display: miners.length ? "block" : "none" }}>
          {miners.map((m, i) => (
            <div key={m.handle} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: "var(--text-muted)", width: 16 }}>{i + 1}</div>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: avColor(m.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(m.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{m.name}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)" }}>{m.handle}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontFamily: mono, fontSize: 14.5, fontWeight: 700, color: "var(--text)" }}>{cur}{fmt(m.spent)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{m.orders} {t.rd_cus_orders_suffix}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
