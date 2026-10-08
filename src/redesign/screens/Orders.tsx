// Screen 2 — Orders. dc.html L285–325.
// Phase 5b: reads the REAL live-session window orders via liveOrdersToRedesign;
// falls back to sample when unconfigured, shows loading / empty states.
//
// Unified search (torn-sticker recovery, 2026-07-13, audited plan): ONE input,
// every field (#bNum / "#23" / name / @handle / item text / time / total) —
// the sorter types WHATEVER survived the tear, never picks a field. Scope =
// the loaded session window PLUS the full 7-day DB retention: the history
// fetch is LAZY (first keystroke, once per open, via onEnsureHistory) and its
// results appear ONLY inside search results, each with a date chip —
// display-only, the session state/TODAY bar/window semantics are unreachable
// from here. Every result row gets ↻ Reprint (the audited zero-write path) so
// the workflow is type → find → reprint → stick.
import type { WaitlistRow } from "../adapters/fbWaitlist";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ORDERS, avColor, initials, fmt, statusColor, type Order } from "../data";
import { filterOrders, buyerReceipt, type ReadState } from "../adapters/useReadData";
import {
  filterByPlatform, dedupeByOrderNum, inDateRange, rangeBounds, orderSummary,
  type PlatformFilter, type DateRange,
} from "../adapters/ordersView";
import { exportBrandedXlsx, exportBrandedPdf, type ExportColumn } from "../adapters/brandedExport";
import { dayStamp } from "../adapters/csv";
import type { Buyer } from "../../lib/orderTypes";
import type { HistoryState } from "../adapters/ordersSearch";
import { useT, tpl } from "../i18n";
import ReceiptSheet from "../components/ReceiptSheet";
import { fbReceiptInfo } from "../adapters/fbReceipt";
import { fbNameOnly } from "../adapters/fbName";
import { buyerTagFor, type BuyerTagMap } from "../adapters/buyerTag";
import BuyerTagPill from "../components/BuyerTagPill";
import { usePaidFlags, isPaidExpired, orderKey } from "../adapters/ordersPaid";

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px" };
const title: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" };
const mono = "var(--font-mono)";
const noteStyle: CSSProperties = { fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" };

export default function Orders({ onGoPrint, cur, orders = ORDERS, state = "sample", onGoShipping,
  historyOrders = [], historyState = "idle", onEnsureHistory, onReprintOrder, todayId = "",
  buyers = [], seller, initialQuery = "", topTabs, fbReceipt = false, sessionId = null, hideFbPill = false, waitlist, paidFlag = false, buyerTags = null,
}: {
  onGoPrint: () => void; cur: string; orders?: Order[]; state?: ReadState; onGoShipping?: () => void;
  // 7-day search reach (display-only lane — see ordersSearch.ts)
  historyOrders?: Order[]; historyState?: HistoryState; onEnsureHistory?: () => void;
  // Reprint from a result row (zero-write — resolveReprintRow + performReprint)
  onReprintOrder?: (o: Order) => void;
  todayId?: string; // rows dated ≠ today get the date chip (history + multi-day)
  // Buyer receipt (2026-09-11) — the CURRENT session's grouped buyers, for the
  // numeric-search receipt box. Current session only (buyer# repeats per session).
  buyers?: Buyer[];
  seller?: { name?: string; email?: string }; // branded export header (optional)
  initialQuery?: string; // Sales tab → tap a buyer → open Orders pre-filtered by name
  topTabs?: ReactNode;   // the "Orders | Miners" segment, rendered in the header
  // Messenger receipt step 1 — FB preview accounts only (RedesignApp passes the gate).
  // false/absent → the receipt box renders exactly as before.
  fbReceipt?: boolean;
  hideFbPill?: boolean; // PLATFORM WORLDS: no Facebook world → no "Facebook" pill (default false = unchanged)
  // F3 Facebook waitlist (fb_waitlist_enabled + Messenger access + Facebook world). Absent = no section.
  waitlist?: WaitlistUi;
  sessionId?: string | null; // the current session (Messenger receipt Send + "Receipt sent ✓")
  // B2 (orders_paid_flag_enabled): Mark paid / Unpaid per order, the "Unpaid" pill, "Expired"
  // after 24 h unpaid. false/absent = the screen exactly as before (no extra read).
  paidFlag?: boolean;
  buyerTags?: BuyerTagMap | null; // OLD / NEW pill next to the buyer (null = not loaded → no pill)
}) {
  const t = useT();
  const [query, setQuery] = useState(initialQuery); // seeded once on mount (Orders remounts per screen change)
  const [reprintingKey, setReprintingKey] = useState("");
  // Batch 1 — TOP-OF-SCREEN view controls (all additive; rows/Reprint untouched).
  const [platformFilterRaw, setPlatformFilter] = useState<PlatformFilter>("all"); // F2
  // A hidden Facebook pill can never stay selected (an admin switching "View as platform").
  const platformFilter: PlatformFilter = hideFbPill && platformFilterRaw === "Facebook" ? "all" : platformFilterRaw;
  const [range, setRange] = useState<DateRange>("session");                    // F4 (default = today's behavior)
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [receiptSheetOpen, setReceiptSheetOpen] = useState(false);
  const live = state === "live";
  const paid = usePaidFlags(paidFlag, orders);
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [paidBusy, setPaidBusy] = useState("");
  const [paidErr, setPaidErr] = useState(false);
  const [openedAt] = useState(() => Date.now()); // "Expired" is judged at screen open (Orders remounts per visit)
  const unpaidPick = (o: Order) => { const r = paid.map.get(orderKey(o)); return !!r && !r.paidAt; };
  const searching = query.trim().length > 0;
  // A pure-digit query that EXACTLY matches a buyer# → show the receipt box ONLY
  // (Option A). EXACT `num ===`, so "1" is buyer #1, never #10/#11 (contains).
  const trimmed = query.trim();
  const receipt = /^\d+$/.test(trimmed) ? buyerReceipt(buyers, Number(trimmed)) : null;
  // "Receipt sent ✓" — ONE info call when a Facebook buyer's box appears (no polling).
  const tagKey = fbReceipt && receipt && receipt.platform === "Facebook" && sessionId ? `${sessionId}:${receipt.num}` : "";
  const [sentTag, setSentTag] = useState<{ key: string; sent: boolean } | null>(null);
  useEffect(() => {
    if (!tagKey) return;
    let alive = true;
    const [sid, n] = [tagKey.slice(0, tagKey.lastIndexOf(":")), Number(tagKey.slice(tagKey.lastIndexOf(":") + 1))];
    void fbReceiptInfo(sid, n).then((r) => { if (alive && r.ok) setSentTag({ key: tagKey, sent: r.sentCount > 0 }); });
    return () => { alive = false; };
  }, [tagKey]);
  const showSentTag = !!tagKey && sentTag?.key === tagKey && sentTag.sent;

  // F4 base set by date range. "session" (default) = the loaded window as-is
  // (identical to today's behavior); "today" = window rows dated today; 7days /
  // custom = window ∪ 7-day history, de-duped + date-filtered. History-needing
  // ranges trigger the SAME lazy fetch that search uses (additive).
  const base = useMemo(() => {
    if (range === "session") return orders;
    if (range === "today") return orders.filter((o) => o.date === todayId);
    const { from, to } = rangeBounds(range, todayId, customFrom, customTo);
    return dedupeByOrderNum(orders, historyOrders).filter((o) => inDateRange(o.date, from, to));
  }, [orders, historyOrders, range, todayId, customFrom, customTo]);
  // F2 platform filter, then search — search composes WITHIN the dated+platform view.
  const byPlatform = useMemo(() => filterByPlatform(base, platformFilter), [base, platformFilter]);
  const shownAll = filterOrders(byPlatform, query);
  const shown = paidFlag && unpaidOnly ? shownAll.filter(unpaidPick) : shownAll;
  // Torn-sticker 7-day search reach — ONLY in the default "session" range (this is
  // exactly today's behavior; 7days/custom already fold history into `base`, and
  // "today" is intentionally today-scoped). Platform filter composes here too.
  const shownHistAll = (searching && range === "session")
    ? filterOrders(filterByPlatform(historyOrders, platformFilter), query)
    : [];
  const shownHist = paidFlag && unpaidOnly ? shownHistAll.filter(unpaidPick) : shownHistAll;
  const matchCount = shown.length + shownHist.length;
  const summary = orderSummary([...shown, ...shownHist]); // F3 — over the visible set
  // Legacy header count chip — shown ONLY in the default view (session + all), where
  // it is byte-identical to today; when a filter is active the summary bar carries
  // the accurate counts.
  const defaultView = range === "session" && platformFilter === "all";
  const badge = state === "loading" ? `${t.rd_ord_today} · …`
    : searching ? `${receipt ? receipt.count : matchCount}` : `${t.rd_ord_today} · ${orders.length}`;

  const onQuery = (v: string) => {
    setQuery(v);
    if (v.trim()) onEnsureHistory?.(); // lazy 7-day fetch — first search only (hook no-ops after)
  };
  const pickRange = (r: DateRange) => {
    setRange(r);
    setRangeOpen(false);
    if (r === "7days" || r === "custom") onEnsureHistory?.(); // load the 7-day window (same lazy fetch)
  };
  const rangeLabel = range === "session" ? t.rd_ord_range_session : range === "today" ? t.rd_ord_today : range === "7days" ? t.rd_ord_range_7d : t.rd_ord_range_custom;

  // F5 — branded export of the CURRENTLY VISIBLE rows (search + platform + range).
  const buildExport = () => {
    const columns: ExportColumn[] = [
      { header: t.rd_ord_col_order, width: 10 },
      { header: t.rd_ord_col_buyer, width: 22 },
      { header: t.rd_ord_col_user, width: 18 },
      { header: t.rd_ord_col_item, width: 26 },
      { header: t.rd_ord_col_amount, width: 12, align: "right" },
      { header: t.rd_prd_status_col, width: 12, color: (v) => (String(v) === t.rd_ord_st_new ? "0284C7" : undefined) },
      { header: t.rd_prd_platform, width: 12 },
      { header: t.rd_ord_col_time, width: 12 },
    ];
    const vis = [...shown, ...shownHist];
    const rows = vis.map((o) => [o.id, o.buyer, o.handle, o.items, `${cur}${fmt(o.total)}`, o.status === "New" ? t.rd_ord_st_new : o.status, o.platform, o.time]);
    const s = orderSummary(vis);
    const smry = [
      { label: t.rd_ord_sum_orders, value: s.count },
      { label: t.rd_ord_sum_total, value: `${cur}${fmt(s.total)}` },
      { label: t.rd_ord_sum_buyers, value: s.uniqueBuyers },
      { label: t.rd_ord_sum_aov, value: `${cur}${fmt(s.aov)}` },
    ];
    return { title: t.rd_ord_title, seller, columns, rows, summary: smry, filename: `sellerflow-orders-${dayStamp()}` };
  };
  const doExportXlsx = () => { setExportOpen(false); void exportBrandedXlsx(buildExport()).catch(() => { /* export chunk failed */ }); };
  const doExportPdf = () => { setExportOpen(false); exportBrandedPdf(buildExport()); };
  const reprint = (o: Order) => {
    const key = `${o.orderNum ?? o.id}`;
    if (reprintingKey) return; // global 2s cooldown — mirrors the Dashboard ↻ (BLE-protective)
    setReprintingKey(key);
    onReprintOrder?.(o);
    setTimeout(() => setReprintingKey(""), 2000);
  };

  const row = (o: Order, idx: number, hist: boolean) => (
    <div key={`${hist ? "h" : "w"}-${o.orderNum ?? o.id}-${idx}`} onClick={onGoPrint} title={t.rd_ord_print_slip} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, padding: "13px 14px", boxShadow: "var(--shadow)", cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: avColor(o.buyer), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(o.buyer)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)" }}>{o.buyer}</span>
            {!fbNameOnly(o.platform, o.buyer) && <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.handle}</span>}
            {(() => { const bt = buyerTagFor(buyerTags, o.handle, o.buyer, o.platform); return bt && <BuyerTagPill tag={bt} />; })()}
            {/* Date chip — any row not from today (history results + earlier
                days of a multi-day window) is unambiguous at a glance. */}
            {o.date && todayId && o.date !== todayId && (
              <span style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", background: "var(--surface-2)", border: "1px solid var(--border)", padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap", flexShrink: 0 }}>{o.date.slice(5).replace("-", "/")}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{o.id}</div>
          <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: "var(--text)", marginTop: 1 }}>{cur}{fmt(o.total)}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
        {/* F-batch i18n: canonical status value ("New") stays English for
            statusColor state-equality; only the DISPLAY translates. */}
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".03em", color: statusColor(o.status), background: "var(--surface-2)", border: "1px solid var(--border)", padding: "3px 9px", borderRadius: 7 }}>{o.status === "New" ? t.rd_ord_st_new : o.status}</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>{o.platform}</span>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginLeft: "auto" }}>{live || hist ? o.time : `${o.time} ${t.rd_ord_ago}`}</span>
        {/* ↻ Reprint — the torn-sticker workflow's last step. Zero-write path
            (resolveReprintRow → performReprint = printSlip only); available on
            every result row that carries an orderNum. stopPropagation so the
            row's go-to-Print onClick never co-fires. */}
        {onReprintOrder && o.orderNum != null && (
          <button
            onClick={(e) => { e.stopPropagation(); reprint(o); }}
            disabled={!!reprintingKey}
            title={t.rd_dash_reprint_title} aria-label={t.rd_dash_reprint}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 800, color: "var(--ok)", background: "transparent", border: "1.5px solid var(--ok)", padding: "4px 10px", borderRadius: 8, cursor: reprintingKey ? "default" : "pointer", opacity: reprintingKey && reprintingKey !== `${o.orderNum}` ? 0.55 : 1, fontFamily: "var(--font-ui)" }}>
            ↻ {reprintingKey === `${o.orderNum}` ? t.rd_dash_reprinting : t.rd_dash_reprint}
          </button>
        )}
        {paidFlag && paidControls(o)}
      </div>
    </div>
  );

  // B2 — "Expired" (unpaid > 24 h, display only) + the Mark paid / Paid toggle. Only for an order
  // whose database row was found; one write per tap, nothing is sent to the buyer.
  const paidControls = (o: Order) => {
    const r = paid.map.get(orderKey(o));
    if (!r) return null;
    const k = String(r.id);
    const toggle = async () => {
      if (paidBusy) return;
      setPaidBusy(k); setPaidErr(false);
      const ok = await paid.setPaid(r, !r.paidAt);
      setPaidBusy("");
      if (!ok) setPaidErr(true);
    };
    return (
      <>
        {isPaidExpired(r, openedAt) && <span data-testid="ord-expired" style={{ fontSize: 10.5, fontWeight: 800, color: "var(--danger)", border: "1px solid var(--danger)", padding: "2px 7px", borderRadius: 6 }}>{t.rd_ord_expired}</span>}
        <button type="button" data-testid="ord-paid-btn" aria-pressed={!!r.paidAt} disabled={!!paidBusy}
          onClick={(e) => { e.stopPropagation(); void toggle(); }}
          style={{ fontSize: 11.5, fontWeight: 800, padding: "4px 10px", borderRadius: 8, fontFamily: "var(--font-ui)", cursor: paidBusy ? "default" : "pointer", border: r.paidAt ? "1.5px solid var(--ok)" : "1.5px solid var(--border)", background: r.paidAt ? "var(--ok)" : "transparent", color: r.paidAt ? "#fff" : "var(--text-dim)", opacity: paidBusy && paidBusy !== k ? 0.55 : 1 }}>
          {r.paidAt ? `✓ ${t.rd_ord_paid}` : t.rd_ord_mark_paid}
        </button>
      </>
    );
  };

  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="sfl-anim-beat" style={title}>{t.rd_ord_title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {/* 7-11 shipping entry point (Jeff: inside Orders) */}
            {onGoShipping && <button onClick={onGoShipping} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "6px 10px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>🚚 {t.rd_sh_shipping}</button>}
            {/* F5 — branded Excel/PDF export (replaces the old CSV button) of the visible rows */}
            {matchCount > 0 && (
              <div style={{ position: "relative" }}>
                <button onClick={() => setExportOpen((o) => !o)} data-testid="orders-export" aria-haspopup="menu" aria-expanded={exportOpen} style={{ fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "6px 10px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_export} ▾</button>
                {exportOpen && (
                  <>
                    <div onClick={() => setExportOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                    <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 41, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 11, boxShadow: "0 12px 32px rgba(0,0,0,.28)", overflow: "hidden", minWidth: 152 }}>
                      <button role="menuitem" onClick={doExportXlsx} data-testid="orders-export-xlsx" style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "transparent", border: "none", borderBottom: "1px solid var(--border)", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_prd_export_excel}</button>
                      <button role="menuitem" onClick={doExportPdf} data-testid="orders-export-pdf" style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "transparent", border: "none", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_prd_export_pdf}</button>
                    </div>
                  </>
                )}
              </div>
            )}
            {defaultView && <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "6px 11px", borderRadius: 9 }}>{badge}</div>}
          </div>
        </div>
        {topTabs}
        {/* Unified search — sits where the old (dead) status-chip row was. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, background: "rgba(255,255,255,.14)", borderRadius: 11, padding: "8px 12px" }}>
          <span style={{ fontSize: 13, opacity: 0.8 }}>🔍</span>
          <input className="sfl-header-search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t.rd_ord_search}
            style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 13, color: "var(--on-header)", fontFamily: "var(--font-ui)" }} />
          {searching && (
            <button onClick={() => setQuery("")} aria-label="clear" style={{ background: "transparent", border: "none", color: "var(--on-header)", fontSize: 14, cursor: "pointer", padding: 0, lineHeight: 1 }}>✕</button>
          )}
        </div>
        {/* F2 platform pills + F4 date range — additive controls; default = All + This session. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
          {((hideFbPill ? ["all", "TikTok"] : ["all", "TikTok", "Facebook"]) as PlatformFilter[]).map((pf) => {
            const on = platformFilter === pf;
            const label = pf === "all" ? t.rd_ord_pf_all : pf;
            return (
              <button key={pf} onClick={() => setPlatformFilter(pf)} data-testid={`ord-pf-${pf}`} aria-pressed={on} style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 999, cursor: "pointer", fontFamily: "var(--font-ui)", border: on ? "1px solid #fff" : "1px solid rgba(255,255,255,.35)", background: on ? "#fff" : "rgba(255,255,255,.14)", color: on ? "var(--accent)" : "var(--on-header)" }}>{label}</button>
            );
          })}
          {paidFlag && (
            <button onClick={() => setUnpaidOnly((v) => !v)} data-testid="ord-unpaid-pill" aria-pressed={unpaidOnly} style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 999, cursor: "pointer", fontFamily: "var(--font-ui)", border: unpaidOnly ? "1px solid #fff" : "1px solid rgba(255,255,255,.35)", background: unpaidOnly ? "#fff" : "rgba(255,255,255,.14)", color: unpaidOnly ? "var(--accent)" : "var(--on-header)" }}>{t.rd_ord_unpaid}</button>
          )}
          {/* date-range selector — pill button → menu (custom reveals two date inputs) */}
          <div style={{ position: "relative", marginLeft: "auto" }}>
            <button onClick={() => setRangeOpen((o) => !o)} data-testid="ord-range" aria-haspopup="menu" aria-expanded={rangeOpen} style={{ fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 999, cursor: "pointer", fontFamily: "var(--font-ui)", border: "1px solid rgba(255,255,255,.35)", background: "rgba(255,255,255,.14)", color: "var(--on-header)" }}>🗓 {rangeLabel} ▾</button>
            {rangeOpen && (
              <>
                <div onClick={() => setRangeOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 41, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 11, boxShadow: "0 12px 32px rgba(0,0,0,.28)", overflow: "hidden", minWidth: 168 }}>
                  {([["session", t.rd_ord_range_session], ["today", t.rd_ord_today], ["7days", t.rd_ord_range_7d], ["custom", t.rd_ord_range_custom]] as [DateRange, string][]).map(([r, label]) => (
                    <button key={r} role="menuitem" onClick={() => pickRange(r)} data-testid={`ord-range-${r}`} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", background: range === r ? "var(--accent-soft)" : "transparent", border: "none", color: range === r ? "var(--accent-fg)" : "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        {/* Custom range inputs (only when Custom is picked) */}
        {range === "custom" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--on-header)", opacity: 0.85 }}>{t.rd_ord_range_from}</label>
            <input type="date" value={customFrom} max={todayId || undefined} onChange={(e) => setCustomFrom(e.target.value)} data-testid="ord-custom-from" style={{ fontSize: 12, padding: "4px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,.35)", background: "rgba(255,255,255,.14)", color: "var(--on-header)", fontFamily: "var(--font-ui)" }} />
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--on-header)", opacity: 0.85 }}>{t.rd_ord_range_to}</label>
            <input type="date" value={customTo} max={todayId || undefined} onChange={(e) => setCustomTo(e.target.value)} data-testid="ord-custom-to" style={{ fontSize: 12, padding: "4px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,.35)", background: "rgba(255,255,255,.14)", color: "var(--on-header)", fontFamily: "var(--font-ui)" }} />
          </div>
        )}
      </div>
      <div style={{ padding: "14px 14px 22px", display: "flex", flexDirection: "column", gap: 11 }}>
        {waitlist && <WaitlistSection w={waitlist} />}
        {/* F3 summary bar — count · total · unique buyers · AOV over the visible set. */}
        {live && !receipt && (
          <div data-testid="orders-summary" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            {[[t.rd_ord_sum_orders, `${summary.count}`], [t.rd_ord_sum_total, `${cur}${fmt(summary.total)}`], [t.rd_ord_sum_buyers, `${summary.uniqueBuyers}`], [t.rd_ord_sum_aov, `${cur}${fmt(summary.aov)}`]].map(([l, v], i) => (
              <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "8px 9px", textAlign: "center", boxShadow: "var(--shadow)" }}>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 14.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</div>
                <div style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 600 }}>{l}</div>
              </div>
            ))}
          </div>
        )}
        {/* Buyer receipt box (Option A) — a numeric-exact match REPLACES the list:
            one grouped card, all of buyer #N's orders this session + the total,
            so the seller can read the buyer their total. Display-only (no
            onClick=onGoPrint). Scrolls when long (137-order buyer); header + total
            stay pinned outside the scroll region. */}
        {receipt ? (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, padding: "13px 14px", boxShadow: "var(--shadow)" }} data-testid="buyer-receipt">
            <div style={{ display: "flex", alignItems: "center", gap: 11, paddingBottom: 11, borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: avColor(receipt.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: mono }}>#{receipt.num}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{receipt.name}</div>
                {!fbNameOnly(receipt.platform, receipt.name) && <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{receipt.handle}</div>}
              </div>
            </div>
            <div style={{ maxHeight: 340, overflowY: "auto", padding: "4px 0" }}>
              {receipt.lines.map((ln, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "6px 0" }}>
                  <span style={{ fontFamily: mono, fontSize: 11.5, color: "var(--text-muted)", flexShrink: 0, width: 22, textAlign: "right" }}>{i + 1}.</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-dim)", overflowWrap: "anywhere" }}>{ln.item}</span>
                  <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{cur}{fmt(ln.total)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 4, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>
                {tpl(t.rd_ord_receipt_items, { n: receipt.count })}
                {showSentTag && <span data-testid="receipt-sent-tag" style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, color: "var(--ok)" }}>{t.rd_rs_tag_sent}</span>}
              </span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>{t.rd_ord_receipt_total}</span>
                <span style={{ fontFamily: mono, fontSize: 20, fontWeight: 500, color: "var(--text)" }}>{cur}{fmt(receipt.total)}</span>
              </span>
            </div>
            {fbReceipt && receipt.platform === "Facebook" && (
              <button type="button" data-testid="messenger-receipt-btn" onClick={() => setReceiptSheetOpen(true)}
                style={{ marginTop: 12, width: "100%", padding: "10px 0", borderRadius: 11, border: "1.3px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent-fg)", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                {t.rd_rc_button}
              </button>
            )}
            {fbReceipt && receipt.platform === "Facebook" && receiptSheetOpen && (
              <ReceiptSheet key={receipt.num} receipt={receipt} cur={cur} onClose={() => setReceiptSheetOpen(false)}
                sessionId={sessionId} onSent={(n) => { if (tagKey) setSentTag({ key: tagKey, sent: n > 0 }); }} />
            )}
          </div>
        ) : (
          <>
            {paidFlag && paidErr && <div role="alert" data-testid="ord-paid-error" style={{ ...noteStyle, color: "var(--danger)" }}>{t.rd_ord_paid_failed}</div>}
            {state === "loading" && <div style={noteStyle}>{t.rd_ord_loading}</div>}
            {state === "empty" && !searching && <div style={noteStyle}>{t.rd_ord_empty}</div>}
            {shown.map((o, idx) => row(o, idx, false))}
            {shownHist.map((o, idx) => row(o, idx, true))}
            {/* Search states below the results: still-fetching chip · the 7-day
                no-match boundary note · honest history-fetch failure. */}
            {searching && historyState === "loading" && <div style={noteStyle}>{t.rd_ord_searching_7d}</div>}
            {searching && matchCount === 0 && historyState === "live" && <div style={noteStyle}>{t.rd_ord_no_match_7d}</div>}
            {searching && matchCount === 0 && (historyState === "idle" || historyState === "error") && <div style={noteStyle}>{t.rd_ord_no_match}</div>}
            {searching && historyState === "error" && <div style={{ ...noteStyle, padding: "6px 0", color: "var(--danger)" }}>{t.rd_ord_hist_error}</div>}
          </>
        )}
      </div>
    </div>
  );
}

// ── F3 — Facebook waitlist (this session's line per code, oldest first) ─────────────────────
export interface WaitlistUi {
  state: "loading" | "ready" | "error";
  groups: { code: string; rows: WaitlistRow[] }[];
  stockFor: (code: string) => number;     // this device's live stock for the code
  onGive: (r: WaitlistRow) => void;
  onSkip: (r: WaitlistRow) => void;
  busyId: number | null;
  note?: string | null;
}
function WaitlistSection({ w }: { w: WaitlistUi }) {
  const t = useT();
  if (w.state === "ready" && w.groups.length === 0) return null;
  return (
    <div data-testid="waitlist" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, padding: "12px 14px", boxShadow: "var(--shadow)" }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--text-muted)", marginBottom: 6 }}>{t.rd_wl_title}</div>
      {w.state === "loading" && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>…</div>}
      {w.state === "error" && <div data-testid="waitlist-error" style={{ fontSize: 12.5, color: "var(--danger)" }}>{t.rd_wl_load_failed}</div>}
      {w.note && <div role="status" data-testid="waitlist-note" style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600, margin: "4px 0" }}>{w.note}</div>}
      {w.groups.map((g) => {
        const inStock = w.stockFor(g.code) > 0;
        return (
          <div key={g.code} data-testid={`waitlist-code-${g.code}`} style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
              <span style={{ fontFamily: mono }}>{g.code}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: inStock ? "var(--ok)" : "var(--text-muted)" }}>{inStock ? t.rd_wl_in_stock : t.rd_wl_out}</span>
            </div>
            {g.rows.map((r, i) => {
              const next = i === 0 && inStock;
              return (
                <div key={r.id} data-testid={`waitlist-row-${r.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", marginTop: 4, borderRadius: 10, background: next ? "var(--accent-soft)" : "transparent", border: next ? "1px solid var(--accent)" : "1px solid transparent" }}>
                  <span style={{ width: 22, fontFamily: mono, fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textAlign: "right" }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.commenterName || r.handle}{next && <span data-testid="waitlist-next" style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, color: "var(--accent-fg)" }}>{t.rd_wl_next}</span>}</span>
                  <button disabled={!inStock || w.busyId != null} onClick={() => w.onGive(r)} data-testid={`waitlist-give-${r.id}`} style={{ fontSize: 11.5, fontWeight: 700, padding: "5px 10px", borderRadius: 8, border: "none", background: inStock ? "var(--accent)" : "var(--surface-2)", color: inStock ? "var(--accent-text)" : "var(--text-muted)", cursor: inStock && w.busyId == null ? "pointer" : "default" }}>{t.rd_wl_give}</button>
                  <button disabled={w.busyId != null} onClick={() => w.onSkip(r)} data-testid={`waitlist-skip-${r.id}`} style={{ fontSize: 11.5, fontWeight: 700, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-dim)", cursor: w.busyId == null ? "pointer" : "default" }}>{t.rd_wl_skip}</button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
