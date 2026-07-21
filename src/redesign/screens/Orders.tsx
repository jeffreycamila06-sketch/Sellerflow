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
import { useState, type CSSProperties } from "react";
import { ORDERS, avColor, initials, fmt, statusColor, type Order } from "../data";
import { filterOrders, type ReadState } from "../adapters/useReadData";
import type { HistoryState } from "../adapters/ordersSearch";
import { useT } from "../i18n";

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px" };
const title: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" };
const mono = "var(--font-mono)";
const noteStyle: CSSProperties = { fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" };

export default function Orders({ onGoPrint, cur, orders = ORDERS, state = "sample", onExport, onGoShipping,
  historyOrders = [], historyState = "idle", onEnsureHistory, onReprintOrder, todayId = "",
}: {
  onGoPrint: () => void; cur: string; orders?: Order[]; state?: ReadState; onExport?: () => void; onGoShipping?: () => void;
  // 7-day search reach (display-only lane — see ordersSearch.ts)
  historyOrders?: Order[]; historyState?: HistoryState; onEnsureHistory?: () => void;
  // Reprint from a result row (zero-write — resolveReprintRow + performReprint)
  onReprintOrder?: (o: Order) => void;
  todayId?: string; // rows dated ≠ today get the date chip (history + multi-day)
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [reprintingKey, setReprintingKey] = useState("");
  const live = state === "live";
  const searching = query.trim().length > 0;
  const shown = filterOrders(orders, query);
  // History rows surface ONLY while searching — the plain list stays the
  // window view (display-only hard line: old orders never mix into "today").
  const shownHist = searching ? filterOrders(historyOrders, query) : [];
  const matchCount = shown.length + shownHist.length;
  const badge = state === "loading" ? `${t.rd_ord_today} · …`
    : searching ? `${matchCount}` : `${t.rd_ord_today} · ${orders.length}`;

  const onQuery = (v: string) => {
    setQuery(v);
    if (v.trim()) onEnsureHistory?.(); // lazy 7-day fetch — first search only (hook no-ops after)
  };
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
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.handle}</span>
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
      </div>
    </div>
  );

  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="sfl-anim-beat" style={title}>{t.rd_ord_title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {/* 7-11 shipping entry point (Jeff: inside Orders) */}
            {onGoShipping && <button onClick={onGoShipping} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "6px 10px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>🚚 {t.rd_sh_shipping}</button>}
            {onExport && orders.length > 0 && <button onClick={onExport} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "6px 10px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_export}</button>}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "6px 11px", borderRadius: 9 }}>{badge}</div>
          </div>
        </div>
        {/* Unified search — sits where the old (dead) status-chip row was. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, background: "rgba(255,255,255,.14)", borderRadius: 11, padding: "8px 12px" }}>
          <span style={{ fontSize: 13, opacity: 0.8 }}>🔍</span>
          <input className="sfl-header-search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t.rd_ord_search}
            style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 13, color: "var(--on-header)", fontFamily: "var(--font-ui)" }} />
          {searching && (
            <button onClick={() => setQuery("")} aria-label="clear" style={{ background: "transparent", border: "none", color: "var(--on-header)", fontSize: 14, cursor: "pointer", padding: 0, lineHeight: 1 }}>✕</button>
          )}
        </div>
      </div>
      <div style={{ padding: "14px 14px 22px", display: "flex", flexDirection: "column", gap: 11 }}>
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
      </div>
    </div>
  );
}
