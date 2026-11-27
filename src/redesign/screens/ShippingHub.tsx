// SHIPPING (Settings → SHIPPING → Shipping) — the place for the shipping tools. Today: Waybill username
// (Philippines: opens the screen; Taiwan: "Soon", dimmed, not tappable). Admins also find the 7-11
// 交貨便 export here (it was the "Shipping" tile in Settings). Gate: adapters/waybillGate.
import type { CSSProperties, ReactNode } from "react";
import { headerBar, headerTitle } from "../ui";
import { HeaderWithBack } from "../components/BackButton";
import { useT } from "../i18n";
import SoonBadge from "../components/SoonBadge";
import type { WaybillAccess } from "../adapters/waybillGate";

const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 12, minHeight: 64, padding: "10px 14px", background: "var(--surface)", border: "none", width: "100%", textAlign: "left", fontFamily: "var(--font-ui)", color: "var(--text)", cursor: "pointer", boxSizing: "border-box" };
const icon = (bg: string, fg: string): CSSProperties => ({ width: 38, height: 38, borderRadius: 12, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 });
const tagIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 12.6V5a2 2 0 0 1 2-2h7.6a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-7.6 7.6a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 12.6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /></svg>;
const boxIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M3 7.5 12 12l9-4.5M12 12v9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>;

export function NewBadge({ testid }: { testid?: string }) {
  const t = useT();
  return <span data-testid={testid} style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".05em", color: "#fff", background: "var(--danger)", padding: "3px 8px", borderRadius: 999, lineHeight: 1.2, flexShrink: 0 }}>{t.rd_bl_new}</span>;
}

function Row({ icon: ic, title, sub, right, onClick, soon = false, testid }: { icon: ReactNode; title: string; sub: string; right?: ReactNode; onClick?: () => void; soon?: boolean; testid: string }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} aria-disabled={!onClick} data-testid={testid} data-soon={soon ? "1" : undefined}
      style={{ ...rowStyle, ...(soon ? { opacity: 0.6, cursor: "default" } : {}) }}>
      <span style={icon("var(--warn-soft)", "var(--warn)")}>{ic}</span>
      <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>{title}</span>
        <span style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.3 }}>{sub}</span>
      </span>
      {right}
      <span aria-hidden style={{ color: "var(--text-dim)", fontSize: 18, flexShrink: 0 }}>›</span>
    </button>
  );
}

export default function ShippingHub({ onBack, access, onWaybill, waybillNew = false, on711, sub711 }: {
  onBack: () => void;
  access: Exclude<WaybillAccess, "hidden">;
  onWaybill?: () => void;   // Philippines (full) only
  waybillNew?: boolean;     // "NEW" until the seller opens Waybill username once on this phone
  on711?: () => void;       // admins: the 7-11 交貨便 export (the old Settings "Shipping" tile)
  sub711?: string;
}) {
  const t = useT();
  const full = access === "full";
  return (
    <div>
      <div style={headerBar} data-hb-top>
        <HeaderWithBack onBack={onBack}>
          <div className="sfl-anim-beat" style={headerTitle}>{t.rd_sh_shipping}</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }} data-testid="shub-country">{full ? t.rd_shub_ph : t.rd_shub_tw}</div>
        </HeaderWithBack>
      </div>
      <div style={{ padding: "14px 12px 22px", display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
        <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--border)", boxShadow: "var(--shadow)", display: "flex", flexDirection: "column" }}>
          {full
            ? <Row icon={tagIcon} title={t.rd_wb_title} sub={t.rd_wb_row_sub_ph} onClick={onWaybill} right={waybillNew ? <NewBadge testid="shub-waybill-new" /> : undefined} testid="shub-waybill" />
            : <Row icon={tagIcon} title={t.rd_wb_title} sub={t.rd_wb_row_sub_tw} soon right={<SoonBadge plain testid="shub-waybill-soon" style={{ flexShrink: 0 }} />} testid="shub-waybill" />}
          {on711 && (
            <div style={{ borderTop: "1px solid var(--border)" }}>
              <Row icon={boxIcon} title={t.rd_shub_711} sub={sub711 ?? ""} onClick={on711} testid="shub-711" />
            </div>
          )}
        </div>
        <div style={{ background: "var(--accent-soft)", color: "var(--accent-fg)", borderRadius: 12, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.45 }} data-testid="shub-note">
          {full ? t.rd_shub_more : t.rd_wb_tw_note}
        </div>
      </div>
    </div>
  );
}
