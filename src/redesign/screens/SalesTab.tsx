// SALES TAB — clickable MOCKUP (static data, no queries, no DB). Reuses the
// existing design tokens (ui.ts) + the visual patterns from Orders (summary
// tiles, search, list rows, Export ▾) and SalesReport (period pills, CSS bar
// chart, top lists). This "new Sales tab" is intended to replace Miners in the
// bottom nav; Miners stays behind a flag in RedesignApp (no deletion).
// Everything below is FAKE for tap-through review — wire to real adapters later.
import { useMemo, useState, type CSSProperties } from "react";
import { headerBar, headerTitle, card, mono } from "../ui";
import { useT } from "../i18n";

type Range = "today" | "session" | "7days" | "custom";
type Buyer = { handle: string; name: string; orders: number; total: number };
type Row = { id: string; product: string; qty: number; total: number; when: string; platform: string };

// ── static mock data, one shape per range so the pills feel alive ───────────
const MOCK: Record<Range, { total: number; orders: number; buyers: number; aov: number; days: { d: string; rev: number }[]; buyersList: Buyer[] }> = {
  today:   { total: 8420,  orders: 24,  buyers: 19,  aov: 351, days: bars([320, 540, 410, 880, 1260, 990, 1470, 1310, 900, 340]), buyersList: buyers(6) },
  session: { total: 15960, orders: 47,  buyers: 33,  aov: 340, days: bars([700, 1200, 900, 1600, 2100, 1800, 2400, 2000, 1600, 1660]), buyersList: buyers(8) },
  "7days": { total: 61240, orders: 188, buyers: 121, aov: 326, days: bars([6100, 8400, 5200, 9800, 11200, 7600, 12940]), buyersList: buyers(10) },
  custom:  { total: 24880, orders: 74,  buyers: 52,  aov: 336, days: bars([3200, 4100, 2800, 5200, 4600, 4980]), buyersList: buyers(9) },
};
function bars(rev: number[]) { return rev.map((r, i) => ({ d: `D${i + 1}`, rev: r })); }
function buyers(n: number): Buyer[] {
  const base: Buyer[] = [
    { handle: "@maria_shops", name: "Maria Santos", orders: 14, total: 5820 },
    { handle: "@jcdelacruz", name: "JC Dela Cruz", orders: 11, total: 4310 },
    { handle: "@anne.tw", name: "Anne Lim", orders: 9, total: 3990 },
    { handle: "@budgetukay", name: "Rowena G.", orders: 8, total: 3120 },
    { handle: "@kaykaystore", name: "Kay Reyes", orders: 7, total: 2760 },
    { handle: "@shoppista", name: "Divine P.", orders: 6, total: 2210 },
    { handle: "@tindahannijuan", name: "Juan M.", orders: 5, total: 1980 },
    { handle: "@glowbyliz", name: "Liz Tan", orders: 4, total: 1540 },
    { handle: "@thriftmnl", name: "Bea C.", orders: 4, total: 1330 },
    { handle: "@packngo", name: "Ron V.", orders: 3, total: 980 },
  ];
  return base.slice(0, n);
}
const BUYER_ORDERS: Row[] = [
  { id: "#14", product: "Uniqlo Airism Tee ×2", total: 640, when: "14:22", platform: "TikTok" },
  { id: "#9", product: "Skechers GoWalk", qty: 1, total: 1290, when: "13:58", platform: "TikTok" },
  { id: "#6", product: "Muji Pen Set ×3", qty: 3, total: 450, when: "13:10", platform: "Facebook" },
  { id: "#3", product: "Corelle Bowl", qty: 1, total: 520, when: "12:41", platform: "TikTok" },
].map((r) => ({ qty: 1, ...r }));

const avColor = (s: string) => `hsl(${[...s].reduce((a, c) => a + c.charCodeAt(0), 0) * 47 % 360} 55% 48%)`;
const initials = (s: string) => s.replace(/^@/, "").slice(0, 2).toUpperCase();

export default function SalesTab({ cur = "NT$", onOpenOrders }: { cur?: string; onOpenOrders?: () => void }) {
  const t = useT();
  const [range, setRange] = useState<Range>("today");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [q, setQ] = useState("");
  const [openBuyer, setOpenBuyer] = useState<Buyer | null>(null);
  const [exported, setExported] = useState("");

  const m = MOCK[range];
  const maxDay = Math.max(1, ...m.days.map((x) => x.rev));
  const fmt = (n: number) => n.toLocaleString();
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? m.buyersList.filter((b) => (b.handle + " " + b.name).toLowerCase().includes(s)) : m.buyersList;
  }, [m.buyersList, q]);

  const RANGES: [Range, string][] = [["today", t.rd_ord_today], ["session", t.rd_ord_range_session], ["7days", t.rd_ord_range_7d], ["custom", t.rd_ord_range_custom]];
  const pill = (active: boolean): CSSProperties => ({ padding: "7px 13px", borderRadius: 999, border: "1px solid " + (active ? "var(--accent)" : "var(--border)"), background: active ? "var(--accent)" : "var(--surface)", color: active ? "#fff" : "var(--text-dim)", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" });
  const doExport = (kind: string) => { setExportOpen(false); setExported(kind); setTimeout(() => setExported(""), 1800); };

  return (
    <div className="sfl-anim-screen" style={{ paddingBottom: 90 }}>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={headerTitle}>{t.rd_nav_sales}</div>
          <div style={{ position: "relative" }}>
            <button onClick={() => setExportOpen((v) => !v)} data-testid="sales-export" style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.16)", border: "none", borderRadius: 10, padding: "8px 12px", color: "var(--on-header)", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>{t.rd_export} ▾</button>
            {exportOpen && (
              <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow)", overflow: "hidden", zIndex: 20, minWidth: 140 }}>
                <button onClick={() => doExport(t.rd_prd_export_excel)} data-testid="sales-export-xlsx" style={menuItem}>📊 {t.rd_prd_export_excel}</button>
                <button onClick={() => doExport(t.rd_prd_export_pdf)} data-testid="sales-export-pdf" style={menuItem}>📄 {t.rd_prd_export_pdf}</button>
              </div>
            )}
          </div>
        </div>
        {/* Date pills: Today · This session · 7 days · Custom */}
        <div style={{ display: "flex", gap: 7, marginTop: 12, overflowX: "auto" }}>
          {RANGES.map(([r, label]) => (
            <button key={r} onClick={() => { setRange(r); setRangeOpen(r === "custom"); }} data-testid={`sales-range-${r}`} style={pill(range === r)}>{label}</button>
          ))}
        </div>
        {range === "custom" && rangeOpen && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <label style={{ flex: 1, fontSize: 11, color: "var(--on-header)", opacity: 0.9 }}>{t.rd_ord_range_from}<input type="date" style={dateInput} /></label>
            <label style={{ flex: 1, fontSize: 11, color: "var(--on-header)", opacity: 0.9 }}>{t.rd_ord_range_to}<input type="date" style={dateInput} /></label>
          </div>
        )}
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Four summary tiles: Sales total · Orders · Buyers · AOV */}
        <div data-testid="sales-summary" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {[[t.rd_ord_sum_total, `${cur}${fmt(m.total)}`], [t.rd_ord_sum_orders, `${m.orders}`], [t.rd_ord_sum_buyers, `${m.buyers}`], [t.rd_ord_sum_aov, `${cur}${fmt(m.aov)}`]].map(([l, v], i) => (
            <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 9px", textAlign: "center", boxShadow: "var(--shadow)" }}>
              <div style={{ fontFamily: mono, fontWeight: 800, fontSize: 15, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</div>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>

        {/* Daily trend bar chart (CSS bars, matching SalesReport) */}
        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--text-muted)", marginBottom: 10 }}>{t.rd_sal_trend}</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 92 }} data-testid="sales-trend">
            {m.days.map((x) => (
              <div key={x.d} title={`${x.d} · ${cur}${fmt(x.rev)}`} style={{ flex: 1, minWidth: 2, height: `${Math.max(4, Math.round((x.rev / maxDay) * 100))}%`, background: x.rev === maxDay ? "var(--ok)" : "var(--accent)", borderRadius: 3, opacity: x.rev === maxDay ? 1 : 0.75 }} />
            ))}
          </div>
        </div>

        {/* Top buyers (absorbs Miners) — search + list; tap a buyer → order history */}
        {openBuyer ? (
          <div style={card} data-testid="sales-buyer-detail">
            <button onClick={() => setOpenBuyer(null)} data-testid="sales-buyer-back" style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0, marginBottom: 8 }}>← {t.rd_sal_back}</button>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: 999, background: avColor(openBuyer.handle), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12 }}>{initials(openBuyer.handle)}</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "var(--text)" }}>{openBuyer.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--handle)" }}>{openBuyer.handle} · {openBuyer.orders} {t.rd_ord_sum_orders} · {cur}{fmt(openBuyer.total)}</div>
              </div>
            </div>
            {BUYER_ORDERS.map((o) => (
              <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 2px", borderTop: "1px solid var(--border)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.product}</div>
                  <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{o.platform} · {o.when}</div>
                </div>
                <div style={{ fontFamily: mono, fontSize: 11, color: "var(--text-dim)" }}>{o.id}</div>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{cur}{fmt(o.total)}</div>
              </div>
            ))}
            {onOpenOrders && <button onClick={onOpenOrders} style={{ marginTop: 12, width: "100%", padding: "10px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text-dim)", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }} data-testid="sales-open-orders">{t.rd_sal_buyer_hist} →</button>}
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
              <button key={b.handle} onClick={() => setOpenBuyer(b)} data-testid={`sales-buyer-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 2px", borderTop: i ? "1px solid var(--border)" : "none", width: "100%", background: "none", cursor: "pointer", textAlign: "left" }}>
                <div style={{ width: 20, fontFamily: mono, fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{i + 1}</div>
                <div style={{ width: 30, height: 30, borderRadius: 999, background: avColor(b.handle), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11 }}>{initials(b.handle)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: "var(--handle)" }}>{b.handle} · {b.orders} {t.rd_ord_sum_orders}</div>
                </div>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{cur}{fmt(b.total)}</div>
              </button>
            ))}
            {shown.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 2px" }}>—</div>}
          </div>
        )}

        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>{t.rd_sal_retention}</div>
        {exported && <div data-testid="sales-export-note" style={{ position: "fixed", left: "50%", bottom: 96, transform: "translateX(-50%)", background: "var(--text)", color: "var(--surface)", padding: "8px 14px", borderRadius: 999, fontSize: 12, fontWeight: 700, zIndex: 40 }}>{exported} (mock)</div>}
      </div>
    </div>
  );
}

const menuItem: CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "none", border: "none", color: "var(--text)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const dateInput: CSSProperties = { display: "block", width: "100%", marginTop: 4, padding: "7px 9px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12.5 };
