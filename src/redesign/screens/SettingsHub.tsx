// Screen 6 — Settings hub (menu). dc.html v2 L204–254.
import type { CSSProperties, ReactNode } from "react";
import { headerBar, headerTitle } from "../ui";
import { useT } from "../i18n";

const tile: CSSProperties = { display: "flex", alignItems: "center", gap: 11, padding: "15px 13px", border: "1px solid var(--border)", borderRadius: 15, background: "var(--surface)", boxShadow: "var(--shadow)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" };
const chip = (variant: "accent" | "danger" | "neutral"): CSSProperties => ({
  width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  ...(variant === "danger"
    ? { background: "rgba(225,29,72,.13)", color: "var(--danger)" }
    : variant === "neutral"
      ? { background: "var(--chip-bg)", color: "var(--text-dim)" }
      : { background: "var(--accent-soft)", color: "var(--accent-fg)" }),
});
const tileLabel: CSSProperties = { fontSize: 13.5, fontWeight: 600, color: "var(--text)", lineHeight: 1.15 };

function Tile({ icon, label, onClick, variant = "accent" }: { icon: ReactNode; label: string; onClick: () => void; variant?: "accent" | "danger" | "neutral" }) {
  return (
    <button onClick={onClick} style={tile}>
      <span style={chip(variant)}>{icon}</span>
      <span style={tileLabel}>{label}</span>
    </button>
  );
}

const ic = {
  gear: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" /><path d="M19.4 13c.04-.3.06-.66.06-1s-.02-.7-.06-1l2.1-1.6-2-3.5-2.5 1a7.5 7.5 0 0 0-1.7-1l-.4-2.6H9.1l-.4 2.6c-.6.25-1.18.58-1.7 1l-2.5-1-2 3.5L4.6 11c-.04.3-.06.66-.06 1s.02.7.06 1l-2.1 1.6 2 3.5 2.5-1c.52.42 1.1.75 1.7 1l.4 2.6h5.8l.4-2.6c.6-.25 1.18-.58 1.7-1l2.5 1 2-3.5-2.1-1.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>,
  people: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17 14.3a5.5 5.5 0 0 1 3.5 4.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>,
  shield: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 3 5 6v5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  chart: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 19V11M10 19V5M15 19v-6M20 19V9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>,
  truck: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 6h10v9H3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M13 9h4l3 3v3h-7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="7" cy="17.5" r="1.6" stroke="currentColor" strokeWidth="1.5" /><circle cx="17" cy="17.5" r="1.6" stroke="currentColor" strokeWidth="1.5" /></svg>,
  database: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" strokeWidth="1.6" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" stroke="currentColor" strokeWidth="1.6" /><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" stroke="currentColor" strokeWidth="1.6" /></svg>,
  doclock: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 3h8l4 4v14H6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M13 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><rect x="9" y="12.5" width="6" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" /><path d="M10.3 12.5v-1a1.7 1.7 0 0 1 3.4 0v1" stroke="currentColor" strokeWidth="1.4" /></svg>,
  trash: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 7V5h4v2M6 7l1 13h10l1-13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  exit: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M9 8 5 12l4 4M5 12h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
};

export default function SettingsHub({
  onGeneral, onCustomers, onAdmin, onSales, onShipping, onCustomerData, onLegal, onDelete, onLogout,
  isAdmin = false,
}: {
  onGeneral: () => void; onCustomers: () => void;
  onAdmin: () => void; onSales: () => void; onShipping: () => void;
  onCustomerData: () => void; onLegal: () => void; onDelete: () => void; onLogout: () => void;
  isAdmin?: boolean; // Phase 5h — owner-only tiles (matches production isAdminUser gating)
}) {
  const t = useT();
  return (
    <div>
      <div style={headerBar}>
        <div style={headerTitle}>{t.rd_set_title}</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{t.rd_sh_sub}</div>
      </div>
      <div style={{ padding: "16px 14px 22px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Tile icon={ic.gear} label={t.rd_sh_general} onClick={onGeneral} />
          <Tile icon={ic.people} label={t.rd_cus_title} onClick={onCustomers} />
          {/* Owner-only (production: isAdminUser) */}
          {isAdmin && <Tile icon={ic.shield} label={t.rd_sh_admin} onClick={onAdmin} />}
          <Tile icon={ic.chart} label={t.rd_sh_sales} onClick={onSales} />
          <Tile icon={ic.truck} label={t.rd_sh_shipping} onClick={onShipping} />
          {isAdmin && <Tile icon={ic.database} label={t.rd_sh_customer_data} onClick={onCustomerData} />}
          <Tile icon={ic.doclock} label={t.lg_pt_title} onClick={onLegal} />
          <Tile icon={ic.trash} label={t.rd_sh_delete} onClick={onDelete} variant="danger" />
          <Tile icon={ic.exit} label={t.rd_sh_logout} onClick={onLogout} variant="neutral" />
        </div>
      </div>
    </div>
  );
}
