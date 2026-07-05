// Screen 7 — Customers (list + comment archive). dc.html v2 L647–689.
// Phase 5b: customer list reads REAL data via getCustomersFromDatabase (useCustomers
// adapter), with loading/empty/sample states. The Comment archive stays sample —
// it is live-comment history with no backing table (Phase 5 later). Read-only.
import { CUSTOMERS, ARCHIVE, avColor, initials, fmt, type Customer } from "../data";
import { headerBar, headerTitle, mono } from "../ui";
import type { ReadState } from "../adapters/useReadData";
import { useT } from "../i18n";

export default function Customers({ cur, customers = CUSTOMERS, state = "sample", onExport, hasMore = false, loadingMore = false, onLoadMore }: { cur: string; customers?: Customer[]; state?: ReadState; onExport?: () => void; hasMore?: boolean; loadingMore?: boolean; onLoadMore?: () => void }) {
  const t = useT();
  // "+" = paged list, more rows on the server (own-filtered pages of 200).
  const total = state === "loading" ? "…" : `${customers.length}${hasMore ? "+" : ""}`;
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={headerTitle}>{t.rd_cus_title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {onExport && customers.length > 0 && <button onClick={onExport} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "6px 10px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_export}</button>}
            <div style={{ fontSize: 12.5, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "6px 11px", borderRadius: 9 }}>{total} {t.rd_cus_total_suffix}</div>
          </div>
        </div>
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.16)", borderRadius: 11, padding: "9px 12px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <span style={{ fontSize: 13, opacity: 0.85 }}>{t.rd_cus_search}</span>
        </div>
      </div>
      <div style={{ padding: "14px 14px 22px" }}>
        {state === "loading" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>{t.rd_cus_loading}</div>}
        {state === "empty" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "20px 0", marginBottom: 18 }}>{t.rd_cus_empty}</div>}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "var(--shadow)", overflow: "hidden", marginBottom: 18, display: customers.length ? "block" : "none" }}>
          {customers.map((c, i) => (
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

        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)", margin: "0 2px 10px" }}>{t.rd_cus_archive}</div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "var(--shadow)", padding: 6 }}>
          {ARCHIVE.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "9px 8px" }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: avColor(a.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(a.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{a.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--handle)" }}>{a.handle}</span>
                  <span style={{ fontSize: 10.5, color: "var(--text-muted)", marginLeft: "auto" }}>{a.time}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 1 }}>{a.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
