// Screen 7 — Customers (list + search over loaded pages). dc.html v2 L647–689.
// Phase 5b: customer list reads REAL data via the paged useCustomers adapter,
// with loading/empty/sample states. Batch B: the search bar is a REAL input
// (client-side filter over the loaded pages — was a dead decoration), and the
// old always-sample "Comment archive" demo was removed (no backing table yet
// → honest note instead of Maria demo rows). Read-only.
import { useState } from "react";
import { CUSTOMERS, avColor, initials, fmt, type Customer } from "../data";
import { headerBar, headerTitle, mono } from "../ui";
import { filterCustomers, type ReadState } from "../adapters/useReadData";
import { useT } from "../i18n";

export default function Customers({ cur, customers = CUSTOMERS, state = "sample", onExport, hasMore = false, loadingMore = false, onLoadMore }: { cur: string; customers?: Customer[]; state?: ReadState; onExport?: () => void; hasMore?: boolean; loadingMore?: boolean; onLoadMore?: () => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const shown = filterCustomers(customers, query);
  // "+" = paged list, more rows on the server (own-filtered pages of 200).
  // While searching, the chip shows the MATCH count over the loaded pages.
  const total = state === "loading" ? "…" : query.trim() ? `${shown.length}` : `${customers.length}${hasMore ? "+" : ""}`;
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="sfl-anim-beat" style={headerTitle}>{t.rd_cus_title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {/* Export = LOADED rows only (paged list) — gated on live so the
                sample fallback can never be exported as real data (#7). */}
            {onExport && customers.length > 0 && <button onClick={onExport} title={t.rd_exp_loaded_note} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "6px 10px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_export}</button>}
            <div style={{ fontSize: 12.5, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "6px 11px", borderRadius: 9 }}>{total} {t.rd_cus_total_suffix}</div>
          </div>
        </div>
        {/* Batch B #4 — REAL search input (was a static decoration div):
            client-side filter over the LOADED pages, by name or @handle. */}
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.16)", borderRadius: 11, padding: "9px 12px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.rd_cus_search} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 13, color: "var(--on-header)", fontFamily: "var(--font-ui)" }} />
          {query && <button onClick={() => setQuery("")} style={{ background: "transparent", border: "none", color: "var(--on-header)", opacity: 0.8, cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>}
        </div>
        {onExport && customers.length > 0 && <div style={{ fontSize: 10.5, opacity: 0.75, marginTop: 7 }}>{t.rd_exp_loaded_note}</div>}
      </div>
      <div style={{ padding: "14px 14px 22px" }}>
        {state === "loading" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>{t.rd_cus_loading}</div>}
        {state === "empty" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "20px 0", marginBottom: 18 }}>{t.rd_cus_empty}</div>}
        {state === "live" && query.trim() && shown.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "20px 0", marginBottom: 18 }}>{t.rd_cus_no_match}</div>}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "var(--shadow)", overflow: "hidden", marginBottom: 18, display: shown.length ? "block" : "none" }}>
          {shown.map((c, i) => (
            <div key={`${c.handle}-${i}`} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: avColor(c.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(c.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{c.name}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)" }}>{c.handle} · {c.platform}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{cur}{fmt(c.spent)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{c.orders} {t.rd_cus_orders_suffix} · {c.last}</div>
              </div>
            </div>
          ))}
        </div>

        {state === "live" && hasMore && onLoadMore && (
          <button onClick={onLoadMore} disabled={loadingMore} style={{ display: "block", width: "100%", marginTop: -8, marginBottom: 18, padding: "11px 0", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--accent-fg)", fontSize: 13, fontWeight: 700, cursor: loadingMore ? "default" : "pointer", opacity: loadingMore ? 0.6 : 1, fontFamily: "var(--font-ui)" }}>
            {loadingMore ? "…" : t.rd_cus_load_more}
          </button>
        )}

        {/* Batch B #5 — the always-sample Maria-demo "Comment archive" rows were
            removed: comment history has NO backing table (deliberately — the
            egress lesson bans storing the raw comment stream). Honest note
            instead of demo data styled like the real list. */}
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)", margin: "0 2px 10px" }}>{t.rd_cus_archive}</div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "var(--shadow)", padding: "16px 14px", fontSize: 12.5, color: "var(--text-muted)" }}>
          {t.rd_cus_archive_none}
        </div>
      </div>
    </div>
  );
}
