// Screen 12 — Sales Report. TWO layers:
//  • "Today" = the ORIGINAL session-derived aggregation (computeSales over the
//    current live session) — UNTOUCHED, same cards/i18n/export as before.
//  • 7 Days / This Month / Last Month = Sales Report v2 (2026-07-05):
//    HISTORICAL view from the billing `orders` ledger via the sql/15
//    sales_report(period) RPC (Taipei-bucketed server-side). One RPC per
//    period switch, cached per period — zero poll. KPI deltas vs the
//    equivalent previous period, revenue-per-day bars, top-5 products/buyers
//    (period-scoped, NOT lifetime), best day + repeat-buyer %.
import type { CSSProperties } from "react";
import { useState } from "react";
import { headerBar, headerTitle, card, mono } from "../ui";
import { fmt } from "../data";
import type { SalesSummary } from "../adapters/sales";
import type { UseSalesReport, SalesPeriod } from "../adapters/salesReport";
import type { UsePeakHours } from "../adapters/peakHours";
import PeakHours from "../components/PeakHours";
import { useT, tpl } from "../i18n";

type ViewPeriod = "today" | SalesPeriod;

const kpiCard: CSSProperties = { ...card, borderRadius: 15, padding: 14 };
const kpiLbl: CSSProperties = { fontSize: 11, color: "var(--text-muted)", fontWeight: 600 };
const kpiNum: CSSProperties = { fontFamily: mono, fontWeight: 700, fontSize: 22, marginTop: 4, letterSpacing: "-.02em" };

// Green ▲ / red ▼ vs the equivalent previous period; "—" when no base (prev=0).
function DeltaChip({ d }: { d: number | null }) {
  const t = useT();
  if (d === null) return <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)" }}>— {t.rd_sr2_vs_prev}</span>;
  const up = d >= 0;
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, color: up ? "var(--ok)" : "var(--danger)" }}>
      {up ? "▲" : "▼"} {Math.abs(d)}% <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>{t.rd_sr2_vs_prev}</span>
    </span>
  );
}

function HistView({ cur, hist }: { cur: string; hist: UseSalesReport }) {
  const t = useT();
  const d = hist.data;
  if (hist.state === "loading" || (hist.state === "live" && !d)) {
    return <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "26px 0" }}>{t.rd_sr2_loading}</div>;
  }
  if (hist.state === "error") {
    return <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "26px 0" }}>{t.rd_sr2_error}</div>;
  }
  if (!d || d.orders === 0) {
    return <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "26px 0" }}>{t.rd_sr2_empty}</div>;
  }
  const maxDay = Math.max(1, ...d.days.map((x) => x.rev));
  const maxProd = Math.max(1, ...d.topProducts.map((x) => x.rev));
  return (
    <>
      {/* 4 KPI cards with deltas vs the equivalent previous period */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        <div style={kpiCard}>
          <div style={kpiLbl}>{t.rd_sal_revenue}</div>
          <div style={{ ...kpiNum, color: "var(--ok)" }}>{cur}{fmt(d.revenue)}</div>
          <div style={{ marginTop: 3 }}><DeltaChip d={d.dRevenue} /></div>
        </div>
        <div style={kpiCard}>
          <div style={kpiLbl}>{t.rd_ord_title}</div>
          <div style={{ ...kpiNum, color: "var(--text)" }}>{d.orders}</div>
          <div style={{ marginTop: 3 }}><DeltaChip d={d.dOrders} /></div>
        </div>
        <div style={kpiCard}>
          <div style={kpiLbl}>{t.rd_sr2_buyers}</div>
          <div style={{ ...kpiNum, color: "var(--accent-fg)" }}>{d.buyers}</div>
          <div style={{ marginTop: 3 }}><DeltaChip d={d.dBuyers} /></div>
        </div>
        <div style={kpiCard}>
          <div style={kpiLbl}>{t.rd_sr2_aov}</div>
          <div style={{ ...kpiNum, color: "var(--text)" }}>{cur}{fmt(d.aov)}</div>
          <div style={{ marginTop: 3 }}><DeltaChip d={d.dAov} /></div>
        </div>
      </div>

      {/* Revenue per Taipei day — bar chart */}
      <div style={{ ...card, padding: "16px 14px", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>{t.rd_sr2_rev_per_day}</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 86 }}>
          {d.days.map((x) => (
            <div key={x.d} title={`${x.d} · ${cur}${fmt(x.rev)} · ${x.orders}`} style={{ flex: 1, minWidth: 2, height: `${Math.max(4, Math.round((x.rev / maxDay) * 100))}%`, background: x.d === d.bestDay?.d ? "var(--ok)" : "var(--accent)", borderRadius: 3, opacity: x.d === d.bestDay?.d ? 1 : 0.75 }} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10.5, color: "var(--text-muted)", fontFamily: mono }}>
          <span>{d.days[0]?.d.slice(5)}</span>
          <span>{d.days[d.days.length - 1]?.d.slice(5)}</span>
        </div>
      </div>

      {/* Best day + repeat buyers row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        <div style={kpiCard}>
          <div style={kpiLbl}>{t.rd_sr2_best_day}</div>
          <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: "var(--text)", marginTop: 4 }}>{d.bestDay?.d ?? "—"}</div>
          {d.bestDay && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ok)", marginTop: 3 }}>{cur}{fmt(d.bestDay.rev)}</div>}
        </div>
        <div style={kpiCard}>
          <div style={kpiLbl}>{t.rd_sr2_repeat}</div>
          <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: "var(--accent-fg)", marginTop: 4 }}>{d.repeatPct === null ? "—" : `${d.repeatPct}%`}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>{tpl(t.rd_sr2_of_buyers, { n: d.buyers })}</div>
        </div>
      </div>

      {/* Top 5 products by revenue (period-scoped) */}
      <div style={{ ...card, padding: "16px 14px", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>{t.rd_sal_top_products}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {d.topProducts.map((tp) => (
            <div key={tp.name}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tp.name || "—"}</span>
                <span style={{ flexShrink: 0, fontSize: 11.5, color: "var(--text-muted)" }}>{tp.orders} {t.rd_cus_orders_suffix} · <span style={{ fontFamily: mono, fontWeight: 700, color: "var(--ok)" }}>{cur}{fmt(tp.rev)}</span></span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.round((tp.rev / maxProd) * 100)}%`, background: "var(--accent)", borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top 5 buyers by spend (period-scoped, NOT lifetime) */}
      <div style={{ ...card, padding: "16px 14px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 11 }}>{t.rd_sr2_top_buyers}</div>
        {d.topBuyers.map((b, i) => (
          <div key={`${b.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < d.topBuyers.length - 1 ? "1px solid var(--border)" : "none" }}>
            <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", width: 16 }}>{i + 1}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name || "—"}</span>
            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{b.orders} {t.rd_cus_orders_suffix}</span>
            <span style={{ fontFamily: mono, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{cur}{fmt(b.spent)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function SalesReport({ cur, sales, onExport, hist, peak, enabled = true }: {
  cur: string;
  sales: SalesSummary;
  onExport?: () => void;
  hist: UseSalesReport;
  peak: UsePeakHours;
  enabled?: boolean;
}) {
  const t = useT();
  const [period, setPeriod] = useState<ViewPeriod>("today");
  const pick = (p: ViewPeriod) => {
    setPeriod(p);
    if (p !== "today") { hist.load(p); peak.load(); }
  };
  const maxRev = Math.max(1, ...sales.top.map((tp) => tp.rev));
  const pills: { key: ViewPeriod; label: string }[] = [
    { key: "today", label: t.rd_sr2_today },
    { key: "7d", label: t.rd_sr2_7d },
    { key: "month", label: t.rd_sr2_month },
    { key: "last_month", label: t.rd_sr2_last_month },
  ];
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="sfl-anim-beat" style={headerTitle}>{t.rd_sal_title}</div>
          {period === "today" && onExport && sales.orders > 0 && <button onClick={onExport} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "6px 11px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_export}</button>}
        </div>
        {/* Period pills: Today = session view (original); the rest = ledger history */}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {pills.map((p) => (
            <button key={p.key} onClick={() => pick(p.key)} style={{ flex: 1, padding: "6px 4px", fontSize: 11.5, fontWeight: 700, border: "none", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)", background: period === p.key ? "#fff" : "rgba(255,255,255,.16)", color: period === p.key ? "var(--accent)" : "var(--on-header)" }}>
              {p.label}
            </button>
          ))}
        </div>
        {period === "today" && <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 8 }}>{t.rd_sal_this_session}</div>}
        {period !== "today" && hist.data && hist.state !== "loading" && (
          <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 8, fontFamily: "var(--font-mono)" }}>{hist.data.start} → {hist.data.end}</div>
        )}
      </div>
      <div style={{ padding: "16px 14px 22px" }}>
        {period !== "today" && <><HistView cur={cur} hist={hist} /><PeakHours cur={cur} enabled={enabled} peak={peak} /></>}
        {period === "today" && (
          <>
            {sales.orders === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>{t.rd_sal_empty}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <div style={{ ...card, borderRadius: 15, padding: 14 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{t.rd_sal_revenue}</div>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 22, color: "var(--ok)", marginTop: 4, letterSpacing: "-.02em" }}>{cur}{fmt(sales.total)}</div>
              </div>
              <div style={{ ...card, borderRadius: 15, padding: 14 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{t.rd_ord_title}</div>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 22, color: "var(--text)", marginTop: 4, letterSpacing: "-.02em" }}>{sales.orders}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", marginTop: 3 }}>{cur}{fmt(sales.avg)} {t.rd_sal_avg}</div>
              </div>
              <div style={{ ...card, borderRadius: 15, padding: 14 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{t.rd_sal_buyers}</div>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 22, color: "var(--accent-fg)", marginTop: 4, letterSpacing: "-.02em" }}>{sales.buyers}</div>
              </div>
              <div style={{ ...card, borderRadius: 15, padding: 14 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{t.rd_sal_avg_order}</div>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 22, color: "var(--text)", marginTop: 4, letterSpacing: "-.02em" }}>{cur}{fmt(sales.avg)}</div>
              </div>
            </div>

            <div style={{ ...card, padding: "16px 14px", marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>{t.rd_sal_top_products}</div>
              {sales.top.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t.rd_sal_no_sales}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {sales.top.map((tp) => (
                  <div key={tp.item}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tp.item}</span>
                      <span style={{ flexShrink: 0, fontSize: 11.5, color: "var(--text-muted)" }}>{tp.qty} {t.rd_sal_sold} · <span style={{ fontFamily: mono, fontWeight: 700, color: "var(--ok)" }}>{cur}{fmt(tp.rev)}</span></span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.round((tp.rev / maxRev) * 100)}%`, background: "var(--accent)", borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 11 }}>{t.rd_sal_rev_platform}</div>
              {([["TikTok", sales.tiktok], ["Facebook", sales.facebook]] as const).map(([name, p]) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderBottom: name === "TikTok" ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", width: 76 }}>{name}</span>
                  <span style={{ flex: 1, fontSize: 11.5, color: "var(--text-muted)" }}>{p.count} {t.rd_cus_orders_suffix}</span>
                  <span style={{ fontFamily: mono, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{cur}{fmt(p.rev)}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent-fg)", width: 42, textAlign: "right" }}>{p.share}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
