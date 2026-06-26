// Screen 19 — LIVE Print Pattern. dc.html v3 L1110–1171 (+ ppRows L1915–1934).
// Visual only — toggles/sizes drive a live slip preview (local state). Back → General Settings.
import type { CSSProperties } from "react";
import { useT, type RedesignT } from "../i18n";

export interface PrintPatternState {
  shopName: boolean; shopNameSize: number;
  dateTime: boolean; dateTimeSize: number;
  buyerNum: boolean; buyerNumSize: number;
  tiktokName: boolean; tiktokNameSize: number;
  tiktokUser: boolean; tiktokUserSize: number;
  comment: boolean; commentSize: number;
}
export type PpBoolKey = "shopName" | "dateTime" | "buyerNum" | "tiktokName" | "tiktokUser" | "comment";
export type PpSizeKey = "shopNameSize" | "dateTimeSize" | "buyerNumSize" | "tiktokNameSize" | "tiktokUserSize" | "commentSize";
export const DEFAULT_PP: PrintPatternState = { shopName: true, shopNameSize: 1, dateTime: true, dateTimeSize: 1, buyerNum: true, buyerNumSize: 1, tiktokName: true, tiktokNameSize: 1, tiktokUser: true, tiktokUserSize: 1, comment: true, commentSize: 1 };

const rowsFor = (t: RedesignT): { key: PpBoolKey; sizeKey: PpSizeKey; label: string }[] => [
  { key: "shopName", sizeKey: "shopNameSize", label: t.rd_set_shop_name },
  { key: "dateTime", sizeKey: "dateTimeSize", label: t.rd_pp_date_time },
  { key: "buyerNum", sizeKey: "buyerNumSize", label: t.rd_pp_buyer_num },
  { key: "tiktokName", sizeKey: "tiktokNameSize", label: t.rd_pp_tiktok_name },
  { key: "tiktokUser", sizeKey: "tiktokUserSize", label: t.rd_pp_tiktok_user },
  { key: "comment", sizeKey: "commentSize", label: t.rd_pp_comment_center },
];
const sizeLabel = (n: number) => (n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)) + "×";
const stepBtn: CSSProperties = { width: 28, height: 28, borderRadius: "50%", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--accent-fg)", fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };

export default function PrintPattern({
  onBack, pp, onToggle, onStep,
}: {
  onBack: () => void;
  pp: PrintPatternState;
  onToggle: (k: PpBoolKey) => void;
  onStep: (k: PpSizeKey, dir: 1 | -1) => void;
}) {
  const t = useT();
  const ROWS = rowsFor(t);
  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_back}</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>{t.rd_set_live_pattern}</div>
      </div>

      <div style={{ padding: "12px 14px 16px" }}>
        {/* Live slip preview (paper — literal colors) */}
        <div style={{ background: "var(--accent)", borderRadius: 16, padding: 11, boxShadow: "0 8px 22px var(--accent-soft)" }}>
          <div style={{ background: "#fff", borderRadius: 11, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "#1c1a35" }}>SellerFlowLive</span>
              {pp.dateTime && <span style={{ fontSize: Math.round(11 * pp.dateTimeSize), color: "#9795ad", whiteSpace: "nowrap" }}>Session: 05/22/2026 12:21PM</span>}
            </div>
            {pp.shopName && <div style={{ fontSize: Math.round(16 * pp.shopNameSize), fontWeight: 700, color: "#1c1a35", marginTop: 6 }}>Maria's Live Shop</div>}
            {pp.buyerNum && <div style={{ fontSize: Math.round(14 * pp.buyerNumSize), fontWeight: 700, color: "#1c1a35", marginTop: 3 }}>Buyer #12</div>}
            {pp.tiktokName && <div style={{ fontSize: Math.round(14 * pp.tiktokNameSize), fontWeight: 700, color: "#1c1a35", marginTop: 3 }}>Maria Santos</div>}
            {pp.tiktokUser && <div style={{ fontSize: Math.round(12 * pp.tiktokUserSize), fontWeight: 600, color: "#7c3aed", marginTop: 3 }}>@maria_live</div>}
            {pp.comment && <div style={{ fontFamily: "var(--font-mono)", fontSize: Math.round(12 * pp.commentSize), color: "#5a5872", marginTop: 7 }}>Comment</div>}
          </div>
        </div>

        <button style={{ width: "100%", marginTop: 11, padding: "12px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 5px 14px var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="6" stroke="currentColor" strokeWidth="1.8" /><rect x="4" y="9" width="16" height="8" rx="2" stroke="currentColor" strokeWidth="1.8" /><rect x="7" y="14" width="10" height="7" stroke="currentColor" strokeWidth="1.8" /></svg>
          {t.rd_pp_printer_test}
        </button>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden", marginTop: 12 }}>
          {ROWS.map((r) => {
            const on = pp[r.key];
            return (
              <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 13px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{r.label}</span>
                <button onClick={() => onStep(r.sizeKey, -1)} style={stepBtn}>−</button>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 700, color: "var(--text)", width: 30, textAlign: "center", flexShrink: 0 }}>{sizeLabel(pp[r.sizeKey])}</span>
                <button onClick={() => onStep(r.sizeKey, 1)} style={stepBtn}>+</button>
                <button onClick={() => onToggle(r.key)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0, marginLeft: 3 }}>
                  <span style={{ width: 40, height: 23, borderRadius: 12, background: on ? "var(--accent)" : "var(--border-strong)", position: "relative", display: "block", transition: "background .15s" }}>
                    <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 17, height: 17, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .15s" }} />
                  </span>
                </button>
              </div>
            );
          })}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px" }}>
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_pp_logo}</span>
            <span style={{ fontSize: 11.5, fontStyle: "italic", color: "var(--text-muted)" }}>{t.rd_pp_fixed_size}</span>
          </div>
        </div>

        <button onClick={onBack} style={{ width: "100%", marginTop: 12, padding: "13px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 5px 14px var(--accent-soft)" }}>{t.rd_pp_save_settings}</button>
      </div>
    </div>
  );
}
