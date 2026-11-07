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
  recommendedSettings, renderOneSticker, layoutSticker, SCALE_STEPS, STANDARD_SIZES, CUSTOM_MIN_MM, CUSTOM_MAX_MM, validCustomMm, isSmallClass, tooWideFor,
  type OneStickerSettings, type PartKey, type Weight, type OneStickerInput, type FitWarning,
} from "../adapters/oneSticker";
import { oneStickerFonts, renderOptsFor, type OneStickerPath } from "../adapters/oneStickerPrint";
import type { OneStickerDevicePath } from "../adapters/printing";

const ONE_STICKER_SAMPLE: OneStickerInput = {
  storeName: "", date: "11/07", time: "14:05", buyerNum: 128, name: "Maria Santos", handle: "maria_live", platform: "TikTok", items: ["COMMENT / PRICE"],
};
const sampleFor = (shopName: string): OneStickerInput => ({ ...ONE_STICKER_SAMPLE, storeName: shopName });
// the fit check uses a 4-digit buyer number (the widest a busy live reaches)
const fitSample = (shopName: string): OneStickerInput => ({ ...sampleFor(shopName), buyerNum: 8888 });

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
      setReady(true);
    });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- key covers every input
  return (
    <canvas ref={ref} data-testid="os-preview" data-ready={ready ? "1" : "0"}
      style={{ width: "100%", aspectRatio: `${settings.size.w} / ${settings.size.h}`, imageRendering: "pixelated", display: "block", background: "#fff", borderRadius: 6, boxShadow: "0 0 0 1px #d9d7e6" }} />
  );
}

/** The fit warnings of `settings` for this path (the layout only — no picture is drawn). */
function useFitWarnings(settings: OneStickerSettings, input: OneStickerInput, path: OneStickerPath, job: { bold?: boolean }): FitWarning[] {
  const [w, setW] = useState<FitWarning[]>([]);
  const key = JSON.stringify({ settings, input, path, job });
  useEffect(() => {
    let live = true;
    void oneStickerFonts(settings, input).then((fonts) => { if (live) setW(layoutSticker(settings, input, fonts, renderOptsFor(path, settings, job)).warnings); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- key covers every input
  return w;
}

const chip = (on: boolean): CSSProperties => ({ padding: "8px 11px", minHeight: 36, borderRadius: 10, border: "1px solid var(--border-strong)", background: on ? "var(--accent)" : "var(--surface)", color: on ? "var(--accent-text)" : "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", flexShrink: 0 });
const stepBtn: CSSProperties = { width: 34, height: 34, borderRadius: "50%", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--accent-fg)", fontSize: 17, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const segBtn = (on: boolean): CSSProperties => ({ flex: 1, padding: "6px 0", minHeight: 30, border: "none", borderRadius: 8, background: on ? "var(--accent)" : "transparent", color: on ? "var(--accent-text)" : "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, cursor: "pointer" });
function Switch({ on, onClick, testId, disabled }: { on: boolean; onClick: () => void; testId: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on} data-testid={testId} style={{ background: "none", border: "none", cursor: disabled ? "not-allowed" : "pointer", padding: 6, margin: -6, flexShrink: 0, opacity: disabled ? 0.4 : 1 }}>
      <span style={{ width: 42, height: 24, borderRadius: 12, background: on ? "var(--accent)" : "var(--border-strong)", position: "relative", display: "block", transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .15s" }} />
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
  const input = useMemo(() => sampleFor(p.shopName), [p.shopName]);
  const fitInput = useMemo(() => fitSample(p.shopName), [p.shopName]);
  const sEff = p.qrAllowed ? s : { ...s, qr: false };
  // fit check with a 4-digit buyer number (the widest a busy live reaches) → the red warning
  const warnings = useFitWarnings(sEff, fitInput, path, p.genericBold ? { bold: true } : {});

  const setPart = (k: PartKey, patch: Partial<OneStickerSettings["parts"][PartKey]>) => setS((x) => ({ ...x, parts: { ...x.parts, [k]: { ...x.parts[k], ...patch } } }));
  const pickSize = (w: number, h: number) => { setCustomOpen(false); setS((x) => ({ ...x, size: { w, h } })); };
  const reset = () => setS(recommendedSettings(s.size));
  const blocked = !!tooWide || (customOpen && !customOk); // a size the printer cannot take is never saved
  const save = () => { if ((!dirty && saved) || blocked) return; p.onSave(s); setBase(s); setS(s); setSaved(true); };

  const fitParts = warnings.filter((w) => w.part !== "comment" && w.part !== "qr");
  const partLabel: Record<PartKey, string> = { shop: t.rd_set_shop_name, buyer: t.rd_pp_buyer_num, name: t.rd_os_name, user: t.rd_os_user, comment: t.rd_pp_comment_center };
  const weightLabel: Record<Weight, string> = { normal: t.rd_os_w_normal, bold: t.rd_os_w_bold, extra: t.rd_os_w_extra };
  const rows: { k: PartKey; hint?: string; disabled?: boolean }[] = [
    { k: "shop", ...(small ? { hint: t.rd_os_not_small, disabled: true } : {}) },
    { k: "buyer" },
    { k: "name", hint: t.rd_os_name_fb },
    { k: "user", hint: t.rd_os_user_fb },
    { k: "comment" },
  ];
  const rowOf = (k: PartKey) => rows.find((r) => r.k === k)!;
  const partRow = (r: (typeof rows)[number], last = false) => {
            const part = s.parts[r.k];
            return (
              <div key={r.k} data-testid={`os-row-${r.k}`} style={{ padding: "10px 13px", borderBottom: last ? "none" : "1px solid var(--border)", opacity: r.disabled ? 0.55 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{partLabel[r.k]}</div>
                    {r.hint && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{r.hint}</div>}
                  </div>
                  <button type="button" onClick={() => setPart(r.k, { scale: nextStep(part.scale, -1) })} disabled={r.disabled || part.scale === SCALE_STEPS[0]} data-testid={`os-${r.k}-minus`} style={stepBtn}>−</button>
                  <span data-testid={`os-${r.k}-scale`} style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 700, color: "var(--text)", width: 40, textAlign: "center", flexShrink: 0 }}>{part.scale}×</span>
                  <button type="button" onClick={() => setPart(r.k, { scale: nextStep(part.scale, 1) })} disabled={r.disabled || part.scale === SCALE_STEPS[SCALE_STEPS.length - 1]} data-testid={`os-${r.k}-plus`} style={stepBtn}>+</button>
                  <Switch on={part.on && !r.disabled} disabled={r.disabled} onClick={() => setPart(r.k, { on: !part.on })} testId={`os-${r.k}-on`} />
                </div>
                <div style={{ display: "flex", gap: 4, marginTop: 7, padding: 3, borderRadius: 10, background: "var(--surface-2, var(--border))", maxWidth: 300 }} role="group" aria-label={partLabel[r.k]}>
                  {(["normal", "bold", "extra"] as Weight[]).map((w) => (
                    <button key={w} type="button" disabled={r.disabled} onClick={() => setPart(r.k, { weight: w })} aria-pressed={part.weight === w} data-testid={`os-${r.k}-w-${w}`} style={segBtn(part.weight === w)}>{weightLabel[w]}</button>
                  ))}
                </div>
              </div>
            );
  };
  const isStd = (w: number, h: number) => !customOpen && s.size.w === w && s.size.h === h;
  return (
    <div data-testid="os-screen">
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={p.onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "9px 12px 9px 9px", minHeight: 40, borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>{t.rd_back}</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.rd_set_live_pattern}</div>
      </div>

      <div style={{ padding: "12px 14px 18px", maxWidth: 720, margin: "0 auto" }}>
        {/* 1. the exact picture */}
        <div style={{ background: "var(--accent)", borderRadius: 16, padding: 11, boxShadow: "0 8px 22px var(--accent-soft)" }}>
          <OneStickerPreview settings={sEff} input={input} path={path} job={p.genericBold ? { bold: true } : {}} />
        </div>
        {fitParts.length > 0 && (
          <div data-testid="os-fit" style={{ marginTop: 8, padding: "9px 11px", borderRadius: 10, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12.5, fontWeight: 700, lineHeight: 1.45 }}>
            {tpl(t.rd_os_fit, { parts: [...new Set(fitParts.map((w) => partLabel[w.part as PartKey]))].join(", ") })}
          </div>
        )}
        {warnings.some((w) => w.part === "qr") && sEff.qr && <div data-testid="os-fit-qr" style={{ marginTop: 6, fontSize: 12, color: "var(--warn)" }}>{t.rd_os_fit_qr}</div>}
        {p.devicePath === "text" && <div data-testid="os-text-path" style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_os_text_path}</div>}
        {p.devicePath === "wifi" && <div data-testid="os-wifi-path" style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_os_wifi_path}</div>}

        {/* 2. test prints (today's buttons) */}
        <button onClick={() => p.onTest(sEff, "default", dirty || !saved)} data-testid="os-test" style={{ width: "100%", marginTop: 11, padding: "12px 0", minHeight: 44, border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 5px 14px var(--accent-soft)" }}>{t.rd_pp_printer_test}</button>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={() => p.onTest(sEff, "en", dirty || !saved)} data-testid="os-test-en" style={{ flex: 1, minWidth: 0, padding: "10px 6px", minHeight: 44, border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{t.rd_pp_v2_test_latin}</button>
          <button onClick={() => p.onTest(sEff, "zh", dirty || !saved)} data-testid="os-test-zh" style={{ flex: 1, minWidth: 0, padding: "10px 6px", minHeight: 44, border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{t.rd_pp_v2_test_cjk}</button>
        </div>

        {/* 3. paper size */}
        <div style={{ marginTop: 14, fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{t.rd_os_size}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 7 }} data-testid="os-sizes">
          {STANDARD_SIZES.filter((z) => customAllowed || !(z.w === 50 && z.h === 30)).map((z) => (
            <button key={`${z.w}x${z.h}`} type="button" onClick={() => pickSize(z.w, z.h)} aria-pressed={isStd(z.w, z.h)} data-testid={`os-size-${z.w}x${z.h}`} style={chip(isStd(z.w, z.h))}>{z.w}×{z.h}</button>
          ))}
          {customAllowed && <button type="button" onClick={() => setCustomOpen(true)} aria-pressed={customOpen} data-testid="os-size-custom" style={chip(customOpen)}>{t.rd_os_custom}</button>}
        </div>
        {!customAllowed && <div data-testid="os-custom-hidden" style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-muted)" }}>{t.rd_os_custom_hidden}</div>}
        {customAllowed && customOpen && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, flexWrap: "wrap" }} data-testid="os-custom">
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--text-muted)", flex: "1 1 120px" }}>{t.rd_os_width}
              <input inputMode="numeric" value={customW} onChange={(e) => setCustomW(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} data-testid="os-custom-w" style={{ fontSize: 16, padding: "9px 10px", borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", minWidth: 0 }} />
            </label>
            <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text-muted)", paddingTop: 16 }}>×</span>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--text-muted)", flex: "1 1 120px" }}>{t.rd_os_height}
              <input inputMode="numeric" value={customH} onChange={(e) => setCustomH(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} data-testid="os-custom-h" style={{ fontSize: 16, padding: "9px 10px", borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", minWidth: 0 }} />
            </label>
            {!customOk && <div data-testid="os-custom-err" style={{ flexBasis: "100%", fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>{tpl(t.rd_os_custom_err, { min: String(CUSTOM_MIN_MM), max: String(CUSTOM_MAX_MM) })}</div>}
          </div>
        )}
        {tooWide && <div data-testid="os-too-wide" style={{ marginTop: 7, fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>{tpl(t.rd_os_too_wide, { model: tooWide.model, max: String(tooWide.maxLabelMm) })}</div>}

        {/* 4. one row per part */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden", marginTop: 13 }}>
          {/* the approved preview's order: Shop name → Date & time → Buyer # → Name → @username → Print QR → Comment / Price */}
          {partRow(rowOf("shop"))}
          <div data-testid="os-row-date" style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_pp_date_time}</span>
            <span style={{ fontSize: 11.5, fontStyle: "italic", color: "var(--text-muted)", textAlign: "right" }}>{t.rd_os_date_fixed}</span>
          </div>
          {partRow(rowOf("buyer"))}
          {partRow(rowOf("name"))}
          {partRow(rowOf("user"))}
          {p.qrAllowed && (
            <div data-testid="os-row-qr" style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_ps_sticker_qr}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{t.rd_os_qr_hint}</div>
              </div>
              <Switch on={s.qr} onClick={() => setS((x) => ({ ...x, qr: !x.qr }))} testId="os-qr-on" />
            </div>
          )}
          {partRow(rowOf("comment"), true)}
        </div>

        {/* 5. reset + save */}
        <button type="button" onClick={reset} data-testid="os-reset" style={{ width: "100%", marginTop: 12, padding: "11px 0", minHeight: 44, border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{t.rd_os_reset}</button>
        <div data-testid="os-device-note" style={{ marginTop: 9, fontSize: 12, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.45 }}>{saved && !dirty ? t.rd_os_active_note : t.rd_os_optin_note}</div>
        <button type="button" onClick={save} disabled={!dirty || blocked} data-testid="os-save" style={{ width: "100%", marginTop: 8, padding: "13px 0", minHeight: 46, border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: dirty ? "pointer" : "default", opacity: dirty && !blocked ? 1 : 0.45, boxShadow: "0 5px 14px var(--accent-soft)" }}>{t.rd_pp_save_settings}</button>
      </div>
    </div>
  );
}
