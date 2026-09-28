// SALES TAB — real data (replaces Miners). Tiles (Sales total · Orders · Buyers ·
// AOV), a daily-trend CSS bar chart, and a searchable Top-buyers list, all from
// the sql/56 sales_report RPC for the selected range (Today · This session ·
// 7 days · 2 months · Custom; default = This session). Buyer tap → their orders
// in the Orders list. Export ▾ = the shared branded export. No new tables; one
// RPC per range switch, cached, zero poll.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { headerBar, headerTitle, card, mono } from "../ui";
import { useT } from "../i18n";
import { exportBrandedXlsx, exportBrandedPdf } from "../adapters/brandedExport";
import { dayStamp } from "../adapters/csv";
import type { SalesTabRange, UseSalesTab } from "../adapters/salesTab";

export default function SalesTab({ cur = "NT$", sessionStart = "", today = "", sales, seller, onOpenBuyer }: {
  cur?: string; sessionStart?: string; today?: string;
  sales: UseSalesTab;
  seller?: { name?: string; email?: string };
  onOpenBuyer?: (name: string) => void;
}) {
  const t = useT();
  const [range, setRange] = useState<SalesTabRange>("session");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [q, setQ] = useState("");

  const bounds = useMemo(() => ({ sessionStart, today, from: customFrom, to: customTo }), [sessionStart, today, customFrom, customTo]);
  // load on mount + whenever range / custom bounds change. The loader is kept in
  // a ref (updated in an effect, not during render) so the load effect never
  // depends on the callback's identity — sales.load changes as its cache fills,
  // which would otherwise re-fire and loop.
  const loadRef = useRef(sales.load);
  useEffect(() => { loadRef.current = sales.load; });
  useEffect(() => { loadRef.current(range, bounds); }, [range, bounds]);

  const d = sales.data;
  const fmt = (n: number) => Math.round(n).toLocaleString();
  const aov = d && d.orders ? Math.round(d.revenue / d.orders) : 0;
  const maxDay = Math.max(1, ...(d?.days.map((x) => x.rev) ?? [1]));
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = d?.topBuyers ?? [];
    return s ? list.filter((b) => (b.name || "").toLowerCase().includes(s)) : list;
  }, [d, q]);

  const RANGES: [SalesTabRange, string][] = [["today", t.rd_ord_today], ["session", t.rd_ord_range_session], ["7d", t.rd_ord_range_7d], ["2months", t.rd_sal_2months], ["custom", t.rd_ord_range_custom]];
  const pill = (active: boolean): CSSProperties => ({ padding: "7px 13px", borderRadius: 999, border: "1px solid " + (active ? "var(--accent)" : "var(--border)"), background: active ? "var(--accent)" : "var(--surface)", color: active ? "#fff" : "var(--text-dim)", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" });

  const doExport = (kind: "xlsx" | "pdf") => {
    setExportOpen(false);
    if (!d) return;
    const input = {
      title: `${t.rd_nav_sales} · ${d.start} → ${d.end}`,
      seller,
      columns: [
        { header: "#", align: "right" as const, width: 5 },
        { header: t.rd_sal_top_buyers, width: 26 },
        { header: t.rd_ord_sum_orders, align: "right" as const, width: 10 },
        { header: t.rd_ord_sum_total, align: "right" as const, width: 14 },
      ],
      rows: d.topBuyers.map((b, i) => [i + 1, b.name || "—", b.orders, `${cur}${fmt(b.spent)}`]),
      summary: [
        { label: t.rd_ord_sum_total, value: `${cur}${fmt(d.revenue)}` },
        { label: t.rd_ord_sum_orders, value: d.orders },
        { label: t.rd_ord_sum_buyers, value: d.buyers },
        { label: t.rd_ord_sum_aov, value: `${cur}${fmt(aov)}` },
      ],
      filename: `sales_${range}_${dayStamp()}`,
    };
    if (kind === "xlsx") void exportBrandedXlsx(input).catch(() => {});
    else exportBrandedPdf(input);
  };

  return (
    <div className="sfl-anim-screen" style={{ paddingBottom: 90 }}>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={headerTitle}>{t.rd_nav_sales}</div>
          <div style={{ position: "relative" }}>
            <button onClick={() => setExportOpen((v) => !v)} disabled={!d} data-testid="sales-export" style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.16)", border: "none", borderRadius: 10, padding: "8px 12px", color: "var(--on-header)", fontWeight: 700, fontSize: 12.5, cursor: d ? "pointer" : "default", opacity: d ? 1 : 0.5 }}>{t.rd_export} ▾</button>
            {exportOpen && d && (
              <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow)", overflow: "hidden", zIndex: 20, minWidth: 140 }}>
                <button onClick={() => doExport("xlsx")} data-testid="sales-export-xlsx" style={menuItem}>📊 {t.rd_prd_export_excel}</button>
                <button onClick={() => doExport("pdf")} data-testid="sales-export-pdf" style={menuItem}>📄 {t.rd_prd_export_pdf}</button>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, marginTop: 12, overflowX: "auto" }}>
          {RANGES.map(([r, label]) => (
            <button key={r} onClick={() => setRange(r)} data-testid={`sales-range-${r}`} style={pill(range === r)}>{label}</button>
          ))}
        </div>
        {range === "custom" && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <label style={{ flex: 1, fontSize: 11, color: "var(--on-header)", opacity: 0.9 }}>{t.rd_ord_range_from}<input type="date" value={customFrom} max={customTo || today} onChange={(e) => setCustomFrom(e.target.value)} data-testid="sales-custom-from" style={dateInput} /></label>
            <label style={{ flex: 1, fontSize: 11, color: "var(--on-header)", opacity: 0.9 }}>{t.rd_ord_range_to}<input type="date" value={customTo} min={customFrom} max={today} onChange={(e) => setCustomTo(e.target.value)} data-testid="sales-custom-to" style={dateInput} /></label>
          </div>
        )}
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {sales.state === "error" ? (
          <div style={{ ...card, textAlign: "center", color: "var(--danger)" }} data-testid="sales-error">{t.rd_sal_error}</div>
        ) : sales.state === "loading" || !d ? (
          <div style={{ ...card, textAlign: "center", color: "var(--text-muted)" }} data-testid="sales-loading">{t.rd_sal_loading}</div>
        ) : range === "custom" && (!customFrom || !customTo) ? (
          <div style={{ ...card, textAlign: "center", color: "var(--text-muted)" }} data-testid="sales-pickrange">{t.rd_sal_pick_range}</div>
        ) : (
          <>
            {/* Four tiles */}
            <div data-testid="sales-summary" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
              {[[t.rd_ord_sum_total, `${cur}${fmt(d.revenue)}`], [t.rd_ord_sum_orders, `${d.orders}`], [t.rd_ord_sum_buyers, `${d.buyers}`], [t.rd_ord_sum_aov, `${cur}${fmt(aov)}`]].map(([l, v], i) => (
                <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 9px", textAlign: "center", boxShadow: "var(--shadow)" }}>
                  <div style={{ fontFamily: mono, fontWeight: 800, fontSize: 15, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</div>
                  <div style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{l}</div>
                </div>
              ))}
            </div>

            {d.orders === 0 ? (
              <div style={{ ...card, textAlign: "center", color: "var(--text-muted)" }} data-testid="sales-empty">{t.rd_sal_empty}</div>
            ) : (
              <>
                {/* Daily trend */}
                <div style={card}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--text-muted)", marginBottom: 10 }}>{t.rd_sal_trend}</div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 92 }} data-testid="sales-trend">
                    {d.days.map((x) => (
                      <div key={x.d} title={`${x.d} · ${cur}${fmt(x.rev)} · ${x.orders}`} style={{ flex: 1, minWidth: 2, height: `${Math.max(4, Math.round((x.rev / maxDay) * 100))}%`, background: d.bestDay && x.d === d.bestDay.d ? "var(--ok)" : "var(--accent)", borderRadius: 3, opacity: d.bestDay && x.d === d.bestDay.d ? 1 : 0.75 }} />
                    ))}
                  </div>
                </div>

                {/* Top buyers */}
                <div style={card}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--text-muted)", marginBottom: 10 }}>{t.rd_sal_top_buyers}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-2)", borderRadius: 11, padding: "8px 12px", marginBottom: 10 }}>
                    <span style={{ fontSize: 13, opacity: 0.7 }}>🔍</span>
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.rd_sal_search} data-testid="sales-search" style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 13, color: "var(--text)" }} />
                  </div>
                  {shown.map((b, i) => (
                    <button key={`${b.name}-${i}`} onClick={() => onOpenBuyer?.(b.name)} data-testid={`sales-buyer-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 2px", borderTop: i ? "1px solid var(--border)" : "none", width: "100%", background: "none", cursor: "pointer", textAlign: "left" }}>
                      <div style={{ width: 20, fontFamily: mono, fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{i + 1}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name || "—"}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{b.orders} {t.rd_ord_sum_orders}</div>
                      </div>
                      <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{cur}{fmt(b.spent)}</div>
                    </button>
                  ))}
                  {shown.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 2px" }}>—</div>}
                </div>
              </>
            )}
          </>
        )}
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>{t.rd_sal_retention}</div>
      </div>
    </div>
  );
}

const menuItem: CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "none", border: "none", color: "var(--text)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const dateInput: CSSProperties = { display: "block", width: "100%", marginTop: 4, padding: "7px 9px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12.5 };
