// HONEST-STEPS contract (2026-07-22). The AIMO D520BT prints exactly three
// text sizes (TSPL integer magnification, UI-capped at 3); the print path has
// always quantized via printing.ts `lvl` (round+clamp). These tests pin the
// three-way honesty contract:
//   (a) the stepper walks exactly 1→2→3 with clamping (no fractional steps),
//       including when starting from a legacy fractional stored value;
//   (b) the PREVIEW and the STEP LABEL derive from the SAME mapping the print
//       path applies — asserted THROUGH buildSettingsFromRedesign (the real
//       print-settings mapper), not through a re-implemented formula;
//   (c) legacy fractional stored values DISPLAY as their print-equivalent
//       step ("1.3" shows "1×" because 1.3 already prints as 1x today);
//   (d) Date & time is fixed-size in the print path (no scale field exists in
//       Settings) → no stepper on its row, preview date never scales.
// If any of these go red, preview ≠ print again — do not weaken them.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import PrintPattern, { DEFAULT_PP, HONEST_SIZE_STEPS, stepScaleLevel, sizeLabel, previewFontPx, previewDateFontPx, SCALE_STEP_MIN, SCALE_STEP_MAX, type PrintPatternState } from "../PrintPattern";
import { printScaleLevel, buildSettingsFromRedesign } from "../../adapters/printing";
import { TProvider } from "../../i18n";

const noop = () => {};
const renderPP = (pp: PrintPatternState) =>
  render(
    <TProvider lang="en">
      <PrintPattern onBack={noop} pp={pp} onToggle={noop} onStep={noop} onTestPrint={noop} />
    </TProvider>,
  );

const mapperCfg = (pp: PrintPatternState) =>
  buildSettingsFromRedesign({ pp, psType: "bt", psOut: "sticker", psSize: "100x60mm (Standard)" });

describe("(a) step sequence is exactly 1→2→3 with clamping", () => {
  it("walks up 1→2→3 and clamps at 3", () => {
    expect(stepScaleLevel(1, 1)).toBe(2);
    expect(stepScaleLevel(2, 1)).toBe(3);
    expect(stepScaleLevel(3, 1)).toBe(3); // clamp top
  });
  it("walks down 3→2→1 and clamps at 1", () => {
    expect(stepScaleLevel(3, -1)).toBe(2);
    expect(stepScaleLevel(2, -1)).toBe(1);
    expect(stepScaleLevel(1, -1)).toBe(1); // clamp bottom
  });
  it("every step result is an integer in [1,3] — no fractional value can ever be produced", () => {
    for (let v = 0.5; v <= 3.01; v += 0.1) {
      for (const dir of [1, -1] as const) {
        const next = stepScaleLevel(v, dir);
        expect(Number.isInteger(next)).toBe(true);
        expect(next).toBeGreaterThanOrEqual(SCALE_STEP_MIN);
        expect(next).toBeLessThanOrEqual(SCALE_STEP_MAX);
      }
    }
  });
  it("legacy fractional starts snap onto the honest ladder (from the PRINTED level)", () => {
    expect(stepScaleLevel(1.3, 1)).toBe(2);  // prints as 1x today → up = 2
    expect(stepScaleLevel(1.3, -1)).toBe(1); // down clamps at 1
    expect(stepScaleLevel(2.4, 1)).toBe(3);  // prints as 2x today → up = 3
    expect(stepScaleLevel(2.5, -1)).toBe(2); // prints as 3x today → down = 2
    expect(stepScaleLevel(0.8, -1)).toBe(1); // sub-1 legacy → 1
    expect(stepScaleLevel(0.8, 1)).toBe(2);
  });
});

describe("(b) preview and label derive from the SAME mapping as the print settings", () => {
  it("printScaleLevel equals the mapper's output for every legacy value (single source, proven through the public mapper)", () => {
    // Sweep the entire legacy stepper range (0.5..3.0 in 0.1 steps). For each
    // value, the level the UI displays/previews (printScaleLevel) must equal
    // what buildSettingsFromRedesign actually puts in the print settings for
    // EVERY scale field. Any fork/drift between the two mappings goes red here.
    for (let i = 5; i <= 30; i++) {
      const v = i / 10;
      const pp = { ...DEFAULT_PP, shopNameSize: v, buyerNumSize: v, tiktokNameSize: v, tiktokUserSize: v, commentSize: v };
      const cfg = mapperCfg(pp);
      expect(cfg.printStoreScale).toBe(printScaleLevel(v));
      expect(cfg.printBuyerNumberScale).toBe(printScaleLevel(v));
      expect(cfg.printBuyerNameScale).toBe(printScaleLevel(v));
      expect(cfg.printUsernameScale).toBe(printScaleLevel(v));
      expect(cfg.printOrderScale).toBe(printScaleLevel(v));
      expect(cfg.printCommentScale).toBe(printScaleLevel(v));
    }
  });
  it("rendered preview px = base px × the mapper's printed level (fractional pp)", () => {
    const pp: PrintPatternState = { ...DEFAULT_PP, shopNameSize: 2.4, buyerNumSize: 1.5, tiktokNameSize: 1.3, tiktokUserSize: 0.8, commentSize: 3 };
    const cfg = mapperCfg(pp);
    renderPP(pp);
    expect(screen.getByText("Maria's Live Shop")).toHaveStyle({ fontSize: `${16 * cfg.printStoreScale}px` });   // 2.4 → 2 → 32px
    expect(screen.getByText("Buyer #12")).toHaveStyle({ fontSize: `${14 * cfg.printBuyerNumberScale}px` });     // 1.5 → 2 → 28px
    expect(screen.getByText("Maria Santos")).toHaveStyle({ fontSize: `${14 * cfg.printBuyerNameScale}px` });    // 1.3 → 1 → 14px
    expect(screen.getByText("@maria_live")).toHaveStyle({ fontSize: `${12 * cfg.printUsernameScale}px` });      // 0.8 → 1 → 12px
    expect(screen.getByText("Comment")).toHaveStyle({ fontSize: `${12 * cfg.printCommentScale}px` });           // 3   → 3 → 36px
  });
});

describe("(c) legacy fractional stored values display as their print-equivalent step", () => {
  const labelFor = (rowLabel: string, pp: PrintPatternState): string => {
    cleanup(); // one render per lookup — labelFor is called repeatedly in one test
    renderPP(pp);
    const row = screen.getByText(rowLabel).parentElement as HTMLElement;
    // The mono step-label span sits between the − and + buttons.
    const label = within(row).getByText(/^[0-9]+×$/);
    return label.textContent || "";
  };
  it("1.3 shows 1× · 1.5 shows 2× · 2.4 shows 2× · 0.8 shows 1× · 3 shows 3×", () => {
    expect(labelFor("Shop name", { ...DEFAULT_PP, shopNameSize: 1.3 })).toBe("1×");
    expect(labelFor("Buyer #", { ...DEFAULT_PP, buyerNumSize: 1.5 })).toBe("2×");
    expect(labelFor("TikTok name", { ...DEFAULT_PP, tiktokNameSize: 2.4 })).toBe("2×");
    expect(labelFor("TikTok username", { ...DEFAULT_PP, tiktokUserSize: 0.8 })).toBe("1×");
    expect(labelFor("Comment (center)", { ...DEFAULT_PP, commentSize: 3 })).toBe("3×");
  });
  it("never displays a fractional multiplier for any legacy value", () => {
    const pp = { ...DEFAULT_PP, shopNameSize: 1.7, buyerNumSize: 2.2, tiktokNameSize: 0.6, tiktokUserSize: 2.9, commentSize: 1.1 };
    renderPP(pp);
    expect(screen.queryByText(/\d\.\d×/)).toBeNull();
  });
});

describe("(e) KILL SWITCH — HONEST_SIZE_STEPS=false restores the EXACT old behavior", () => {
  // The verbatim pre-change formulas (copied from main), the ground truth the
  // legacy branch must match byte-for-byte in behavior.
  const oldStep = (current: number, dir: 1 | -1) => Math.min(3, Math.max(0.5, Math.round((current + dir * 0.1) * 10) / 10));
  const oldLabel = (n: number) => (n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)) + "×";

  it("the switch is ON in this build", () => {
    expect(HONEST_SIZE_STEPS).toBe(true);
  });
  it("legacy stepping === the verbatim old 0.1 formula for the whole range, both directions", () => {
    for (let i = 5; i <= 30; i++) {
      const v = i / 10;
      expect(stepScaleLevel(v, 1, false)).toBe(oldStep(v, 1));
      expect(stepScaleLevel(v, -1, false)).toBe(oldStep(v, -1));
    }
    // Spot-check the old semantics are really fractional (not the honest ladder):
    expect(stepScaleLevel(1, 1, false)).toBe(1.1);
    expect(stepScaleLevel(1, -1, false)).toBe(0.9);
    expect(stepScaleLevel(3, 1, false)).toBe(3);
    expect(stepScaleLevel(0.5, -1, false)).toBe(0.5);
  });
  it("legacy label === the verbatim old fractional label", () => {
    for (let i = 5; i <= 30; i++) {
      const v = i / 10;
      expect(sizeLabel(v, false)).toBe(oldLabel(v));
    }
    expect(sizeLabel(1.3, false)).toBe("1.3×");
    expect(sizeLabel(2, false)).toBe("2×");
  });
  it("legacy preview === the verbatim old smooth CSS scaling (Math.round(base × raw))", () => {
    for (const base of [11, 12, 14, 16]) {
      for (let i = 5; i <= 30; i++) {
        const v = i / 10;
        expect(previewFontPx(base, v, false)).toBe(Math.round(base * v));
      }
    }
    expect(previewDateFontPx(3, false)).toBe(33);   // old: date scaled with the stepper
    expect(previewDateFontPx(1.3, false)).toBe(14);
  });
  it("honest branches are unchanged by the flag plumbing (explicit true === default)", () => {
    expect(stepScaleLevel(1.3, 1, true)).toBe(stepScaleLevel(1.3, 1));
    expect(sizeLabel(1.3, true)).toBe(sizeLabel(1.3));
    expect(previewFontPx(16, 2.4, true)).toBe(previewFontPx(16, 2.4));
    expect(previewDateFontPx(3, true)).toBe(11);
  });
  it("SOURCE CONTRACT: the render routes ALL size math through the gated helpers — flipping the const rolls back everything", () => {
    const src = readFileSync(resolve(__dirname, "../PrintPattern.tsx"), "utf-8");
    // Every gated decision references the switch exactly where it must:
    expect(src).toMatch(/fixedSize: HONEST_SIZE_STEPS/);                       // Date & time stepper returns in legacy mode
    expect((src.match(/honest: boolean = HONEST_SIZE_STEPS/g) || []).length).toBe(4); // all four helpers default to the switch
    // The component body contains NO inline size arithmetic — helpers only.
    // (JSX preview must not multiply a base px by a pp value or printScaleLevel directly.)
    const jsx = src.slice(src.indexOf("export default function PrintPattern"));
    expect(jsx).not.toMatch(/Math\.round\(\s*\d+\s*\*/);
    expect(jsx).not.toMatch(/\d+\s*\*\s*printScaleLevel/);
    expect(jsx).not.toMatch(/\d+\s*\*\s*pp\./);
    expect(jsx).toMatch(/previewFontPx\(16, pp\.shopNameSize\)/);
    expect(jsx).toMatch(/previewFontPx\(14, pp\.buyerNumSize\)/);
    expect(jsx).toMatch(/previewFontPx\(14, pp\.tiktokNameSize\)/);
    expect(jsx).toMatch(/previewFontPx\(12, pp\.tiktokUserSize\)/);
    expect(jsx).toMatch(/previewFontPx\(12, pp\.commentSize\)/);
    expect(jsx).toMatch(/previewDateFontPx\(pp\.dateTimeSize\)/);
    expect(jsx).toMatch(/sizeLabel\(pp\[r\.sizeKey\]\)/);
  });
});

describe("(d) Date & time is fixed-size (dead scale control removed honestly)", () => {
  it("the Date & time row has NO stepper — it shows the Fixed size note (like Logo)", () => {
    renderPP(DEFAULT_PP);
    const row = screen.getByText("Date & time").parentElement as HTMLElement;
    expect(within(row).queryByText("−")).toBeNull();
    expect(within(row).queryByText("+")).toBeNull();
    expect(within(row).getByText("Fixed default size")).toBeTruthy();
    // Exactly 5 steppers remain (shop/buyer#/name/username/comment).
    expect(screen.getAllByText("−")).toHaveLength(5);
  });
  it("preview date never scales, even with a legacy dateTimeSize stored (matches the print path, which has no dateTime scale)", () => {
    renderPP({ ...DEFAULT_PP, dateTimeSize: 3 });
    expect(screen.getByText("Session: 05/22/2026 12:21PM")).toHaveStyle({ fontSize: "11px" });
  });
});
