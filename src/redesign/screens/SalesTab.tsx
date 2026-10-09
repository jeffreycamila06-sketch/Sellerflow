// SALES TAB — the approved mockup UI, wired to REAL data (useSalesTab → the sql/57
// sales_report RPC over the billing `orders` ledger). Same sections/order/labels as
// the mockup: header + Export ▾, date pills (Today · This session · 7 days · Custom,
// default Today), four tiles (Sales total · Orders · Buyers · AOV), a trend chart, and
// a searchable Top-buyers list → tap → in-screen buyer detail with "Open in Orders →".
// Honest loading/empty/error states. NO 2-months pill.
//
// PASS 2 (handles + trend):
//  A) @handle on buyer rows AND the buyer-detail header — resolved server-side via the
//     customers table (sql/57 LATERAL join); NEVER fabricated. A name with no handle
//     shows the name only, no layout jump (the right column always keeps 2 lines).
//     Row style matches Miners' top-buyer rows (rank · avatar · name/@handle · totals).
//  B) Trend chart — EVERY bar carries an order-count label (redesign tokens, no
//     hardcoded colors); bar height = sales amount; the best bar is highlighted the way
//     the mockup did (var(--ok)); tap a bar to reveal sales NT$ + orders. Today buckets
//     PER HOUR (d.trendUnit==="hour"), other ranges per day. Fixed-width columns in a
//     horizontally scrollable track (latest bar visible first) so up to 24 hourly bars
//     stay readable at 375/390px — text never shrinks below 10px.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { headerBar, headerTitle, card, mono } from "../ui";
import { useT } from "../i18n";
import { exportBrandedXlsx, exportBrandedPdf } from "../adapters/brandedExport";
import { dayStamp } from "../adapters/csv";
import type { SalesTabRange, UseSalesTab } from "../adapters/salesTab";
import type { SalesDay, SalesTopBuyer } from "../adapters/salesReport";
import { platformRange, platformRangeFor, platformRpcFor, type SalesPlatform, type UsePlatformSales } from "../adapters/salesByPlatform";
import { looksLikeFbId } from "../adapters/fbName";

const avColor = (s: string) => `hsl(${[...(s || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) * 47 % 360} 55% 48%)`;
const initials = (s: string) => (s || "?").replace(/^@/, "").slice(0, 2).toUpperCase();
const atHandle = (h: string) => (h ? (h.startsWith("@") ? h : `@${h}`) : "");

const COL_W = 34;         // per-bar column width (keeps labels ≥10px, no overlap)
const BAR_AREA = 84;      // px height of the bar zone (count label + axis label sit outside it)

// Axis tick under a bar: hour "14:00"→"14" (2 chars), day "2026-09-02"→"9/2".
const tickLabel = (d: string, hour: boolean): string => {
  if (hour) return d.slice(0, 2);
  const p = d.split("-");
  return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : d;
};
// Caption label when a bar is selected: hour keeps "14:00", day → "9/2".
const capLabel = (d: string, hour: boolean): string => (hour ? d : tickLabel(d, false));

export default function SalesTab({ cur = "NT$", sessionStart = "", today = "", sales, seller, onOpenBuyer, platformOptions = [], platformSales }: {
  cur?: string; sessionStart?: string; today?: string;
  sales: UseSalesTab;
  seller?: { name?: string; email?: string };
  onOpenBuyer?: (name: string) => void;
  // F1 (sales_platform_enabled + 2+ platforms): the per-platform choices. Empty = no
  // selector and the screen is exactly as before.
  platformOptions?: SalesPlatform[];
  platformSales?: UsePlatformSales;
}) {
  const t = useT();
  const [range, setRange] = useState<SalesTabRange>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [q, setQ] = useState("");
  const [openBuyer, setOpenBuyer] = useState<SalesTopBuyer | null>(null);
  const [selBar, setSelBar] = useState<SalesDay | null>(null);
  const [plat, setPlat] = useState<"all" | SalesPlatform>("all");
  const platOn = plat !== "all" && platformOptions.includes(plat) && !!platformSales;
  // New range/data → forget the tapped bar (its index no longer lines up). Reset during
  // render via the previous-value compare (the codebase's state-reset pattern; a reset
  // effect trips react-hooks/set-state-in-effect).
  const [barsRef, setBarsRef] = useState<unknown>(sales.data);
  if (barsRef !== sales.data) { setBarsRef(sales.data); setSelBar(null); }

  const bounds = useMemo(() => ({ sessionStart, today, from: customFrom, to: customTo }), [sessionStart, today, customFrom, customTo]);
  const loadRef = useRef(sales.load);
  useEffect(() => { loadRef.current = sales.load; });
  useEffect(() => { loadRef.current(range, bounds); }, [range, bounds]);
  // Per-platform view: Today / This session / 7 days (live_session_orders keeps 10 days) and
  // 2 months (orders ledger, sql/96–97). Any other range loads nothing — never "session".
  const platLoadRef = useRef(platformSales?.load);
  useEffect(() => { platLoadRef.current = platformSales?.load; });
  useEffect(() => {
    const pr = platformRangeFor(range);
    if (!platOn || !pr) return;
    const b = platformRange(pr, today, sessionStart);
    platLoadRef.current?.(plat as SalesPlatform, b.from, b.to, platformRpcFor(pr));
  }, [platOn, plat, range, today, sessionStart]);
  const pickPlat = (p: "all" | SalesPlatform) => {
    setPlat(p);
    if (p !== "all" && range === "custom") setRange("session");
    if (p === "all" && range === "2months") setRange("session"); // "All" shows no 2-months pill
  };

  // Keep the latest bar in view (hourly Today can be up to 24 bars → scroll).
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = trackRef.current; if (el) el.scrollLeft = el.scrollWidth; }, [sales.data, range]);

  const d = sales.data;
  const fmt = (n: number) => Math.round(n).toLocaleString();
  const aov = d && d.orders ? Math.round(d.revenue / d.orders) : 0;
  const hourly = d?.trendUnit === "hour";
  const maxRev = Math.max(1, ...(d?.days.map((x) => x.rev) ?? [1]));
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^@/, "");
    const list = d?.topBuyers ?? [];
    return s ? list.filter((b) => (b.name || "").toLowerCase().includes(s) || (b.handle || "").toLowerCase().includes(s)) : list;
  }, [d, q]);
  // Bar shown in the tap-caption: the tapped bar, else the best (highlighted) one.
  const capBar = selBar ?? d?.bestDay ?? null;

  const RANGES: [SalesTabRange, string][] = [["today", t.rd_ord_today], ["session", t.rd_ord_range_session], ["7d", t.rd_ord_range_7d], ["custom", t.rd_ord_range_custom]];
  const shownRanges: [SalesTabRange, string][] = platOn ? [...RANGES.filter(([r]) => r !== "custom"), ["2months", t.rd_sal_2months]] : RANGES;
  const pill = (active: boolean): CSSProperties => ({ padding: "7px 13px", borderRadius: 999, border: "1px solid " + (active ? "var(--accent)" : "var(--border)"), background: active ? "var(--accent)" : "var(--surface)", color: active ? "#fff" : "var(--text-dim)", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" });

  const doExport = (kind: "xlsx" | "pdf") => {
    setExportOpen(false);
    if (!d) return;
    const input = {
      title: `${t.rd_nav_sales} · ${d.start} → ${d.end}`, seller,
      columns: [
        { header: "#", align: "right" as const, width: 5 },
        { header: t.rd_sal_top_buyers, width: 26 },
        { header: t.rd_ord_sum_orders, align: "right" as const, width: 10 },
        { header: t.rd_ord_sum_total, align: "right" as const, width: 14 },
      ],
      rows: d.topBuyers.map((b, i) => [i + 1, b.handle && !looksLikeFbId(b.handle) ? `${b.name || "—"} (${atHandle(b.handle)})` : (b.name || "—"), b.orders, `${cur}${fmt(b.spent)}`]),
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
            <button onClick={() => setExportOpen((v) => !v)} disabled={!d || platOn} data-testid="sales-export" style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.16)", border: "none", borderRadius: 10, padding: "8px 12px", color: "var(--on-header)", fontWeight: 700, fontSize: 12.5, cursor: d ? "pointer" : "default", opacity: d ? 1 : 0.5 }}>{t.rd_export} ▾</button>
            {exportOpen && d && (
              <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow)", overflow: "hidden", zIndex: 20, minWidth: 140 }}>
                <button onClick={() => doExport("xlsx")} data-testid="sales-export-xlsx" style={menuItem}>📊 {t.rd_prd_export_excel}</button>
                <button onClick={() => doExport("pdf")} data-testid="sales-export-pdf" style={menuItem}>📄 {t.rd_prd_export_pdf}</button>
              </div>
            )}
          </div>
        </div>
        {/* Date pills: Today · This session · 7 days · Custom */}
        <div style={{ display: "flex", gap: 7, marginTop: 12, overflowX: "auto" }}>
          {shownRanges.map(([r, label]) => (
            <button key={r} onClick={() => setRange(r)} data-testid={`sales-range-${r}`} style={pill(range === r)}>{label}</button>
          ))}
        </div>
        {platformOptions.length > 0 && platformSales && (
          <div style={{ display: "flex", gap: 7, marginTop: 8, overflowX: "auto" }} data-testid="sales-platforms">
            {(["all", ...platformOptions] as ("all" | SalesPlatform)[]).map((p) => (
              <button key={p} onClick={() => pickPlat(p)} data-testid={`sales-plat-${p}`} style={pill(plat === p)}>{p === "all" ? t.rd_sal_plat_all : p}</button>
            ))}
          </div>
        )}
        {platOn && (range === "2months"
          ? <div style={{ fontSize: 11, color: "var(--on-header)", opacity: 0.85, marginTop: 6 }} data-testid="sales-plat-note-2m">{t.rd_sal_plat_note_2m}</div>
          : <div style={{ fontSize: 11, color: "var(--on-header)", opacity: 0.85, marginTop: 6 }} data-testid="sales-plat-note">{t.rd_sal_plat_note}</div>)}
        {range === "custom" && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <label style={{ flex: 1, fontSize: 11, color: "var(--on-header)", opacity: 0.9 }}>{t.rd_ord_range_from}<input type="date" value={customFrom} max={customTo || today} onChange={(e) => setCustomFrom(e.target.value)} data-testid="sales-custom-from" style={dateInput} /></label>
            <label style={{ flex: 1, fontSize: 11, color: "var(--on-header)", opacity: 0.9 }}>{t.rd_ord_range_to}<input type="date" value={customTo} min={customFrom} max={today} onChange={(e) => setCustomTo(e.target.value)} data-testid="sales-custom-to" style={dateInput} /></label>
          </div>
        )}
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {platOn && platformSales ? (
          <PlatformView data={platformSales.data} state={platformSales.state} cur={cur} />
        ) : sales.state === "error" ? (
          <div style={{ ...card, textAlign: "center", color: "var(--danger)" }} data-testid="sales-error">{t.rd_sal_error}</div>
        ) : sales.state === "loading" || !d ? (
          <div style={{ ...card, textAlign: "center", color: "var(--text-muted)" }} data-testid="sales-loading">{t.rd_sal_loading}</div>
        ) : range === "custom" && (!customFrom || !customTo) ? (
          <div style={{ ...card, textAlign: "center", color: "var(--text-muted)" }} data-testid="sales-pickrange">{t.rd_sal_pick_range}</div>
        ) : (
          <>
            {/* Four summary tiles: Sales total · Orders · Buyers · AOV */}
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
                {/* Trend: fixed-width bars in a scrollable track; every bar carries an
                    order-count label; best bar highlighted; tap reveals sales + orders. */}
                <div style={card}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--text-muted)" }}>{hourly ? t.rd_sal_trend_hourly : t.rd_sal_trend}</div>
                    {capBar && (
                      <div data-testid="sales-trend-caption" style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        <span style={{ fontWeight: 700 }}>{capLabel(capBar.d, hourly)}</span>
                        {" · "}<span style={{ fontFamily: mono, color: "var(--text)" }}>{cur}{fmt(capBar.rev)}</span>
                        {" · "}<span style={{ fontFamily: mono }}>{capBar.orders} {t.rd_ord_sum_orders}</span>
                      </div>
                    )}
                  </div>
                  <div ref={trackRef} style={{ display: "flex", alignItems: "flex-end", gap: 4, overflowX: "auto", paddingBottom: 2 }} data-testid="sales-trend">
                    {d.days.map((x) => {
                      const best = !!d.bestDay && x.d === d.bestDay.d;
                      const active = !!selBar && x.d === selBar.d;
                      return (
                        <button
                          key={x.d}
                          onClick={() => setSelBar((s) => (s && s.d === x.d ? null : x))}
                          title={`${capLabel(x.d, hourly)} · ${cur}${fmt(x.rev)} · ${x.orders} ${t.rd_ord_sum_orders}`}
                          style={{ flex: `0 0 ${COL_W}px`, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                        >
                          <div style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: active ? "var(--accent)" : "var(--text-muted)", lineHeight: 1 }}>{x.orders}</div>
                          <div style={{ height: BAR_AREA, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                            <div style={{ width: "78%", height: `${Math.max(4, Math.round((x.rev / maxRev) * 100))}%`, background: best ? "var(--ok)" : "var(--accent)", borderRadius: 4, opacity: active || best ? 1 : 0.72, outline: active ? "2px solid var(--accent)" : "none", outlineOffset: 1 }} />
                          </div>
                          <div style={{ fontSize: 9.5, color: "var(--text-muted)", lineHeight: 1, whiteSpace: "nowrap" }}>{tickLabel(x.d, hourly)}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Top buyers (absorbs Miners) — search + list; tap → buyer detail.
                    Row style mirrors Miners: rank · avatar · name/@handle · totals right. */}
                {openBuyer ? (
                  <div style={card} data-testid="sales-buyer-detail">
                    <button onClick={() => setOpenBuyer(null)} data-testid="sales-buyer-back" style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0, marginBottom: 8 }}>← {t.rd_sal_back}</button>
                    <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 999, background: avColor(openBuyer.name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{initials(openBuyer.name)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 15, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{openBuyer.name || "—"}</div>
                        {openBuyer.handle && !looksLikeFbId(openBuyer.handle) && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--handle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{atHandle(openBuyer.handle)}</div>}
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 1 }}>{openBuyer.orders} {t.rd_ord_sum_orders} · {cur}{fmt(openBuyer.spent)}</div>
                      </div>
                    </div>
                    <button onClick={() => onOpenBuyer?.(openBuyer.name)} style={{ marginTop: 4, width: "100%", padding: "10px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text-dim)", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }} data-testid="sales-open-orders">{t.rd_sal_buyer_hist} →</button>
                  </div>
                ) : (
                  <div style={card}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--text-muted)" }}>{t.rd_sal_top_buyers}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-2)", borderRadius: 11, padding: "8px 12px", marginBottom: 10 }}>
                      <span style={{ fontSize: 13, opacity: 0.7 }}>🔍</span>
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.rd_sal_search} data-testid="sales-search" style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 13, color: "var(--text)" }} />
                    </div>
                    {shown.map((b, i) => (
                      <button key={`${b.name}-${i}`} onClick={() => setOpenBuyer(b)} data-testid={`sales-buyer-${i}`} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 2px", borderTop: i ? "1px solid var(--border)" : "none", width: "100%", background: "none", cursor: "pointer", textAlign: "left" }}>
                        <div style={{ width: 20, fontFamily: mono, fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textAlign: "right", flexShrink: 0 }}>{i + 1}</div>
                        <div style={{ width: 34, height: 34, borderRadius: 999, background: avColor(b.name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, flexShrink: 0 }}>{initials(b.name)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name || "—"}</div>
                          {b.handle && !looksLikeFbId(b.handle) && <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{atHandle(b.handle)}</div>}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{cur}{fmt(b.spent)}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{b.orders} {t.rd_ord_sum_orders}</div>
                        </div>
                      </button>
                    ))}
                    {shown.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 2px" }}>—</div>}
                  </div>
                )}
              </>
            )}
          </>
        )}
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>{t.rd_sal_retention}</div>
      </div>
    </div>
  );
}

// Per-platform view (F1): totals, orders per day, best sellers (by Auto code, else by price).
function PlatformView({ data, state, cur }: { data: UsePlatformSales["data"]; state: UsePlatformSales["state"]; cur: string }) {
  const t = useT();
  const fmt = (n: number) => Math.round(n).toLocaleString();
  if (state === "error") return <div style={{ ...card, textAlign: "center", color: "var(--danger)" }} data-testid="sales-plat-error">{t.rd_sal_error}</div>;
  if (state === "loading" || state === "idle" || !data) return <div style={{ ...card, textAlign: "center", color: "var(--text-muted)" }} data-testid="sales-plat-loading">{t.rd_sal_loading}</div>;
  if (data.orders === 0) return <div style={{ ...card, textAlign: "center", color: "var(--text-muted)" }} data-testid="sales-plat-empty">{t.rd_sal_empty}</div>;
  const maxO = Math.max(1, ...data.days.map((x) => x.orders));
  return (
    <>
      <div data-testid="sales-plat-summary" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[[t.rd_ord_sum_total, `${cur}${fmt(data.revenue)}`], [t.rd_ord_sum_orders, `${data.orders}`], [t.rd_ord_sum_buyers, `${data.buyers}`]].map(([l, v], i) => (
          <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 9px", textAlign: "center", boxShadow: "var(--shadow)" }}>
            <div style={{ fontFamily: mono, fontWeight: 800, fontSize: 15, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</div>
            <div style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={card}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--text-muted)", marginBottom: 10 }}>{t.rd_sal_trend}</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, overflowX: "auto" }} data-testid="sales-plat-days">
          {data.days.map((x) => (
            <div key={x.d} style={{ flex: `0 0 ${COL_W}px`, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: "var(--text-muted)", lineHeight: 1 }}>{x.orders}</div>
              <div style={{ height: BAR_AREA, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                <div style={{ width: "78%", height: `${Math.max(4, Math.round((x.orders / maxO) * 100))}%`, background: "var(--accent)", borderRadius: 4, opacity: 0.8 }} />
              </div>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", lineHeight: 1, whiteSpace: "nowrap" }}>{tickLabel(x.d, false)}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={card} data-testid="sales-plat-best">
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--text-muted)", marginBottom: 6 }}>{t.rd_sal_best_sellers}</div>
        {data.best.map((b, i) => (
          <div key={`${b.kind}-${b.label}`} data-testid={`sales-plat-best-${i}`} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 2px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <div style={{ width: 20, fontFamily: mono, fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textAlign: "right" }}>{i + 1}</div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.kind === "price" ? `${cur}${b.label}` : b.label}</div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{b.qty} {t.rd_sal_pcs}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{cur}{fmt(b.rev)}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

const menuItem: CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "none", border: "none", color: "var(--text)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const dateInput: CSSProperties = { display: "block", width: "100%", marginTop: 4, padding: "7px 9px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12.5 };
