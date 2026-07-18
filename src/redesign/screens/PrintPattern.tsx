// Screen 19 — LIVE Print Pattern. dc.html v3 L1110–1171 (+ ppRows L1915–1934).
// Visual only — toggles/sizes drive a live slip preview (local state). Back → General Settings.
import type { CSSProperties } from "react";
import { useT, tpl, type RedesignT } from "../i18n";
import { patternFitHint } from "../adapters/printPattern";

export interface PrintPatternState {
  shopName: boolean; shopNameSize: number; shopNameBold: boolean;
  dateTime: boolean; dateTimeSize: number;
  buyerNum: boolean; buyerNumSize: number; buyerNumBold: boolean;
  tiktokName: boolean; tiktokNameSize: number; tiktokNameBold: boolean;
  tiktokUser: boolean; tiktokUserSize: number; tiktokUserBold: boolean;
  comment: boolean; commentSize: number; commentBold: boolean;
}
export type PpBoolKey = "shopName" | "dateTime" | "buyerNum" | "tiktokName" | "tiktokUser" | "comment";
export type PpSizeKey = "shopNameSize" | "dateTimeSize" | "buyerNumSize" | "tiktokNameSize" | "tiktokUserSize" | "commentSize";
// P4 per-field weight (Bold = the PROMINENT designed rendering on the sticker:
// enlarged band / CJK bold face; Normal = the plain base rendering). Defaults =
// the approved P3 hierarchy — an untouched seller keeps exactly today's output.
export type PpWeightKey = "shopNameBold" | "buyerNumBold" | "tiktokNameBold" | "tiktokUserBold" | "commentBold";
export const DEFAULT_PP: PrintPatternState = { shopName: true, shopNameSize: 1, shopNameBold: false, dateTime: true, dateTimeSize: 1, buyerNum: true, buyerNumSize: 1, buyerNumBold: true, tiktokName: true, tiktokNameSize: 1, tiktokNameBold: true, tiktokUser: true, tiktokUserSize: 1, tiktokUserBold: true, comment: true, commentSize: 1, commentBold: false };

const rowsFor = (t: RedesignT): { key: PpBoolKey; sizeKey: PpSizeKey; weightKey?: PpWeightKey; label: string }[] => [
  { key: "shopName", sizeKey: "shopNameSize", weightKey: "shopNameBold", label: t.rd_set_shop_name },
  { key: "dateTime", sizeKey: "dateTimeSize", label: t.rd_pp_date_time },
  { key: "buyerNum", sizeKey: "buyerNumSize", weightKey: "buyerNumBold", label: t.rd_pp_buyer_num },
  { key: "tiktokName", sizeKey: "tiktokNameSize", weightKey: "tiktokNameBold", label: t.rd_pp_tiktok_name },
  { key: "tiktokUser", sizeKey: "tiktokUserSize", weightKey: "tiktokUserBold", label: t.rd_pp_tiktok_user },
  { key: "comment", sizeKey: "commentSize", weightKey: "commentBold", label: t.rd_pp_comment_center },
];
const sizeLabel = (n: number) => (n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)) + "×";
const stepBtn: CSSProperties = { width: 28, height: 28, borderRadius: "50%", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--accent-fg)", fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };

export default function PrintPattern({
  onBack, pp, onToggle, onStep, onWeight, onTestPrint, labelSize, largeOn, onLargeToggle,
}: {
  onBack: () => void;
  pp: PrintPatternState;
  onToggle: (k: PpBoolKey) => void;
  onStep: (k: PpSizeKey, dir: 1 | -1) => void;
  // P4 — per-field Bold/Normal toggle (routes the field's prominent rendering).
  onWeight?: (k: PpWeightKey) => void;
  // Printer Test — real BT test-sticker (wired in RedesignApp). Optional so the
  // screen still renders standalone; the button is a no-op only when unwired.
  onTestPrint?: () => void;
  // P4 SIZE-AWARE (Jeff requirement): the ACTUAL saved label size from Printer
  // Settings — the SAME source real prints use (RedesignApp passes
  // parseStickerSize(psSize), the exact value buildSettingsFromRedesign sends to
  // the printer). Display-only here: there is deliberately NO second size picker
  // on this screen, so the pattern can never diverge from the real print size.
  labelSize?: string;
  // P4 Large-print preset: largeOn = a stash of the pre-preset values exists.
  largeOn?: boolean;
  onLargeToggle?: () => void;
}) {
  const t = useT();
  const ROWS = rowsFor(t);
  const sizeDisp = (labelSize || "").replace("x", " × ") + " mm";
  const showFit = !!labelSize && patternFitHint(labelSize, pp);
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
            {pp.shopName && <div style={{ fontSize: Math.round(16 * pp.shopNameSize), fontWeight: pp.shopNameBold ? 800 : 500, color: "#1c1a35", marginTop: 6 }}>Maria's Live Shop</div>}
            {pp.buyerNum && <div style={{ fontSize: Math.round(14 * pp.buyerNumSize), fontWeight: pp.buyerNumBold ? 800 : 500, color: "#1c1a35", marginTop: 3 }}>Buyer #12</div>}
            {pp.tiktokName && <div style={{ fontSize: Math.round(14 * pp.tiktokNameSize), fontWeight: pp.tiktokNameBold ? 800 : 500, color: "#1c1a35", marginTop: 3 }}>Maria Santos</div>}
            {pp.tiktokUser && <div style={{ fontSize: Math.round(12 * pp.tiktokUserSize), fontWeight: pp.tiktokUserBold ? 700 : 500, color: "#7c3aed", marginTop: 3 }}>@maria_live</div>}
            {pp.comment && <div style={{ fontFamily: "var(--font-mono)", fontSize: Math.round(12 * pp.commentSize), fontWeight: pp.commentBold ? 700 : 400, color: "#5a5872", marginTop: 7 }}>Comment</div>}
          </div>
        </div>

        {/* P4 SIZE-AWARE chip — the saved Printer Settings label size (one source
            of truth; deliberately NO second size picker on this screen). */}
        {labelSize && (
          <div data-testid="pp-label-size" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 7, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
            <span aria-hidden="true">{"\u{1F3F7}\uFE0F"}</span>
            <span>{tpl(t.rd_pp_label_size, { size: sizeDisp })}</span>
          </div>
        )}
        {/* P4 honest fit note — threshold-based (see patternFitHint); the wording is
            conditional, the native vertical planner is the real authority. */}
        {showFit && (
          <div data-testid="pp-fit-note" style={{ marginTop: 8, background: "rgba(245,158,11,.13)", border: "1px solid rgba(245,158,11,.45)", borderRadius: 10, padding: "8px 12px", fontSize: 12, lineHeight: 1.45, color: "var(--text)" }}>
            {"\u26A0\uFE0F "}{tpl(t.rd_pp_fit_note, { size: sizeDisp })}
          </div>
        )}

        <button onClick={onTestPrint} style={{ width: "100%", marginTop: 11, padding: "12px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 5px 14px var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="6" stroke="currentColor" strokeWidth="1.8" /><rect x="4" y="9" width="16" height="8" rx="2" stroke="currentColor" strokeWidth="1.8" /><rect x="7" y="14" width="10" height="7" stroke="currentColor" strokeWidth="1.8" /></svg>
          {t.rd_pp_printer_test}
        </button>

        {/* P4 Large-print preset — sets the per-field values below (1.5x + Bold);
            a second tap restores the stashed previous values. A preset, not a mode. */}
        {onLargeToggle && (
          <>
            <button data-testid="pp-large-btn" onClick={onLargeToggle} style={{ width: "100%", marginTop: 10, padding: "11px 0", borderRadius: 12, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, border: largeOn ? "1px solid var(--accent)" : "1px solid var(--border-strong)", background: largeOn ? "var(--accent-soft)" : "var(--surface)", color: largeOn ? "var(--accent-fg)" : "var(--text)" }}>
              {"\u{1F453} "}{largeOn ? t.rd_pp_large_restore : t.rd_pp_large_mode}
            </button>
            <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.4, color: "var(--text-muted)" }}>{t.rd_pp_large_note}</div>
          </>
        )}

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden", marginTop: 12 }}>
          {ROWS.map((r) => {
            const on = pp[r.key];
            const wk = r.weightKey;
            return (
              <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 13px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{r.label}</span>
                <button onClick={() => onStep(r.sizeKey, -1)} style={stepBtn}>−</button>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 700, color: "var(--text)", width: 30, textAlign: "center", flexShrink: 0 }}>{sizeLabel(pp[r.sizeKey])}</span>
                <button onClick={() => onStep(r.sizeKey, 1)} style={stepBtn}>+</button>
                {/* P4 Bold/Normal weight toggle (dateTime/logo have no weight — fixed) */}
                {wk ? (
                  <button data-testid={`pp-bold-${r.key}`} aria-label={t.rd_pp_bold} aria-pressed={pp[wk]} onClick={() => onWeight?.(wk)} style={{ width: 27, height: 27, borderRadius: 8, flexShrink: 0, cursor: "pointer", fontWeight: 900, fontSize: 13.5, fontFamily: "var(--font-ui)", border: pp[wk] ? "1px solid var(--accent)" : "1px solid var(--border-strong)", background: pp[wk] ? "var(--accent)" : "var(--surface)", color: pp[wk] ? "var(--accent-text)" : "var(--text-muted)" }}>B</button>
                ) : (
                  <span style={{ width: 27, flexShrink: 0 }} />
                )}
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
