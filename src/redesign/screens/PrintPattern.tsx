// Screen 19 — LIVE Print Pattern. dc.html v3 L1110–1171 (+ ppRows L1915–1934).
// Visual only — toggles/sizes drive a live slip preview (local state). Back → General Settings.
//
// HONEST STEPS (2026-07-22): the AIMO D520BT's TSPL built-in fonts only accept
// INTEGER magnifications, and the print path (printing.ts lvl → 1..8, UI range
// caps it at 1..3) has always quantized the multiplier. The old UI stepped 0.1
// (0.5–3.0 = 26 fake steps) and previewed the RAW fraction → preview ≠ print
// and "nothing happens until 1.5". Now: steps are exactly 1→2→3, and BOTH the
// stepper label and the preview render printScaleLevel(value) — the same
// mapping buildSettingsFromRedesign applies — so preview = print exactly.
// Legacy persisted fractions (e.g. 1.3) display/preview as their print level
// and snap to integers on the first tap; storage is otherwise left as-is.
// Date & time is FIXED-SIZE in the print path (no dateTime scale exists in
// Settings; native prints the date at 1x) — its stepper was a dead control and
// is now a "Fixed size" note like the Logo row. dateTimeSize stays in the
// state shape for stored-JSON compat but nothing scales by it anymore.
//
// 🔴 KILL SWITCH (SHOW_MOTION_TOGGLE pattern): HONEST_SIZE_STEPS below.
// true  = honest behavior (all of the above). false = EXACT old behavior
// (0.1 steps clamped 0.5–3.0, fractional labels, smooth CSS preview, Date &
// time stepper back) — flipping the const is the ONLY change needed to roll
// back. Every gated decision routes through the four exported helpers
// (stepScaleLevel / sizeLabel / previewFontPx / previewDateFontPx) + the
// rowsFor fixedSize flag; the render contains NO other size math (pinned by
// PrintPattern.honestSteps.test.tsx source contract), so the const governs
// everything. The false branch is behaviorally tested against the verbatim
// old formulas. Print output is identical either way (printing.ts quantizes).
import { Fragment, useState, type CSSProperties } from "react";
import { printScaleLevel, isStickerQrOn, setStickerQrOn, isStickerQrEntitled, spacingFlagsFor, type Settings, type StickerSpacing } from "../adapters/printing";
import { stickerFit } from "../adapters/stickerFit";
import type { RasterSettings } from "../adapters/stickerRaster";
import { stickerQrSupported } from "../adapters/stickerRaster";
import ExactStickerPreview from "../components/ExactStickerPreview";
import { PREVIEW_COMMENT } from "../adapters/stickerPreview";
import { useT, tpl, type RedesignT } from "../i18n";

// ⚠️ ROLLBACK = flip to false (one-line change, Vercel-only). Do not delete
// the legacy branches while this switch exists.
export const HONEST_SIZE_STEPS = true;

export interface PrintPatternState {
  shopName: boolean; shopNameSize: number;
  dateTime: boolean; dateTimeSize: number;
  buyerNum: boolean; buyerNumSize: number;
  tiktokName: boolean; tiktokNameSize: number;
  tiktokUser: boolean; tiktokUserSize: number;
  comment: boolean; commentSize: number;
  spacing?: StickerSpacing; // sticker spacing sellers only (per device); absent = Normal
}
export type PpBoolKey = "shopName" | "dateTime" | "buyerNum" | "tiktokName" | "tiktokUser" | "comment";
export type PpSizeKey = "shopNameSize" | "dateTimeSize" | "buyerNumSize" | "tiktokNameSize" | "tiktokUserSize" | "commentSize";
export const DEFAULT_PP: PrintPatternState = { shopName: true, shopNameSize: 1, dateTime: true, dateTimeSize: 1, buyerNum: true, buyerNumSize: 1, tiktokName: true, tiktokNameSize: 1, tiktokUser: true, tiktokUserSize: 1, comment: true, commentSize: 1 };

// fixedSize: the print path has no scale for this element (prints at base
// size always) → render the "Fixed size" note instead of a lying stepper.
// Gated: legacy mode shows the old (dead) Date & time stepper again.
const rowsFor = (t: RedesignT): { key: PpBoolKey; sizeKey: PpSizeKey; label: string; fixedSize?: boolean }[] => [
  { key: "shopName", sizeKey: "shopNameSize", label: t.rd_set_shop_name },
  { key: "dateTime", sizeKey: "dateTimeSize", label: t.rd_pp_date_time, fixedSize: HONEST_SIZE_STEPS },
  { key: "buyerNum", sizeKey: "buyerNumSize", label: t.rd_pp_buyer_num },
  { key: "tiktokName", sizeKey: "tiktokNameSize", label: t.rd_pp_tiktok_name },
  { key: "tiktokUser", sizeKey: "tiktokUserSize", label: t.rd_pp_tiktok_user },
  { key: "comment", sizeKey: "commentSize", label: t.rd_pp_comment_center },
];

// ── The four gated helpers — the ONLY size logic in this file. Each takes an
// explicit `honest` flag (default = the kill switch) so tests can pin BOTH
// branches; the component always calls them without the flag.
// honest: label shows the PRINTED level (printScaleLevel = the print path's
// own round+clamp), so a legacy stored 1.3 honestly reads "1×".
// legacy: the verbatim old fractional label ("1.3×").
export const sizeLabel = (n: number, honest: boolean = HONEST_SIZE_STEPS): string =>
  honest ? printScaleLevel(n) + "×" : (n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)) + "×";

// honest: the only sizes the printer can actually produce (TSPL integer
// magnification; 3x is the largest that fits the label layouts). One tap =
// one whole step, starting from the PRINTED level of the current value — so a
// legacy 1.3 steps 1.3→2 (up) or 1.3→1 (down), never 1.4.
// legacy: the verbatim old 0.1-step formula (clamp 0.5–3.0).
export const SCALE_STEP_MIN = 1;
export const SCALE_STEP_MAX = 3;
export const stepScaleLevel = (current: number, dir: 1 | -1, honest: boolean = HONEST_SIZE_STEPS): number =>
  honest
    ? Math.min(SCALE_STEP_MAX, Math.max(SCALE_STEP_MIN, printScaleLevel(current) + dir))
    : Math.min(3, Math.max(0.5, Math.round((current + dir * 0.1) * 10) / 10));

// honest: preview px = base × the PRINTED level (preview = print).
// legacy: the verbatim old smooth CSS scaling (Math.round(base × raw)).
export const previewFontPx = (base: number, v: number, honest: boolean = HONEST_SIZE_STEPS): number =>
  honest ? base * printScaleLevel(v) : Math.round(base * v);

// Date & time: honest = FIXED base px (the print path has no dateTime scale);
// legacy = the old smooth scaling by the (print-dead) dateTimeSize.
export const previewDateFontPx = (v: number, honest: boolean = HONEST_SIZE_STEPS): number =>
  honest ? 11 : Math.round(11 * v);
const stepBtn: CSSProperties = { width: 28, height: 28, borderRadius: "50%", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--accent-fg)", fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };

// LIVE layout v2 samples (admin preview + test print). Same strings as the v2 goldens.
export const V2_SAMPLE_LATIN = "ako   si  jeff pa reserve po yung black na dress size M thank you po";
export const V2_SAMPLE_CJK = "+1 我要這件黑色 size M 2件 pls reserve 老闆娘 thank you so much";

export default function PrintPattern({
  onBack, pp, onToggle, onStep, onTestPrint, shopName = "Maria's Live Shop", layoutV2 = false, onTestPrintSample,
  stickerQrAllowed = false, psSize = "100x60mm (Standard)", appShell = false, previewSettings, cur = "NT$",
  spacingAllowed = false, onSpacing, imagePath = false,
}: {
  onBack: () => void;
  pp: PrintPatternState;
  // The seller's real Shop name — the SAME value every print path puts in the slip's
  // center (RedesignApp printShopName). Default = the old sample, for standalone renders.
  shopName?: string;
  onToggle: (k: PpBoolKey) => void;
  onStep: (k: PpSizeKey, dir: 1 | -1) => void;
  // Printer Test — real BT test-sticker (wired in RedesignApp). Optional so the
  // screen still renders standalone; the button is a no-op only when unwired.
  onTestPrint?: () => void;
  // LIVE layout v2 (admin-only until it goes public): preview shows the order time under
  // the date and the comment across the full width; two sample test prints.
  layoutV2?: boolean;
  onTestPrintSample?: (comment: string) => void;
  // "Print QR on sticker" lives here for admins (same gate as layoutV2); everyone else
  // keeps it in Printer settings. stickerQrAllowed = the unchanged market gate.
  stickerQrAllowed?: boolean;
  psSize?: string;           // the chosen sticker size (Printer settings)
  appShell?: boolean;        // phone app: QR is not available on 60×40 (same rule as Printer settings)
  previewSettings?: Settings; // the print settings the exact preview renders with
  cur?: string;
  // Sticker spacing (allowlist): Normal/Compact choice, the exact preview with the seller's real
  // image flags when this device prints images (imagePath), else the mock marked approximate.
  spacingAllowed?: boolean;
  onSpacing?: (s: StickerSpacing) => void;
  imagePath?: boolean;
}) {
  const t = useT();
  const ROWS = rowsFor(t);
  const showQrRow = layoutV2 && stickerQrAllowed;
  const qrSizeBlocked = appShell && /^60x40/.test(psSize);
  const [stickerQr, setStickerQr] = useState(() => isStickerQrOn());
  const toggleQr = () => { if (qrSizeBlocked) return; const next = !stickerQr; setStickerQrOn(next); setStickerQr(next); };
  // exact preview: QR on, a size that prints a QR (50 mm+ tall), and the @username on (QR follows it)
  const hMm = Number(psSize.match(/\d+x(\d+)/)?.[1] ?? 60);
  const showExact = showQrRow && stickerQr && !qrSizeBlocked && stickerQrSupported(hMm) && pp.tiktokUser && !!previewSettings;
  // Sticker spacing sellers: the image flags exactly as their print builds them.
  const spacing: StickerSpacing = pp.spacing === "compact" ? "compact" : "normal";
  const imageFlags: RasterSettings = { printStickerQr: stickerQr && isStickerQrEntitled(), ...(layoutV2 ? { printCommentFullWidth: true } : {}), ...spacingFlagsFor(true, spacing) };
  const spacingExact = spacingAllowed && imagePath && !!previewSettings;
  const fit = spacingExact && previewSettings ? stickerFit(previewSettings, cur, shopName, imageFlags) : null;
  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_back}</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>{t.rd_set_live_pattern}</div>
      </div>

      <div style={{ padding: "12px 14px 16px" }}>
        {/* Live slip preview (paper — literal colors) */}
        <div style={{ background: "var(--accent)", borderRadius: 16, padding: 11, boxShadow: "0 8px 22px var(--accent-soft)" }}>
          {spacingExact && previewSettings ? (
            <div style={{ background: "#fff", borderRadius: 11, padding: 8 }}>
              <ExactStickerPreview settings={previewSettings} cur={cur} shopName={shopName} v2={layoutV2} flags={imageFlags} />
            </div>
          ) : !spacingAllowed && showExact && previewSettings ? (
            <div style={{ background: "#fff", borderRadius: 11, padding: 8 }}>
              <ExactStickerPreview settings={previewSettings} cur={cur} shopName={shopName} v2={layoutV2} />
            </div>
          ) : (
          <div style={{ background: "#fff", borderRadius: 11, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "#1c1a35" }}>SellerFlowLive</span>
              {/* Date & time prints at a FIXED size (no scale in the print path) — honest preview mirrors that. */}
              {pp.dateTime && <span style={{ fontSize: previewDateFontPx(pp.dateTimeSize), color: "#9795ad", whiteSpace: "nowrap" }}>Session: 05/22/2026 12:21PM</span>}
            </div>
            {layoutV2 && pp.comment && <div style={{ textAlign: "right", fontSize: 11, color: "#9795ad", marginTop: 1 }} data-testid="pp-v2-time">14:05</div>}
            {/* Preview sizes route through previewFontPx ONLY (kill-switch-gated; honest = base × printScaleLevel = print). */}
            {pp.shopName && <div style={{ fontSize: previewFontPx(16, pp.shopNameSize), fontWeight: 700, color: "#1c1a35", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="pp-preview-shop">{shopName}</div>}
            {/* Buyer line matches the new paper layout: "Buyer" + bare number, small gap, no "#". */}
            {pp.buyerNum && <div style={{ fontSize: previewFontPx(14, pp.buyerNumSize), fontWeight: 700, color: "#1c1a35", marginTop: 3 }}>Buyer 12</div>}
            {pp.tiktokName && <div style={{ fontSize: previewFontPx(14, pp.tiktokNameSize), fontWeight: 700, color: "#1c1a35", marginTop: 3 }}>Maria Santos</div>}
            {pp.tiktokUser && <div style={{ fontSize: previewFontPx(12, pp.tiktokUserSize), fontWeight: 600, color: "#7c3aed", marginTop: 3 }}>@maria_live</div>}
            {pp.comment && !layoutV2 && <div style={{ fontFamily: "var(--font-mono)", fontSize: previewFontPx(12, pp.commentSize), color: "#5a5872", marginTop: 7 }}>Comment</div>}
            {pp.comment && layoutV2 && (
              <div style={{ borderTop: "1.5px solid #1c1a35", marginTop: 7, paddingTop: 4, textAlign: "left", fontFamily: "var(--font-mono)", fontSize: previewFontPx(12, pp.commentSize), letterSpacing: ".35em", lineHeight: 1.35, color: "#5a5872", wordBreak: "break-word" }} data-testid="pp-v2-comment">{PREVIEW_COMMENT}</div>
            )}
          </div>
          )}
        </div>
        {spacingAllowed && !spacingExact && (
          <div style={{ marginTop: 7, fontSize: 11.5, color: "var(--text-muted)", textAlign: "center" }} data-testid="pp-approx">{t.rd_pp_approx}</div>
        )}
        {fit && (fit.overflow || fit.commentScale != null || fit.cut) && (
          <div style={{ marginTop: 8, padding: "9px 11px", borderRadius: 10, background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12, lineHeight: 1.45 }} data-testid="pp-fit-warning">
            {fit.overflow && <div>{t.rd_pp_fit_overflow}</div>}
            {fit.commentScale != null && <div>{tpl(t.rd_pp_fit_scale, { n: String(fit.commentScale) })}</div>}
            {fit.cut && <div>{t.rd_pp_fit_cut}</div>}
          </div>
        )}
        {spacingAllowed && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 11 }} data-testid="pp-spacing">
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flex: 1 }}>{t.rd_pp_spacing}</span>
            {(["normal", "compact"] as const).map((v) => (
              <button key={v} onClick={() => onSpacing?.(v)} aria-pressed={spacing === v} data-testid={`pp-spacing-${v}`}
                style={{ padding: "7px 13px", borderRadius: 9, border: "1px solid var(--border-strong)", background: spacing === v ? "var(--accent)" : "var(--surface)", color: spacing === v ? "var(--accent-text)" : "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                {v === "normal" ? t.rd_pp_spacing_normal : t.rd_pp_spacing_compact}
              </button>
            ))}
          </div>
        )}

        <button onClick={onTestPrint} style={{ width: "100%", marginTop: 11, padding: "12px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 5px 14px var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="6" stroke="currentColor" strokeWidth="1.8" /><rect x="4" y="9" width="16" height="8" rx="2" stroke="currentColor" strokeWidth="1.8" /><rect x="7" y="14" width="10" height="7" stroke="currentColor" strokeWidth="1.8" /></svg>
          {t.rd_pp_printer_test}
        </button>

        {layoutV2 && onTestPrintSample && (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }} data-testid="pp-v2-tests">
            <button onClick={() => onTestPrintSample(V2_SAMPLE_LATIN)} style={{ flex: 1, padding: "10px 0", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }} data-testid="pp-v2-test-latin">{t.rd_pp_v2_test_latin}</button>
            <button onClick={() => onTestPrintSample(V2_SAMPLE_CJK)} style={{ flex: 1, padding: "10px 0", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }} data-testid="pp-v2-test-cjk">{t.rd_pp_v2_test_cjk}</button>
          </div>
        )}

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden", marginTop: 12 }}>
          {ROWS.map((r) => {
            const on = pp[r.key];
            return (
              <Fragment key={r.key}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 13px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{r.label}</span>
                {r.fixedSize ? (
                  <span style={{ fontSize: 11.5, fontStyle: "italic", color: "var(--text-muted)" }}>{t.rd_pp_fixed_size}</span>
                ) : (
                  <>
                    <button onClick={() => onStep(r.sizeKey, -1)} style={stepBtn}>−</button>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 700, color: "var(--text)", width: 30, textAlign: "center", flexShrink: 0 }}>{sizeLabel(pp[r.sizeKey])}</span>
                    <button onClick={() => onStep(r.sizeKey, 1)} style={stepBtn}>+</button>
                  </>
                )}
                <button onClick={() => onToggle(r.key)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0, marginLeft: 3 }}>
                  <span style={{ width: 40, height: 23, borderRadius: 12, background: on ? "var(--accent)" : "var(--border-strong)", position: "relative", display: "block", transition: "background .15s" }}>
                    <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 17, height: 17, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .15s" }} />
                  </span>
                </button>
              </div>
              {r.key === "tiktokUser" && showQrRow && (
                <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 13px", borderBottom: "1px solid var(--border)" }} data-testid="pp-sticker-qr-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_ps_sticker_qr}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }} data-testid="pp-sticker-qr-hint">{qrSizeBlocked ? t.rd_ps_sticker_qr_unavail : t.rd_ps_sticker_qr_desc}</div>
                  </div>
                  <button onClick={toggleQr} disabled={qrSizeBlocked} aria-pressed={qrSizeBlocked ? false : stickerQr} data-testid="pp-sticker-qr-toggle" style={{ background: "none", border: "none", cursor: qrSizeBlocked ? "not-allowed" : "pointer", padding: 0, flexShrink: 0, marginLeft: 3, opacity: qrSizeBlocked ? 0.4 : 1 }}>
                    <span style={{ width: 40, height: 23, borderRadius: 12, background: !qrSizeBlocked && stickerQr ? "var(--accent)" : "var(--border-strong)", position: "relative", display: "block", transition: "background .15s" }}>
                      <span style={{ position: "absolute", top: 3, left: !qrSizeBlocked && stickerQr ? 21 : 3, width: 17, height: 17, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .15s" }} />
                    </span>
                  </button>
                </div>
              )}
              </Fragment>
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
