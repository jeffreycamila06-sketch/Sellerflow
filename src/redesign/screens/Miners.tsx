// Screen 4 — Miners (leaderboard). v2 (2026-09): ACCURATE + seller tools.
// Data = the sql/42 miners_report RPC (public.orders LEDGER, server-side date
// range + top-N + repeat flag) via useMinersReport — NOT the drift-prone
// customers aggregate, so a DELETED order immediately drops out. Read-only.
// Controls (all additive, top of screen): date range (This session / Today /
// 7 days / This month / Custom) · Top-N (10/20/50/All) · Refresh · Export ▾
// (branded Excel/PDF, same module as Products/Orders). Repeat badge = 2+
// distinct Taipei order-days in the range (loyal-customer signal).
import { useEffect, useState, type CSSProperties } from "react";
import { avColor, initials, fmt } from "../data";
import {
  minersRangeBounds, MINERS_TOP_ALL, MINERS_TOP_OPTIONS,
  type MinersRange, type MinersTopN, type UseMinersReport,
} from "../adapters/minersReport";
import { exportBrandedXlsx, exportBrandedPdf, type ExportColumn } from "../adapters/brandedExport";
import { useT } from "../i18n";

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px" };
const statCard: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, padding: 14, boxShadow: "var(--shadow)" };
const statLbl: CSSProperties = { fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600 };
const bigNum: CSSProperties = { fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 25, color: "var(--text)", marginTop: 4, letterSpacing: "-.02em" };
const mono = "var(--font-mono)";
const hdrBtn: CSSProperties = { display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "6px 11px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" };

const RANGES: MinersRange[] = ["session", "today", "7days", "month", "custom"];

export default function Miners({ cur, rep, todayId = "", sessionStartId = "", seller }: {
  cur: string;
  rep: UseMinersReport;                 // owned by RedesignApp (useMinersReport)
  todayId?: string;                     // Taipei day id (today)
  sessionStartId?: string;              // current session window start (windowStart || today)
  seller?: { name?: string; email?: string };
}) {
  const t = useT();
  const [range, setRange] = useState<MinersRange>("session");
  const [topN, setTopN] = useState<MinersTopN>(10);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

  const rangeLabel = (r: MinersRange): string =>
    r === "session" ? t.rd_min_range_session : r === "today" ? t.rd_min_range_today
    : r === "7days" ? t.rd_min_range_7d : r === "month" ? t.rd_min_range_month : t.rd_min_range_custom;
  const topLabel = (n: MinersTopN): string => (n === MINERS_TOP_ALL ? t.rd_min_all : `${t.rd_min_top} ${n}`);

  // One RPC per (range × N) — server-side. Custom waits for BOTH dates. The
  // effect depends only on the range-affecting inputs (NOT rep.load, whose
  // identity changes as the cache fills) so it fires once per real change.
  const customReady = range !== "custom" || (!!customFrom && !!customTo);
  useEffect(() => {
    if (!customReady) return;
    const { start, end } = minersRangeBounds(range, todayId, sessionStartId, customFrom, customTo);
    rep.load(start, end, topN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, topN, customFrom, customTo, todayId, sessionStartId, customReady]);

  const data = rep.data;
  const loading = rep.state === "loading";
  const errored = rep.state === "error";
  const list = data?.top ?? [];

  // Branded export — the CURRENT range + selected N (full list, not 5).
  const buildExport = () => {
    const columns: ExportColumn[] = [
      { header: "#", width: 5, align: "right" },
      { header: t.rd_min_col_buyer, width: 22 },
      { header: t.rd_min_col_user, width: 18 },
      { header: t.rd_prd_platform, width: 12 },
      { header: t.rd_min_total_orders, width: 10, align: "right" },
      { header: t.rd_min_col_days, width: 12, align: "right" },
      { header: t.rd_min_repeat, width: 10 },
      { header: t.rd_min_total_spent, width: 14, align: "right" },
    ];
    const rows = list.map((m, i) => [
      i + 1, m.name, m.handle, m.platform, m.orders, m.activeDays,
      m.repeat ? t.rd_min_repeat : "", `${cur}${fmt(m.spent)}`,
    ]);
    const summary = [
      { label: t.rd_min_total_buyers, value: data ? fmt(data.buyers) : 0 },
      { label: t.rd_min_total_orders, value: data ? fmt(data.orders) : 0 },
      { label: t.rd_min_total_spent, value: `${cur}${data ? fmt(data.spent) : 0}` },
      { label: t.rd_min_avg_order, value: `${cur}${data ? fmt(data.avg) : 0}` },
    ];
    const bounds = minersRangeBounds(range, todayId, sessionStartId, customFrom, customTo);
    return { title: t.rd_min_title, seller, columns, rows, summary, filename: `sellerflow-miners-${bounds.start}_${bounds.end}` };
  };
  const doExportXlsx = () => { setExportOpen(false); void exportBrandedXlsx(buildExport()).catch(() => { /* export chunk failed */ }); };
  const doExportPdf = () => { setExportOpen(false); exportBrandedPdf(buildExport()); };
  const canExport = list.length > 0;

  const pill = (active: boolean): CSSProperties => ({
    flex: "0 0 auto", padding: "6px 10px", fontSize: 11.5, fontWeight: 700, border: "none", borderRadius: 9,
    cursor: "pointer", fontFamily: "var(--font-ui)", whiteSpace: "nowrap",
    background: active ? "#fff" : "rgba(255,255,255,.16)", color: active ? "var(--accent)" : "var(--on-header)",
  });

  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="sfl-anim-beat" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" }}>{t.rd_min_title}</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{t.rd_min_sub}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, position: "relative" }}>
            <button onClick={rep.reload} style={hdrBtn} title={t.rd_min_refresh} aria-label={t.rd_min_refresh}>↻ {t.rd_min_refresh}</button>
            <button onClick={() => setExportOpen((o) => !o)} disabled={!canExport} style={{ ...hdrBtn, opacity: canExport ? 1 : 0.5, cursor: canExport ? "pointer" : "default" }}>{t.rd_export} ▾</button>
            {exportOpen && canExport && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30, background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 11, boxShadow: "0 12px 30px rgba(9,7,24,.28)", overflow: "hidden", minWidth: 150 }}>
                <button onClick={doExportXlsx} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 13px", border: "none", background: "transparent", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t.rd_prd_export_excel}</button>
                <button onClick={doExportPdf} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 13px", border: "none", borderTop: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t.rd_prd_export_pdf}</button>
              </div>
            )}
          </div>
        </div>

        {/* Date-range pills */}
        <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto" }}>
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)} style={pill(range === r)}>{rangeLabel(r)}</button>
          ))}
        </div>
        {range === "custom" && (
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <label style={{ fontSize: 11, opacity: 0.85 }}>{t.rd_min_from}</label>
            <input type="date" value={customFrom} max={todayId || undefined} onChange={(e) => setCustomFrom(e.target.value)} style={{ fontSize: 12, padding: "4px 7px", borderRadius: 7, border: "none" }} />
            <label style={{ fontSize: 11, opacity: 0.85 }}>{t.rd_min_to}</label>
            <input type="date" value={customTo} max={todayId || undefined} onChange={(e) => setCustomTo(e.target.value)} style={{ fontSize: 12, padding: "4px 7px", borderRadius: 7, border: "none" }} />
          </div>
        )}
        {/* Top-N pills */}
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
          <span style={{ fontSize: 10.5, opacity: 0.75, marginRight: 2 }}>{t.rd_min_top}:</span>
          {MINERS_TOP_OPTIONS.map((n) => (
            <button key={n} onClick={() => setTopN(n)} style={pill(topN === n)}>{n === MINERS_TOP_ALL ? t.rd_min_all : n}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "14px 14px 22px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div style={statCard}>
            <div style={statLbl}>{t.rd_min_total_buyers}</div>
            <div style={bigNum}>{fmt(data?.buyers ?? 0)}</div>
          </div>
          <div style={statCard}>
            <div style={statLbl}>{t.rd_min_total_orders}</div>
            <div style={bigNum}>{fmt(data?.orders ?? 0)}</div>
          </div>
          <div style={statCard}>
            <div style={statLbl}>{t.rd_min_total_spent}</div>
            <div style={{ ...bigNum, fontSize: 22 }}>{cur}{fmt(data?.spent ?? 0)}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", marginTop: 3 }}>{cur}{fmt(data?.avg ?? 0)} {t.rd_min_avg_order}</div>
          </div>
          <div style={statCard}>
            <div style={statLbl}>{t.rd_min_platforms} <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>· {t.rd_min_alltime}</span></div>
            <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
              <div style={{ flex: 1, textAlign: "center", background: "var(--surface-2)", borderRadius: 9, padding: "7px 0" }}>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{data?.tiktokPct ?? 0}%</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>TikTok</div>
              </div>
              <div style={{ flex: 1, textAlign: "center", background: "var(--surface-2)", borderRadius: 9, padding: "7px 0" }}>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{data?.fbPct ?? 0}%</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>Facebook</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "4px 2px 10px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)" }}>{t.rd_min_top_buyers}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{rangeLabel(range)} · {topLabel(topN)}</div>
        </div>

        {loading && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>{t.rd_min_loading}</div>}
        {errored && !loading && <div style={{ fontSize: 13, color: "var(--danger)", textAlign: "center", padding: "16px 0" }}>{t.rd_min_error}</div>}
        {!loading && !errored && list.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>{t.rd_min_empty}</div>}

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "var(--shadow)", overflow: "hidden", display: !loading && !errored && list.length ? "block" : "none" }}>
          {list.map((m, i) => (
            <div key={`${m.name}|${m.handle}|${i}`} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: "var(--text-muted)", width: 20, textAlign: "right" }}>{i + 1}</div>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: avColor(m.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(m.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                  {m.repeat && (
                    <span title={t.rd_min_repeat_note} style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, letterSpacing: ".03em", color: "var(--accent-text)", background: "var(--accent)", padding: "2px 6px", borderRadius: 5 }}>★ {t.rd_min_repeat}</span>
                  )}
                </div>
                {m.handle && <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)" }}>{m.handle}</div>}
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
