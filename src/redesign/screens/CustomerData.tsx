// Screen 14 — Customer Data (admin export table). dc.html v2 L912–932.
// Phase 5j: real customers + working Export CSV (already-loaded data).
import { CUSTOMERS, fmt, type Customer } from "../data";
import { headerBar, headerTitle, mono } from "../ui";
import { useT } from "../i18n";

export default function CustomerData({ onLegal, cur, customers = CUSTOMERS, onExport }: { onLegal: () => void; cur: string; customers?: Customer[]; onExport?: () => void }) {
  const t = useT();
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={headerTitle}>{t.rd_cd_title}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{t.rd_cd_admin_export}</div>
          </div>
          <button onClick={onExport} disabled={!onExport || customers.length === 0} title={t.rd_exp_loaded_note} style={{ background: "#fff", color: "var(--accent)", fontSize: 12, fontWeight: 700, padding: "7px 12px", border: "none", borderRadius: 9, cursor: onExport && customers.length ? "pointer" : "default", opacity: onExport && customers.length ? 1 : 0.6, fontFamily: "var(--font-ui)" }}>{t.rd_cd_export_csv}</button>
        </div>
        {/* #7 export-scope label: this table + its CSV cover the LOADED pages only */}
        <div style={{ fontSize: 10.5, opacity: 0.75, marginTop: 7 }}>{t.rd_exp_loaded_note}</div>
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <div style={{ display: "flex", padding: "10px 14px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em", color: "var(--text-muted)" }}>
            <span style={{ flex: 1.6 }}>{t.rd_cd_col_customer}</span><span style={{ flex: 0.8, textAlign: "right" }}>{t.rd_cd_col_orders}</span><span style={{ flex: 1.1, textAlign: "right" }}>{t.rd_cd_col_spent}</span>
          </div>
          {customers.map((c) => (
            <div key={c.handle} style={{ display: "flex", alignItems: "center", padding: "11px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: 1.6, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--handle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.handle}</div>
              </div>
              <div style={{ flex: 0.8, textAlign: "right", fontFamily: mono, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{c.orders}</div>
              <div style={{ flex: 1.1, textAlign: "right", fontFamily: mono, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{cur}{fmt(c.spent)}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.5, padding: "0 2px" }}>{t.rd_cd_foot_pre}<span onClick={onLegal} style={{ color: "var(--accent-fg)", fontWeight: 700, cursor: "pointer" }}>{t.rd_cd_privacy_policy}</span>{t.rd_cd_foot_post}</div>
      </div>
    </div>
  );
}
