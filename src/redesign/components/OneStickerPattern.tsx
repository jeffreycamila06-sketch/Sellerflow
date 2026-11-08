// ONE STICKER — the NEW Live print pattern screen (switch one_sticker_enabled; admins before).
// Same screen on iPhone, Android and laptop. On top: the EXACT picture this device's printer path
// prints (oneSticker.ts — the same function the print uses). Below: Printer Test + the two long
// comment tests, the paper size chips (+ Custom W×H), one row per part (weight · size · on/off),
// the fixed date row, the QR row, "Reset to recommended" and "Save settings".
// Saving is what switches THIS device to the new sticker (oneStickerPrint.saveOneSticker); until
// then the device keeps today's sticker.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import {
  recommendedSettings, renderOneSticker, screenFitNotes, SCALE_STEPS, STANDARD_SIZES, CUSTOM_MIN_MM, CUSTOM_MAX_MM, validCustomMm, isSmallClass, tooWideFor,
  type OneStickerSettings, type PartKey, type Weight, type OneStickerInput, type FitWarning, type FitNote,
} from "../adapters/oneSticker";
import { oneStickerFonts, renderOptsFor, sampleInput, type OneStickerPath } from "../adapters/oneStickerPrint";
import type { OneStickerDevicePath } from "../adapters/printing";

const sameSettings = (a: OneStickerSettings, b: OneStickerSettings) => JSON.stringify(a) === JSON.stringify(b);
const nextStep = (v: number, dir: 1 | -1): number => {
  const i = SCALE_STEPS.findIndex((s) => s === v);
  const j = Math.max(0, Math.min(SCALE_STEPS.length - 1, (i < 0 ? SCALE_STEPS.indexOf(1) : i) + dir));
  return SCALE_STEPS[j];
};
const pathForPreview = (p: OneStickerDevicePath): OneStickerPath => (p === "text" || p === "wifi" ? "laptop" : p);

/** The exact picture of `settings` for this device's path (async: the fonts are lazy chunks). */
export function OneStickerPreview({ settings, input, path, job, onWarnings }: { settings: OneStickerSettings; input: OneStickerInput; path: OneStickerPath; job?: { bold?: boolean }; onWarnings?: (w: FitWarning[]) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const key = JSON.stringify({ settings, input, path, job });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false); // fonts / picture could not load → a short message + Try again
  const [attempt, setAttempt] = useState(0);
  const t = useT();
  useEffect(() => {
    let live = true;
    void oneStickerFonts(settings, input).then((fonts) => {
      const c = ref.current;
      if (!live || !c) return;
      const img = renderOneSticker(settings, input, fonts, renderOptsFor(path, settings, job ?? {}));
      onWarnings?.(img.warnings);
      // Niimbot: the SDK frame sits 1 mm inside the label — draw it there so the preview is the label
      const lw = settings.size.w * 8, lh = settings.size.h * 8;
      const ox = Math.floor((lw - img.w) / 2), oy = Math.floor((lh - img.h) / 2);
      c.width = lw; c.height = lh;
      const ctx = c.getContext?.("2d");
      if (!ctx) return;
      const data = ctx.createImageData(lw, lh);
      data.data.fill(255);
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        if (!(img.buf[y * img.rowBytes + (x >> 3)] & (0x80 >> (x & 7)))) continue;
        const i = ((y + oy) * lw + (x + ox)) * 4;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = 0;
      }
      ctx.putImageData(data, 0, 0);
      setFailed(false);
      setReady(true);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps -- key covers every input
  if (failed) return (
    <div data-testid="os-preview-failed" role="status" style={{ width: "100%", aspectRatio: `${settings.size.w} / ${settings.size.h}`, maxHeight: "min(60vh, 420px)", display: "grid", placeItems: "center", gap: 6, background: "#fff", borderRadius: 6, padding: 12, textAlign: "center", color: "#16152B", fontSize: 13, fontWeight: 600 }}>
      <span>{t.rd_os_preview_failed}</span>
      <button type="button" data-testid="os-preview-retry" onClick={() => { setFailed(false); setAttempt((a) => a + 1); }} style={{ minHeight: TAP, padding: "6px 14px", borderRadius: 10, border: "1px solid #d9d7e6", background: "#fff", color: "#4F46E5", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{t.rd_os_try_again}</button>
    </div>
  );
  return (
    <canvas ref={ref} data-testid="os-preview" data-ready={ready ? "1" : "0"}
      // a tall / square custom label never pushes the screen down: at most min(60vh, 420 px) high, same shape
      style={{ width: "auto", height: "auto", maxWidth: "100%", maxHeight: "min(60vh, 420px)", aspectRatio: `${settings.size.w} / ${settings.size.h}`, imageRendering: "pixelated", display: "block", background: "#fff", borderRadius: 6, boxShadow: "0 0 0 1px #d9d7e6" }} />
  );
}

/** The notes under the preview for `settings` on this path — the preview's own sample (the layout
 *  only; no picture is drawn). */
function useFitNotes(settings: OneStickerSettings, input: OneStickerInput, path: OneStickerPath, job: { bold?: boolean }): FitNote[] {
  const [n, setN] = useState<FitNote[]>([]);
  const key = JSON.stringify({ settings, input, path, job });
  useEffect(() => {
    let live = true;
    // the sample (#128) AND the buyer number at its widest (#8888): a real 4-digit number never gets
    // cut while the screen says everything fits
    void oneStickerFonts(settings, input).then((fonts) => { if (live) setN(screenFitNotes(settings, input, fonts, renderOptsFor(path, settings, job))); }).catch(() => { if (live) setN([]); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- key covers every input
  return n;
}
const NOTE_COLOR: Record<FitNote["kind"], string> = { ok: "var(--ok, #0F8A5F)", bad: "var(--danger)", shrunk: "var(--warn, #9A5C00)", cut: "var(--warn, #9A5C00)", short: "var(--warn, #9A5C00)", qr: "var(--warn, #9A5C00)", small: "var(--text-muted)" };

// Phone: one column. Laptop (the screen area ≥ 760 px): two columns, the preview on the left and
// sticky while the controls scroll (approved preview).
const OS_CSS = `
.os-wrap{container-type:inline-size}
.os-body{display:grid;gap:0;padding:12px 14px 18px;max-width:720px;margin:0 auto}
.os-pv,.os-ctl{min-width:0}
.os-row{container-type:inline-size}
.os-row-grid{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"name ctl" "w w";column-gap:6px;align-items:center}
.os-row-name{grid-area:name}.os-row-ctl{grid-area:ctl}
.os-row-w{grid-area:w;display:flex;flex-wrap:wrap;min-width:0}
@container (min-width:460px){.os-row-grid{grid-template-areas:"name ctl" "w ctl"}}
.os-ctl{margin-top:14px}
@container (min-width:760px){
  .os-body{grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);align-items:start;gap:20px;padding:20px;max-width:1180px}
  .os-pv{position:sticky;top:84px}
  .os-ctl{margin-top:0}
}`;
// Every control is at least 44 px tall to tap (audit 10); the visible pill / circle / switch keeps the
// approved preview's size inside that area.
const TAP = 44;
const chip = (on: boolean): CSSProperties => ({ padding: "8px 11px", minHeight: TAP, borderRadius: 10, border: on ? "1px solid var(--accent)" : "1px solid var(--border-strong)", background: on ? "var(--accent-soft)" : "var(--surface)", color: on ? "var(--accent-fg)" : "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", flexShrink: 0, fontVariantNumeric: "tabular-nums" });
const tapBox: CSSProperties = { minWidth: TAP, minHeight: TAP, background: "none", border: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, fontFamily: "var(--font-ui)" };
function StepBtn({ label, onClick, disabled, testId, aria }: { label: string; onClick: () => void; disabled?: boolean; testId: string; aria: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testId} aria-label={aria} style={{ ...tapBox, margin: "0 -6px", cursor: disabled ? "default" : "pointer" }}>
      <span style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid var(--border-strong)", color: "var(--accent-fg)", fontSize: 16, fontWeight: 700, display: "grid", placeItems: "center", lineHeight: 1, opacity: disabled ? 0.35 : 1 }}>{label}</span>
    </button>
  );
}
function Switch({ on, onClick, testId, disabled, aria }: { on: boolean; onClick: () => void; testId: string; disabled?: boolean; aria?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={aria} onClick={onClick} disabled={disabled} aria-pressed={on} data-testid={testId} style={{ ...tapBox, minWidth: 54, margin: "0 -4px", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1 }}>
      <span style={{ width: 46, height: 28, borderRadius: 14, background: on ? "var(--accent)" : "var(--border-strong)", position: "relative", display: "block", transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .15s" }} />
      </span>
    </button>
  );
}

export interface OneStickerPatternProps {
  onBack: () => void;
  initial: OneStickerSettings;     // saved settings, or a seed from today's pattern
  savedOnDevice: boolean;          // this device already prints the new sticker
  onSave: (s: OneStickerSettings) => void;
  shopName: string;                // the seller's own shop name ("" = none — never the brand)
  devicePath: OneStickerDevicePath;
  printerName?: string | null;     // the saved Bluetooth printer (size limit warning)
  genericBold?: boolean;           // the saved printer gets the 1-dot ink (Y41BT / XP-420B)
  qrAllowed: boolean;              // "Print QR on sticker" is available for this account
  onTest: (draft: OneStickerSettings, sample: "default" | "en" | "zh", unsaved: boolean) => void;
  onToast?: (msg: string) => void; // a short message (Reset → "Back to recommended settings")
}

export default function OneStickerPattern(p: OneStickerPatternProps) {
  const t = useT();
  const [s0, setS] = useState<OneStickerSettings>(p.initial);
  const [base, setBase] = useState<OneStickerSettings>(p.initial); // what Save compares against
  const [saved, setSaved] = useState(p.savedOnDevice);
  const [customW, setCustomW] = useState(String(p.initial.size.w));
  const [customH, setCustomH] = useState(String(p.initial.size.h));
  const [customOpen, setCustomOpen] = useState(!!p.initial.size.custom);
  const cw = Number(customW), ch = Number(customH);
  const customOk = validCustomMm(cw) && validCustomMm(ch);
  // the draft: an open, valid Custom size is the size (derived — nothing is copied into state)
  const s: OneStickerSettings = customOpen && customOk ? { ...s0, size: { w: cw, h: ch, custom: true } } : customOpen ? s0 : { ...s0, size: { w: s0.size.w, h: s0.size.h } };
  const path = pathForPreview(p.devicePath);
  const customAllowed = p.devicePath !== "text" && p.devicePath !== "wifi";
  const dirty = !sameSettings(s, base);
  const small = isSmallClass(s.size.w, s.size.h);
  const tooWide = tooWideFor(p.printerName, s.size.w);
  // the preview's sample (#128 Maria Santos @maria_live, today's Taipei date & time) — the same one the
  // test buttons print and the same one the notes are measured on
  const input = useMemo(() => sampleInput(p.shopName), [p.shopName]);
  const sEff = p.qrAllowed ? s : { ...s, qr: false };
  const notes = useFitNotes(sEff, input, path, p.genericBold ? { bold: true } : {});

  const setPart = (k: PartKey, patch: Partial<OneStickerSettings["parts"][PartKey]>) => setS((x) => ({ ...x, parts: { ...x.parts, [k]: { ...x.parts[k], ...patch } } }));
  const pickSize = (w: number, h: number) => { setCustomOpen(false); setS((x) => ({ ...x, size: { w, h } })); };
  const reset = () => { setS(recommendedSettings(s.size)); p.onToast?.(t.rd_os_reset_done); };
  const blocked = !!tooWide || (customOpen && !customOk); // a size the printer cannot take is never saved
  const save = () => { if ((!dirty && saved) || blocked) return; p.onSave(s); setBase(s); setS(s); setSaved(true); };

  const partLabel: Record<PartKey, string> = { shop: t.rd_set_shop_name, buyer: t.rd_pp_buyer_num, name: t.rd_os_name, user: t.rd_os_user, comment: t.rd_pp_comment_center };
  const weightLabel: Record<Weight, string> = { normal: t.rd_os_w_normal, bold: t.rd_os_w_bold, extra: t.rd_os_w_extra };
  const rows: { k: PartKey; hint?: string; disabled?: boolean }[] = [
    { k: "shop", ...(small ? { hint: t.rd_os_not_small, disabled: true } : {}) },
    { k: "buyer" },
    { k: "name", hint: t.rd_os_name_fb },
    { k: "user", hint: t.rd_os_user_fb },
    { k: "comment", hint: t.rd_os_comment_hint },
  ];
  const rowOf = (k: PartKey) => rows.find((r) => r.k === k)!;
  const partRow = (r: (typeof rows)[number], last = false) => {
    const part = s.parts[r.k];
    // a part switched OFF (or not on this size): its size and weight are dimmed and cannot be changed
    const off = !part.on || !!r.disabled;
    return (
      <div key={r.k} className="os-row" data-testid={`os-row-${r.k}`} data-off={off ? "1" : "0"} style={{ padding: "8px 12px", borderBottom: last ? "none" : "1px solid var(--border)" }}>
        <div className="os-row-grid" style={{ opacity: r.disabled ? 0.55 : 1 }}>
          <div className="os-row-name" style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{partLabel[r.k]}</div>
            {r.hint && <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 500 }}>{r.hint}</div>}
          </div>
          <div className="os-row-ctl" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div data-testid={`os-${r.k}-stepper`} style={{ display: "flex", alignItems: "center", opacity: off ? 0.4 : 1 }}>
              <StepBtn label="−" aria={`${partLabel[r.k]} −`} onClick={() => setPart(r.k, { scale: nextStep(part.scale, -1) })} disabled={off || part.scale === SCALE_STEPS[0]} testId={`os-${r.k}-minus`} />
              <span data-testid={`os-${r.k}-scale`} style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--text)", minWidth: 36, textAlign: "center", flexShrink: 0 }}>{part.scale}×</span>
              <StepBtn label="+" aria={`${partLabel[r.k]} +`} onClick={() => setPart(r.k, { scale: nextStep(part.scale, 1) })} disabled={off || part.scale === SCALE_STEPS[SCALE_STEPS.length - 1]} testId={`os-${r.k}-plus`} />
            </div>
            <Switch on={part.on && !r.disabled} disabled={r.disabled} aria={partLabel[r.k]} onClick={() => setPart(r.k, { on: !part.on })} testId={`os-${r.k}-on`} />
          </div>
          {/* Normal / Bold / Extra: under the row name beside the size + switch when the row is wide
              (approved preview); on its own line when it is narrow — never over the stepper */}
          <div className="os-row-w" role="group" aria-label={partLabel[r.k]} data-testid={`os-${r.k}-weights`} style={{ opacity: off ? 0.4 : 1 }}>
            {(["normal", "bold", "extra"] as Weight[]).map((w, i) => (
              <button key={w} type="button" disabled={off} onClick={() => setPart(r.k, { weight: w })} aria-pressed={part.weight === w} data-testid={`os-${r.k}-w-${w}`} style={{ ...tapBox, minWidth: TAP, cursor: off ? "default" : "pointer" }}>
                <span style={{ padding: "4px 8px", fontSize: 11.5, fontWeight: w === "normal" ? 400 : w === "bold" ? 700 : 900, border: "1px solid var(--border)", borderLeftWidth: i === 0 ? 1 : 0, borderRadius: i === 0 ? "9px 0 0 9px" : i === 2 ? "0 9px 9px 0" : 0, background: part.weight === w ? "var(--accent-soft)" : "var(--surface)", color: part.weight === w ? "var(--accent-fg)" : "var(--text)", whiteSpace: "nowrap" }}>{weightLabel[w]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };
  const isStd = (w: number, h: number) => !customOpen && s.size.w === w && s.size.h === h;
  return (
    <div data-testid="os-screen">
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={p.onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "9px 12px 9px 9px", minHeight: TAP, borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>{t.rd_back}</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.rd_set_live_pattern}</div>
      </div>

      <style>{OS_CSS}</style>
      <div className="os-wrap">
      <div className="os-body" data-testid="os-body">
        <div className="os-pv" data-testid="os-pv-col">
        {/* 1. the exact picture */}
        <div style={{ background: "var(--accent)", borderRadius: 16, padding: 11, boxShadow: "0 8px 22px var(--accent-soft)", display: "grid", gap: 8, justifyItems: "center" }}>
          <OneStickerPreview settings={sEff} input={input} path={path} job={p.genericBold ? { bold: true } : {}} />
          <span data-testid="os-caption" style={{ color: "#fff", fontSize: 12, fontWeight: 600, opacity: 0.9, textAlign: "center" }}>{tpl(t.rd_os_caption, { w: String(s.size.w), h: String(s.size.h) })}</span>
        </div>
        <div data-testid="os-notes" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {notes.map((n, i) => (
            <span key={i} data-testid={n.kind === "bad" ? "os-fit" : n.kind === "qr" ? "os-fit-qr" : `os-note-${n.kind}`} style={{ fontSize: 12, fontWeight: 600, padding: "4px 9px", borderRadius: 999, border: "1px solid var(--border)", background: n.kind === "bad" ? "var(--danger-soft)" : "var(--surface)", color: NOTE_COLOR[n.kind], lineHeight: 1.4 }}>
              {n.kind === "bad" ? tpl(t.rd_os_fit, { parts: n.parts.map((k) => partLabel[k]).join(", ") })
                : n.kind === "shrunk" ? tpl(t.rd_os_note_shrunk, { pct: String(n.pct) })
                : n.kind === "cut" ? t.rd_os_note_cut
                : n.kind === "short" ? tpl(t.rd_os_note_short, { parts: n.parts.map((k) => partLabel[k]).join(", ") })
                : n.kind === "qr" ? t.rd_os_fit_qr
                : n.kind === "small" ? t.rd_os_note_small
                : t.rd_os_note_ok}
            </span>
          ))}
        </div>
        {p.devicePath === "text" && <div data-testid="os-text-path" style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_os_text_path}</div>}
        {p.devicePath === "wifi" && <div data-testid="os-wifi-path" style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_os_wifi_path}</div>}

        {/* 2. test prints (today's buttons) */}
        <button onClick={() => p.onTest(sEff, "default", dirty || !saved)} data-testid="os-test" style={{ width: "100%", marginTop: 11, padding: "12px 0", minHeight: 44, border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 5px 14px var(--accent-soft)" }}>{t.rd_pp_printer_test}</button>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={() => p.onTest(sEff, "en", dirty || !saved)} data-testid="os-test-en" style={{ flex: 1, minWidth: 0, padding: "10px 6px", minHeight: 44, border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{t.rd_pp_v2_test_latin}</button>
          <button onClick={() => p.onTest(sEff, "zh", dirty || !saved)} data-testid="os-test-zh" style={{ flex: 1, minWidth: 0, padding: "10px 6px", minHeight: 44, border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{t.rd_pp_v2_test_cjk}</button>
        </div>

        </div>
        <div className="os-ctl" data-testid="os-ctl-col">
        {/* 3. paper size */}
        <div data-testid="os-size-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "var(--shadow)", padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--text-muted)", padding: "0 4px" }}>{t.rd_os_size}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }} data-testid="os-sizes">
          {STANDARD_SIZES.filter((z) => customAllowed || !(z.w === 50 && z.h === 30)).map((z) => (
            <button key={`${z.w}x${z.h}`} type="button" onClick={() => pickSize(z.w, z.h)} aria-pressed={isStd(z.w, z.h)} data-testid={`os-size-${z.w}x${z.h}`} style={chip(isStd(z.w, z.h))}>{z.w}×{z.h}</button>
          ))}
          {customAllowed && <button type="button" onClick={() => setCustomOpen(true)} aria-pressed={customOpen} data-testid="os-size-custom" style={chip(customOpen)}>{t.rd_os_custom}</button>}
        </div>
        {!customAllowed && <div data-testid="os-custom-hidden" style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-muted)" }}>{t.rd_os_custom_hidden}</div>}
        {customAllowed && customOpen && (
          <div data-testid="os-custom" style={{ marginTop: 9 }}>
            {/* W · × · H on one line (a fixed grid — the "×" never wraps alone), inputs full width, ≥ 44 px */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", alignItems: "end", gap: 8 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--text-muted)", minWidth: 0 }}>{t.rd_os_width}
                <input inputMode="numeric" value={customW} onChange={(e) => setCustomW(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} data-testid="os-custom-w" style={{ width: "100%", boxSizing: "border-box", minHeight: TAP, fontSize: 16, padding: "9px 10px", borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", minWidth: 0 }} />
              </label>
              <span aria-hidden="true" style={{ fontSize: 16, fontWeight: 800, color: "var(--text-muted)", lineHeight: `${TAP}px` }}>×</span>
              <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--text-muted)", minWidth: 0 }}>{t.rd_os_height}
                <input inputMode="numeric" value={customH} onChange={(e) => setCustomH(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} data-testid="os-custom-h" style={{ width: "100%", boxSizing: "border-box", minHeight: TAP, fontSize: 16, padding: "9px 10px", borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", minWidth: 0 }} />
              </label>
            </div>
            {!customOk && <div data-testid="os-custom-err" style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>{tpl(t.rd_os_custom_err, { min: String(CUSTOM_MIN_MM), max: String(CUSTOM_MAX_MM) })}</div>}
          </div>
        )}
        {tooWide && <div data-testid="os-too-wide" style={{ marginTop: 7, fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>{tpl(t.rd_os_too_wide, { model: tooWide.model, max: String(tooWide.maxLabelMm) })}</div>}
        </div>

        {/* 4. one row per part */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden", marginTop: 13 }}>
          {/* the approved preview's order: Shop name → Date & time → Buyer # → Name → @username → Print QR → Comment / Price */}
          {partRow(rowOf("shop"))}
          <div data-testid="os-row-date" style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_pp_date_time}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{t.rd_os_date_always}</div>
            </div>
            <span style={{ fontSize: 11.5, fontStyle: "italic", color: "var(--text-muted)", textAlign: "right" }}>{t.rd_os_date_size}</span>
          </div>
          {partRow(rowOf("buyer"))}
          {partRow(rowOf("name"))}
          {partRow(rowOf("user"))}
          {/* always shown; greyed out with a short hint when this account has no QR */}
          <div data-testid="os-row-qr" data-off={p.qrAllowed ? "0" : "1"} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ flex: 1, minWidth: 0, opacity: p.qrAllowed ? 1 : 0.55 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t.rd_ps_sticker_qr}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 500 }}>{p.qrAllowed ? t.rd_os_qr_hint : t.rd_os_qr_none}</div>
            </div>
            <Switch on={p.qrAllowed && s.qr} disabled={!p.qrAllowed} aria={t.rd_ps_sticker_qr} onClick={() => setS((x) => ({ ...x, qr: !x.qr }))} testId="os-qr-on" />
          </div>
          {partRow(rowOf("comment"), true)}
        </div>

        {/* 5. reset + save */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
          <button type="button" onClick={reset} data-testid="os-reset" style={{ minHeight: TAP, padding: "6px 12px", border: "none", background: "none", color: "var(--accent-fg)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{t.rd_os_reset}</button>
        </div>
        <div data-testid="os-device-note" style={{ marginTop: 9, fontSize: 12, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.45 }}>{saved && !dirty ? t.rd_os_active_note : t.rd_os_optin_note}</div>
        <button type="button" onClick={save} disabled={!dirty || blocked} data-testid="os-save" style={{ width: "100%", marginTop: 8, padding: "13px 0", minHeight: 46, border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: dirty ? "pointer" : "default", opacity: dirty && !blocked ? 1 : 0.45, boxShadow: "0 5px 14px var(--accent-soft)" }}>{t.rd_pp_save_settings}</button>
        </div>
      </div>
      </div>
    </div>
  );
}
