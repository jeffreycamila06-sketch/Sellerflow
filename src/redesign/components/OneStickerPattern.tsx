// ONE STICKER — the NEW Live print pattern screen (switch one_sticker_enabled; admins before).
// Same screen on iPhone, Android and laptop. On top: the EXACT picture this device's printer path
// prints (oneSticker.ts — the same function the print uses), then "Sticker size: W×H mm · Change" (the size is
// chosen ONLY in Printer settings — Jeff 2026-11-10; Change opens it). Below: Printer Test (+ the two long
// comment tests, ADMIN only), one row per part (weight · size · on/off), the fixed date row, the QR row,
// "Reset to recommended" and "Save settings".
// Saving is what switches THIS device to the new sticker (oneStickerPrint.saveOneSticker); until
// then the device keeps today's sticker.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { BackButton } from "./BackButton";
import {
  recommendedSettings, renderOneSticker, SCALE_STEPS, qrSizeOk, isSmallClass, tooWideFor, NOTE_TONE,
  type OneStickerSettings, type PartKey, type Weight, type OneStickerInput, type FitWarning, type FitNote,
} from "../adapters/oneSticker";
import { oneStickerScreenFonts, renderOptsFor, sampleInput, AUTO_SAVE_PATHS, type OneStickerPath } from "../adapters/oneStickerPrint";
import type { OneStickerDevicePath } from "../adapters/printing";
import { cachedFit, rememberFit, startScreenFit, type StepCaps } from "../adapters/oneStickerScreen";
import { ADMIN_LANG_SAMPLES, ADMIN_DEFAULT_SAMPLE, adminSampleInput, type AdminLangSample } from "../adapters/adminLangSamples";
import { STICKER_VIEWS, viewSampleInput, type StickerView } from "../adapters/stickerViewSample";

const sameSettings = (a: OneStickerSettings, b: OneStickerSettings) => JSON.stringify(a) === JSON.stringify(b);
const nextStep = (v: number, dir: 1 | -1): number => {
  const i = SCALE_STEPS.findIndex((s) => s === v);
  const j = Math.max(0, Math.min(SCALE_STEPS.length - 1, (i < 0 ? SCALE_STEPS.indexOf(1) : i) + dir));
  return SCALE_STEPS[j];
};
const pathForPreview = (p: OneStickerDevicePath): OneStickerPath => (p === "text" || p === "wifi" ? "laptop" : p);

/** The exact picture of `settings` for this device's path (async: the fonts are lazy chunks). */
export function OneStickerPreview({ settings, input, path, job, onWarnings, onFailed, onRetry }: { settings: OneStickerSettings; input: OneStickerInput; path: OneStickerPath; job?: { bold?: boolean }; onWarnings?: (w: FitWarning[]) => void; onFailed?: (failed: boolean) => void; onRetry?: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const key = JSON.stringify({ settings, input, path, job });
  const [ready, setReady] = useState(false);
  // any face the picture needs did not load → a short message + Try again (never a device-font picture)
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // a new setting is a new try: the failure belongs to the settings it happened on
  const [failedKey, setFailedKey] = useState(key);
  if (failedKey !== key) { setFailedKey(key); if (failed) setFailed(false); }
  const t = useT();
  useEffect(() => { onFailed?.(failed); }, [failed]); // eslint-disable-line react-hooks/exhaustive-deps -- report the state only
  useEffect(() => {
    let live = true;
    void oneStickerScreenFonts(settings, input).then((fonts) => {
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
      <button type="button" data-testid="os-preview-retry" onClick={() => { setFailed(false); setAttempt((a) => a + 1); onRetry?.(); }} style={{ minHeight: TAP, padding: "6px 14px", borderRadius: 10, border: "1px solid #d9d7e6", background: "#fff", color: "#4F46E5", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{t.rd_os_try_again}</button>
    </div>
  );
  return (
    <canvas ref={ref} data-testid="os-preview" data-ready={ready ? "1" : "0"}
      // a tall / square custom label never pushes the screen down: at most min(60vh, 420 px) high, same shape
      style={{ width: "auto", height: "auto", maxWidth: "100%", maxHeight: "min(60vh, 420px)", aspectRatio: `${settings.size.w} / ${settings.size.h}`, imageRendering: "pixelated", display: "block", background: "#fff", borderRadius: 6, boxShadow: "0 0 0 1px #d9d7e6" }} />
  );
}

/** The notes under the preview + the "+" limits for `settings` on this path (the preview's own sample and
 *  the worst-case buyers — layouts only, no picture). Worked out in idle slices (never a frozen screen)
 *  and kept per setting; `caps` is null while the limits for THIS setting are not known yet. */
function useFitNotes(settings: OneStickerSettings, input: OneStickerInput, path: OneStickerPath, job: { bold?: boolean }, attempt: number, onLimits?: (key: string, caps: StepCaps) => void): { notes: FitNote[] | null; caps: StepCaps | null; key: string } {
  const [st, setSt] = useState<{ key: string; notes: FitNote[] | null; caps: StepCaps | null }>({ key: "", notes: [], caps: null }); // notes null = the fonts did not load (no notes shown)
  const key = JSON.stringify({ settings, input, path, job });
  const limitsRef = useRef(onLimits);
  useEffect(() => { limitsRef.current = onLimits; });
  const hit = cachedFit(key);
  useEffect(() => {
    let live = true;
    const known = cachedFit(key);
    if (known) { queueMicrotask(() => { if (live) limitsRef.current?.(key, known.caps); }); return () => { live = false; }; }
    // the sample (#128), the buyer number at its widest (#8888) and the worst-case buyers (tall Vietnamese /
    // Thai marks, Chinese, a 2-line Facebook name, a short handle, low-hanging comment letters): a real buyer
    // never needs a line made smaller while the screen says everything fits, and "+" stops at the largest size
    // that always fits. Measured on the real faces (a script only the phone's own font draws, e.g. Thai, is
    // measured with that font — the same one the print uses on this phone).
    let cancel = () => {};
    void oneStickerScreenFonts(settings, input).then((fonts) => {
      if (!live) return;
      cancel = startScreenFit(settings, input, fonts, renderOptsFor(path, settings, job),
        (notes) => { if (live) setSt({ key, notes, caps: null }); },
        (fit) => { rememberFit(key, fit); if (live) { setSt({ key, notes: fit.notes, caps: fit.caps }); limitsRef.current?.(key, fit.caps); } });
    }).catch(() => { if (live) setSt({ key, notes: null, caps: {} }); });
    return () => { live = false; cancel(); };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps -- key covers every input
  if (hit) return { notes: hit.notes, caps: hit.caps, key };
  if (st.key === key) return { notes: st.notes, caps: st.caps, key };
  return { notes: st.notes, caps: null, key }; // the last notes stay up while this setting is worked out
}

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
.os-note{font-size:12px;font-weight:600;padding:4px 9px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text-muted);line-height:1.4}
.os-note[data-tone="ok"]{color:#0F8A5F;border-color:#9DDCC4}
.os-note[data-tone="warn"]{color:#9A5C00;border-color:#F0CF92}
.os-note[data-tone="bad"]{color:#C2342B;border-color:#F2B1AB}
[data-theme="dark"] .os-note[data-tone="ok"]{color:#3DD39B;border-color:#245C48}
[data-theme="dark"] .os-note[data-tone="warn"]{color:#F2B451;border-color:#5E4A20}
[data-theme="dark"] .os-note[data-tone="bad"]{color:#FF7A70;border-color:#5E2A27}
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
const STEP_OVERHANG = 6, SWITCH_OVERHANG = 4; // how far each 44 px tap area reaches past its own slot
const tapBox: CSSProperties = { minWidth: TAP, minHeight: TAP, background: "none", border: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, fontFamily: "var(--font-ui)" };
function StepBtn({ label, onClick, disabled, testId, aria }: { label: string; onClick: () => void; disabled?: boolean; testId: string; aria: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testId} aria-label={aria} style={{ ...tapBox, margin: `0 -${STEP_OVERHANG}px`, cursor: disabled ? "default" : "pointer" }}>
      <span style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid var(--border-strong)", color: "var(--accent-fg)", fontSize: 16, fontWeight: 700, display: "grid", placeItems: "center", lineHeight: 1, opacity: disabled ? 0.35 : 1 }}>{label}</span>
    </button>
  );
}
function Switch({ on, onClick, testId, disabled, aria }: { on: boolean; onClick: () => void; testId: string; disabled?: boolean; aria?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={aria} onClick={onClick} disabled={disabled} aria-pressed={on} data-testid={testId} style={{ ...tapBox, minWidth: 54, margin: `0 -${SWITCH_OVERHANG}px`, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1 }}>
      <span style={{ width: 46, height: 28, borderRadius: 14, background: on ? "var(--accent)" : "var(--border-strong)", position: "relative", display: "block", transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .15s" }} />
      </span>
    </button>
  );
}

export interface OneStickerPatternProps {
  onBack: () => void;
  initial: OneStickerSettings;     // saved settings, or a seed from today's pattern
  // ONE PLACE (Jeff 2026-11-10): the size chosen in Printer settings → Sticker size (oneStickerSizeNow). The
  // preview, the test prints and Save always use it; this screen has no size controls.
  size?: { w: number; h: number; custom?: boolean }; // (absent = the initial settings' size)
  onChangeSize?: () => void;       // "Change" → Printer settings (the draft below is kept for the way back)
  draft?: OneStickerSettings | null; // unsaved edits from before the seller went to change the size
  onDraft?: (s: OneStickerSettings) => void;
  savedOnDevice: boolean;          // this device already prints the new sticker
  onSave: (s: OneStickerSettings) => void;
  shopName: string;                // the seller's own shop name ("" = none — never the brand)
  devicePath: OneStickerDevicePath;
  printerName?: string | null;     // the saved Bluetooth printer (size limit warning)
  printerLimit?: { model: string; maxLabelMm: number } | null; // the widest label it takes (oneStickerLimitFor — an unknown Niimbot = 50 mm); absent = tooWideFor(printerName)
  genericBold?: boolean;           // the saved printer gets the 1-dot ink (Y41BT / XP-420B)
  qrAllowed: boolean;              // "Print QR on sticker" is available for this account
  // `view` is passed ONLY for Printer Test in the Facebook view (TikTok view = today's three arguments)
  onTest: (draft: OneStickerSettings, sample: "default" | "en" | "zh", unsaved: boolean, view?: StickerView) => void;
  onToast?: (msg: string) => void; // a short message (Reset → "Back to recommended settings")
  // ADMIN ONLY (never shown to sellers, whatever the switches): the language test chips + "New / Today's
  // sticker". Printer Test then prints the picked sample through the normal print functions.
  isAdmin?: boolean;
  onTestSample?: (draft: OneStickerSettings, sample: AdminLangSample, route: "new" | "today", unsaved: boolean) => void;
}

export default function OneStickerPattern(p: OneStickerPatternProps) {
  const t = useT();
  const [s0, setS] = useState<OneStickerSettings>(p.draft ?? p.initial);
  const [base0, setBase] = useState<OneStickerSettings>(p.initial); // what Save compares against (its size = the Printer settings size)
  const z = p.size ?? p.initial.size;
  const size = z.custom ? { w: z.w, h: z.h, custom: true as const } : { w: z.w, h: z.h };
  const base: OneStickerSettings = { ...base0, size };
  const [saved, setSaved] = useState(p.savedOnDevice);
  // saved on this phone while the screen is open (the auto-save landed after it opened) → the note follows at once
  // (adjusted during render, not an effect; the seller's edits are kept — never a remount)
  const [savedProp, setSavedProp] = useState(p.savedOnDevice);
  if (p.savedOnDevice !== savedProp) { setSavedProp(p.savedOnDevice); if (p.savedOnDevice) setSaved(true); }
  // the draft always has the Printer settings size (never its own)
  const s1: OneStickerSettings = { ...s0, size };
  // QR only on a label ≥ 50×30 mm (Jeff 2026-11-10): below it the QR is OFF (and saved OFF); a bigger size later
  // does NOT turn it back on — the draft is set OFF while the size is below (adjusted during render, no effect)
  const qrSizeAllowed = qrSizeOk(size);
  if (!qrSizeAllowed && s0.qr) setS((x) => ({ ...x, qr: false }));
  const s: OneStickerSettings = qrSizeAllowed ? s1 : { ...s1, qr: false };
  const draftRef = useRef(p.onDraft);
  useEffect(() => { draftRef.current = p.onDraft; });
  useEffect(() => { draftRef.current?.(s); }, [JSON.stringify(s)]); // eslint-disable-line react-hooks/exhaustive-deps -- report each new draft
  const path = pathForPreview(p.devicePath);
  const customAllowed = p.devicePath !== "text" && p.devicePath !== "wifi";
  const olderPath = !customAllowed; // TEXT / WiFi: this phone keeps printing the older sticker
  const dirty = !sameSettings(s, base);
  const small = isSmallClass(s.size.w, s.size.h);
  const tooWide = p.printerLimit !== undefined ? (p.printerLimit && s.size.w > p.printerLimit.maxLabelMm ? p.printerLimit : null) : tooWideFor(p.printerName, s.size.w);
  // the preview's sample (#128 Maria Santos @maria_live, today's Taipei date & time) — the same one the
  // test buttons print and the same one the notes are measured on
  const admin = p.isAdmin === true && !!p.onTestSample;
  // the two long-comment tests are for ADMINS only (Jeff 2026-11-10); a seller has Printer Test only
  const longTests = p.isAdmin === true;
  const [langKey, setLangKey] = useState<string | null>(null);
  const [route, setRoute] = useState<"new" | "today">("new");
  const adminSample = admin && langKey ? ADMIN_LANG_SAMPLES.find((x) => x.key === langKey) ?? null : null;
  // TikTok / Facebook view: which sample buyer is shown and test-printed. Always TikTok when the screen
  // opens; never saved. An admin language chip is its own sample (unchanged).
  const [view0, setView] = useState<StickerView>("tiktok");
  // admin: Printer Test prints the picked sample (or the screen's own) on the chosen sticker
  const adminTesting = admin && (!!adminSample || route === "today");
  // an admin test (a language chip / "Today's sticker") is its own sample, exactly as before: the view rests
  // on TikTok and its buttons are off until the admin test is cleared (admins only — a seller never has one)
  const view: StickerView = adminTesting ? "tiktok" : view0;
  const input = useMemo(() => (adminSample ? adminSampleInput(adminSample, p.shopName) : view === "facebook" ? viewSampleInput("facebook", p.shopName) : sampleInput(p.shopName)), [p.shopName, adminSample, view]);
  const sEff = p.qrAllowed ? s : { ...s, qr: false };
  const [pvAttempt, setPvAttempt] = useState(0);
  const [pvFailed, setPvFailed] = useState(false);
  // A (Jeff): after a paper size change or turning the QR on, a Buyer # above its new limit is lowered to
  // the largest size that fits (a short note says so)
  const sizeQr = `${sEff.size.w}x${sEff.size.h}|${sEff.qr ? 1 : 0}`;
  // back from Printer settings with a new size: the draft's old size counts as the previous one (Buyer # is lowered there too)
  const prevSizeQr = useRef<string | null>(p.draft ? `${p.draft.size.w}x${p.draft.size.h}|${p.draft.qr && p.qrAllowed ? 1 : 0}` : null);
  const lowerPending = useRef(false);
  const [lowered, setLowered] = useState(false);
  useEffect(() => {
    const prev = prevSizeQr.current;
    prevSizeQr.current = sizeQr;
    if (prev === null || prev === sizeQr) return;
    const [pSize, pQr] = prev.split("|"), [nSize, nQr] = sizeQr.split("|");
    if (pSize !== nSize || (pQr === "0" && nQr === "1")) lowerPending.current = true;
  }, [sizeQr]);
  const fitKeyRef = useRef("");
  const onLimits = (key: string, caps: StepCaps) => {
    if (key !== fitKeyRef.current || !lowerPending.current) return;
    lowerPending.current = false;
    const cap = caps.buyer;
    if (cap == null) return;
    if (s0.parts.buyer.scale <= cap) return; // (the latest render's settings: onLimits is read through a ref)
    setS((x) => ({ ...x, parts: { ...x.parts, buyer: { ...x.parts.buyer, scale: Math.min(x.parts.buyer.scale, cap) } } }));
    setLowered(true);
  };
  const { notes, caps, key: fitKey } = useFitNotes(sEff, input, path, p.genericBold ? { bold: true } : {}, pvAttempt, onLimits);
  useEffect(() => { fitKeyRef.current = fitKey; }, [fitKey]);
  const showNotes = !pvFailed && notes !== null; // never "Everything fits" while the picture can't load

  const setPart = (k: PartKey, patch: Partial<OneStickerSettings["parts"][PartKey]>) => { setLowered(false); setS((x) => ({ ...x, parts: { ...x.parts, [k]: { ...x.parts[k], ...patch } } })); };
  // a fixed part's "+" waits until its limit for THIS setting is known (a fast second tap, the first load);
  // the comment has no limit (it always gives way)
  const plusBlocked = (k: PartKey, scale: number) => k !== "comment" && (caps == null || (caps[k] != null && scale >= caps[k]!));
  // the "lowered" note belongs to the change that lowered Buyer # — any other change clears it
  const reset = () => { setLowered(false); setS(recommendedSettings(s.size)); p.onToast?.(t.rd_os_reset_done); };
  // a size the printer cannot take is never saved (too wide, or 50×30 / custom on a TEXT / WiFi phone, which
  // has no such layout) — the size is changed in Printer settings
  const blocked = !!tooWide || (!customAllowed && (!!s.size.custom || (s.size.w === 50 && s.size.h === 30)));
  // Save: on a device that has NOT saved the new sticker yet, always on (the seller can adopt what they
  // see); after saving, off until something changes (Jeff). Never while the size can't be printed.
  const canSave = (dirty || !saved) && !blocked;
  const save = () => { if (!canSave) return; p.onSave(s); setBase(s); setS(s); setSaved(true); };

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
          {/* gap = the "+" area's 6 px overhang + the switch area's 4 px overhang: the two tap areas touch, never overlap */}
          <div className="os-row-ctl" data-testid={`os-${r.k}-ctl`} style={{ display: "flex", alignItems: "center", gap: STEP_OVERHANG + SWITCH_OVERHANG }}>
            <div data-testid={`os-${r.k}-stepper`} style={{ display: "flex", alignItems: "center", opacity: off ? 0.4 : 1 }}>
              <StepBtn label="−" aria={`${partLabel[r.k]} −`} onClick={() => setPart(r.k, { scale: nextStep(part.scale, -1) })} disabled={off || part.scale === SCALE_STEPS[0]} testId={`os-${r.k}-minus`} />
              <span data-testid={`os-${r.k}-scale`} style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--text)", minWidth: 36, textAlign: "center", flexShrink: 0 }}>{part.scale}×</span>
              <StepBtn label="+" aria={`${partLabel[r.k]} +`} onClick={() => setPart(r.k, { scale: nextStep(part.scale, 1) })} disabled={off || part.scale === SCALE_STEPS[SCALE_STEPS.length - 1] || plusBlocked(r.k, part.scale)} testId={`os-${r.k}-plus`} />
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
  return (
    <div data-testid="os-screen">
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <BackButton onClick={p.onBack} />
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.rd_set_live_pattern}</div>
      </div>

      <style>{OS_CSS}</style>
      <div className="os-wrap">
      <div className="os-body" data-testid="os-body">
        <div className="os-pv" data-testid="os-pv-col">
        {/* the view: TikTok · Facebook · Instagram (Soon) · Shopee (Soon) — one row, above the preview */}
        <div role="group" aria-label={t.rd_os_view_aria} data-testid="os-view" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4, padding: 4, marginBottom: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}>
          {STICKER_VIEWS.map((v) => {
            const on = !v.soon && !adminTesting && view === v.key;
            return (
              <button key={v.key} type="button" disabled={v.soon || adminTesting} aria-pressed={on} data-testid={`os-view-${v.key}`} onClick={() => { if (!v.soon && !adminTesting) setView(v.key as StickerView); }}
                style={{ minHeight: TAP, padding: "4px 2px", border: "none", borderRadius: 9, background: on ? "var(--accent)" : "transparent", color: on ? "var(--accent-text)" : v.soon ? "var(--text-muted)" : "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: v.soon ? "default" : "pointer", display: "grid", placeItems: "center", gap: 2, opacity: v.soon ? 0.75 : 1, minWidth: 0 }}>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{v.label}</span>
                {v.soon && <span data-testid={`os-view-${v.key}-soon`} style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", padding: "1px 4px", borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent-fg)", whiteSpace: "normal", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{t.rd_soon}</span>}
              </button>
            );
          })}
        </div>
        {/* 1. the exact picture */}
        <div style={{ background: "var(--accent)", borderRadius: 16, padding: 11, boxShadow: "0 8px 22px var(--accent-soft)", display: "grid", gap: 8, justifyItems: "center" }}>
          <OneStickerPreview settings={sEff} input={input} path={path} job={p.genericBold ? { bold: true } : {}} onFailed={setPvFailed} onRetry={() => setPvAttempt((a) => a + 1)} />
        </div>
        {/* the size: chosen ONLY in Printer settings (Jeff 2026-11-10) — one line + Change */}
        <div data-testid="os-size-line" style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", columnGap: 4, marginTop: 4, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          <span data-testid="os-size-text" style={{ fontVariantNumeric: "tabular-nums" }}>{tpl(t.rd_os_size_line, { w: String(s.size.w), h: String(s.size.h) })}</span>
          <span aria-hidden="true" style={{ color: "var(--text-muted)" }}>·</span>
          <button type="button" onClick={p.onChangeSize} data-testid="os-size-change" style={{ minHeight: TAP, padding: "0 8px", border: "none", background: "none", color: "var(--accent-fg)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>{t.rd_os_change}</button>
        </div>
        {tooWide && <div data-testid="os-too-wide" style={{ marginTop: 2, fontSize: 12, fontWeight: 700, color: "var(--danger)", textAlign: "center" }}>{tpl(t.rd_os_too_wide, { model: tooWide.model, max: String(tooWide.maxLabelMm) })}</div>}
        {showNotes && <div data-testid="os-notes" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {lowered && <span className="os-note" data-tone="warn" data-testid="os-note-lowered">{t.rd_os_note_buyer_lowered}</span>}
          {notes.map((n, i) => (
            <span key={i} className="os-note" data-tone={NOTE_TONE[n.kind]} data-testid={n.kind === "bad" ? "os-fit" : n.kind === "qr" ? "os-fit-qr" : `os-note-${n.kind}`}>
              {n.kind === "bad" ? tpl(t.rd_os_fit, { parts: n.parts.map((k) => partLabel[k]).join(", ") })
                : n.kind === "shrunk" ? tpl(t.rd_os_note_shrunk, { pct: String(n.pct) })
                : n.kind === "cut" ? t.rd_os_note_cut
                : n.kind === "smaller" ? tpl(t.rd_os_note_smaller, { parts: n.parts.map((k) => partLabel[k]).join(", ") })
                : n.kind === "short" ? tpl(t.rd_os_note_short, { parts: n.parts.map((k) => partLabel[k]).join(", ") })
                : n.kind === "qr" ? t.rd_os_fit_qr
                : n.kind === "small" ? t.rd_os_note_small
                : t.rd_os_note_ok}
            </span>
          ))}
        </div>}
        {admin && route === "today" && <div data-testid="os-admin-today-note" style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "var(--text-muted)", lineHeight: 1.45 }}>{p.devicePath === "text" || p.devicePath === "wifi"
          ? "Today's sticker selected: Printer Test prints this sample on today's text sticker, at your Printer settings size. This printer has no language fix (other scripts print as the @username, as today). The picture above is the new sticker."
          : "Today's sticker selected: Printer Test prints this sample on today's sticker, at your Printer settings size, with the language fix. The picture above is the new sticker."}</div>}
        {p.devicePath === "text" && <div data-testid="os-text-path" style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_os_text_path}</div>}
        {p.devicePath === "wifi" && <div data-testid="os-wifi-path" style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_os_wifi_path}</div>}

        {/* 2. test prints (today's buttons) */}
        <button onClick={() => (adminTesting ? p.onTestSample!(sEff, adminSample ?? ADMIN_DEFAULT_SAMPLE, route, dirty || !saved) : view === "facebook" ? p.onTest(sEff, "default", dirty || !saved, "facebook") : p.onTest(sEff, "default", dirty || !saved))} data-testid="os-test" style={{ width: "100%", marginTop: 11, padding: "12px 0", minHeight: 44, border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 5px 14px var(--accent-soft)" }}><span aria-hidden="true">🖨 </span>{t.rd_pp_printer_test}</button>
        {longTests && <div data-testid="os-long-tests" style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={() => p.onTest(sEff, "en", dirty || !saved)} data-testid="os-test-en" style={{ flex: 1, minWidth: 0, padding: "10px 6px", minHeight: 44, border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{t.rd_pp_v2_test_latin}</button>
          <button onClick={() => p.onTest(sEff, "zh", dirty || !saved)} data-testid="os-test-zh" style={{ flex: 1, minWidth: 0, padding: "10px 6px", minHeight: 44, border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{t.rd_pp_v2_test_cjk}</button>
        </div>}
        {admin && (
          <div data-testid="os-admin-lang" style={{ marginTop: 12, padding: 10, border: "1px dashed var(--border-strong)", borderRadius: 12, background: "var(--surface)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--text-muted)" }}>Admin: language test</div>
            <div role="group" aria-label="Sticker to test" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {(["new", "today"] as const).map((r) => (
                <button key={r} type="button" onClick={() => setRoute(r)} aria-pressed={route === r} data-testid={`os-admin-route-${r}`} style={chip(route === r)}>{r === "new" ? "New sticker" : "Today's sticker"}</button>
              ))}
            </div>
            <div role="group" aria-label="Language sample" data-testid="os-admin-chips" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {ADMIN_LANG_SAMPLES.map((x) => (
                <button key={x.key} type="button" onClick={() => setLangKey((k) => (k === x.key ? null : x.key))} aria-pressed={langKey === x.key} data-testid={`os-admin-lang-${x.key}`} style={chip(langKey === x.key)}>{x.label}</button>
              ))}
            </div>
            <div style={{ marginTop: 7, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>Tap a language to preview it; Printer Test prints it. Tap again for the normal sample.</div>
          </div>
        )}

        </div>
        <div className="os-ctl" data-testid="os-ctl-col">
        {/* 4. one row per part */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
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
          <div data-testid="os-row-qr" data-off={p.qrAllowed && qrSizeAllowed ? "0" : "1"} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ flex: 1, minWidth: 0, opacity: p.qrAllowed && qrSizeAllowed ? 1 : 0.55 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t.rd_ps_sticker_qr}</div>
              <div data-testid="os-qr-sub" style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 500 }}>{!p.qrAllowed ? t.rd_os_qr_none : !qrSizeAllowed ? t.rd_os_qr_min_size : t.rd_os_qr_hint}</div>
            </div>
            <Switch on={p.qrAllowed && s.qr} disabled={!p.qrAllowed || !qrSizeAllowed} aria={t.rd_ps_sticker_qr} onClick={() => { if (!qrSizeAllowed) return; setLowered(false); setS((x) => ({ ...x, qr: !x.qr })); }} testId="os-qr-on" />
          </div>
          {partRow(rowOf("comment"), true)}
        </div>

        {/* 5. reset + save */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
          <button type="button" onClick={reset} data-testid="os-reset" style={{ minHeight: TAP, padding: "6px 12px", border: "none", background: "none", color: "var(--accent-fg)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{t.rd_os_reset}</button>
        </div>
        <div data-testid="os-device-note" style={{ marginTop: 9, fontSize: 12, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.45 }}>{/* "automatically" ONLY once the new sticker is saved on this phone (Jeff 2026-11-10); not saved yet → tap Save */}
          {/* a TEXT / WiFi phone prints the older sticker whatever is saved: its own note above says so — ONE note, never
              also "This device prints this sticker" / "used after you tap Save" (Jeff 2026-11-10) */}
          {olderPath ? null : saved ? (dirty ? t.rd_os_unsaved_note : AUTO_SAVE_PATHS.includes(p.devicePath) ? t.rd_os_auto_note : t.rd_os_active_note)
            : p.devicePath === "laptop" ? t.rd_os_optin_note : AUTO_SAVE_PATHS.includes(p.devicePath) ? t.rd_os_phone_save_note : null}</div>
        <button type="button" onClick={save} disabled={!canSave} data-testid="os-save" style={{ width: "100%", marginTop: 8, padding: "13px 0", minHeight: 46, border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: canSave ? "pointer" : "default", opacity: canSave ? 1 : 0.45, boxShadow: "0 5px 14px var(--accent-soft)" }}>{t.rd_pp_save_settings}</button>
        </div>
      </div>
      </div>
    </div>
  );
}
