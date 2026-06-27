// Screen 12 — Sales Report. REAL session-derived aggregation, matching App.tsx
// `Sales` (1977-2009): revenue / orders / buyers / avg, top products by revenue,
// TikTok-vs-Facebook split, CSV export. Computed from the current live session
// (the same data the dashboard loads) — NOT weekly history (production has none).
import { headerBar, headerTitle, card, mono } from "../ui";
import { fmt } from "../data";
import type { SalesSummary } from "../adapters/sales";
import { useT } from "../i18n";

export default function SalesReport({ cur, sales, onExport }: {
  cur: string;
  sales: SalesSummary;
  onExport?: () => void;
}) {
  const t = useT();
  const maxRev = Math.max(1, ...sales.top.map((tp) => tp.rev));
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={headerTitle}>{t.rd_sal_title}</div>
          {onExport && sales.orders > 0 && <button onClick={onExport} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "6px 11px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_export}</button>}
        </div>
        <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 6 }}>{t.rd_sal_this_session}</div>
      </div>
      <div style={{ padding: "16px 14px 22px" }}>
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
      </div>
    </div>
  );
}
