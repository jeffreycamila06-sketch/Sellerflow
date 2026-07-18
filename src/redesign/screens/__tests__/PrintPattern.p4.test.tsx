// P4 — LIVE print pattern settings UX (per-field weight + Large-print preset +
// size-aware chip + honest fit note). The HARD requirement under test is
// BACKWARD COMPAT: a pattern saved BEFORE the weight keys existed must produce
// the exact P3-hierarchy weights (buyer#/name/@user prominent, store/price
// plain) all the way into the native payload — the ~38 sellers' saved settings
// must not change their sticker output. (The native half of the same guarantee
// — absent weightsRaw == explicit defaults, byte-for-byte — is pinned by the
// JVM Phomemo241ParityTest.testP4WeightRouting.)
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { TProvider } from "../../i18n";
import PrintPattern, { DEFAULT_PP, type PrintPatternState } from "../PrintPattern";
import { normalizePp, applyLargePreset, patternFitHint } from "../../adapters/printPattern";
import { buildSettingsFromRedesign, buildWeightsRaw, withRasterExtras, buildNativeStickerPayload, parseStickerSize, DEF_SETTINGS } from "../../adapters/printing";
import { buildTestBuyer } from "../../adapters/printerBridge";

// A pattern as saved by a PRE-P4 build: no weight keys at all.
const LEGACY_PP = { shopName: true, shopNameSize: 1.2, dateTime: true, dateTimeSize: 1, buyerNum: true, buyerNumSize: 2, tiktokName: true, tiktokNameSize: 1, tiktokUser: false, tiktokUserSize: 1, comment: true, commentSize: 1 };

describe("P4 backward compat — pre-P4 saved patterns keep the P3 hierarchy", () => {
  it("normalizePp fills missing weight keys with the P3 defaults, keeps saved values", () => {
    const pp = normalizePp(LEGACY_PP);
    expect(pp.buyerNumBold).toBe(true);
    expect(pp.tiktokNameBold).toBe(true);
    expect(pp.tiktokUserBold).toBe(true);
    expect(pp.shopNameBold).toBe(false);
    expect(pp.commentBold).toBe(false);
    expect(pp.buyerNumSize).toBe(2);      // saved sizes survive
    expect(pp.tiktokUser).toBe(false);    // saved toggles survive
  });

  it("normalizePp tolerates garbage", () => {
    expect(normalizePp(null)).toEqual(DEFAULT_PP);
    expect(normalizePp("x")).toEqual(DEFAULT_PP);
  });

  it("a legacy pp flows into Settings as the exact P3-hierarchy weights", () => {
    const s = buildSettingsFromRedesign({ pp: LEGACY_PP, psType: "bt", psOut: "sticker", psSize: "60x40mm" });
    expect(s.printBuyerNumberBold).toBe(true);
    expect(s.printBuyerNameBold).toBe(true);
    expect(s.printUsernameBold).toBe(true);
    expect(s.printStoreBold).toBe(false);
    expect(s.printCommentBold).toBe(false);
  });

  it("the byte-parity-locked native payload itself carries NO weight fields (extras are additive)", () => {
    const s = buildSettingsFromRedesign({ pp: DEFAULT_PP, psType: "bt", psOut: "sticker", psSize: "60x40mm" });
    const payload = buildNativeStickerPayload(buildTestBuyer(), "NT$", "Shop", s);
    expect(JSON.stringify(payload)).not.toContain("Bold");
    expect((payload as Record<string, unknown>).weightsRaw).toBeUndefined();
  });

  it("DEF_SETTINGS (App.tsx copy) has no weight fields -> buildWeightsRaw undefined -> old payload shape unchanged", () => {
    expect(buildWeightsRaw(DEF_SETTINGS)).toBeUndefined();
    const p = withRasterExtras({ a: 1 }, DEF_SETTINGS);
    expect(p).toEqual({ a: 1 });
  });
});

describe("P4 weightsRaw plumbing (the scalesRaw delivery pattern)", () => {
  it("buildWeightsRaw maps the Settings weights onto the native fork's keys", () => {
    const s = buildSettingsFromRedesign({ pp: { ...DEFAULT_PP, shopNameBold: true, buyerNumBold: false }, psType: "bt", psOut: "sticker", psSize: "60x40mm" });
    expect(buildWeightsRaw(s)).toEqual({ store: true, buyerNum: false, name: true, username: true, comment: false });
  });

  it("withRasterExtras attaches weightsRaw AND scalesRaw as additive top-level fields", () => {
    const s = buildSettingsFromRedesign({ pp: DEFAULT_PP, psType: "bt", psOut: "sticker", psSize: "60x40mm" });
    const p = withRasterExtras({ base: true }, s) as Record<string, unknown>;
    expect(p.base).toBe(true);
    expect(p.weightsRaw).toEqual({ store: false, buyerNum: true, name: true, username: true, comment: false });
    expect(p.scalesRaw).toBeTruthy();
  });
});

describe("P4 Large-print preset (pure)", () => {
  it("sets every size to 1.5 and every weight to Bold, leaves field toggles alone", () => {
    const before: PrintPatternState = { ...DEFAULT_PP, tiktokUser: false, buyerNumSize: 2.4, shopNameBold: false };
    const after = applyLargePreset(before);
    expect(after.shopNameSize).toBe(1.5);
    expect(after.buyerNumSize).toBe(1.5);
    expect(after.commentSize).toBe(1.5);
    expect(after.shopNameBold).toBe(true);
    expect(after.commentBold).toBe(true);
    expect(after.tiktokUser).toBe(false);   // toggle untouched
  });
});

describe("P4 fit hint (threshold-based, honest-by-wording)", () => {
  it("defaults never warn on any size", () => {
    for (const k of ["100x60", "80x60", "80x50", "70x50", "60x40"]) {
      expect(patternFitHint(k, DEFAULT_PP)).toBe(false);
    }
  });
  it("the Large preset warns on 60x40, not on 100x60", () => {
    const large = applyLargePreset(DEFAULT_PP);
    expect(patternFitHint("60x40", large)).toBe(true);
    expect(patternFitHint("100x60", large)).toBe(false);
  });
  it("a single 2x field warns on 60x40; a hidden field's size is ignored", () => {
    expect(patternFitHint("60x40", { ...DEFAULT_PP, buyerNumSize: 2 })).toBe(true);
    expect(patternFitHint("60x40", { ...DEFAULT_PP, buyerNum: false, buyerNumSize: 3 })).toBe(false);
  });
});

describe("P4 screen UI", () => {
  const renderPp = (pp: PrintPatternState, over: Record<string, unknown> = {}) => {
    const onWeight = vi.fn();
    const onLargeToggle = vi.fn();
    const r = render(
      <TProvider lang="en">
        <PrintPattern onBack={() => {}} pp={pp} onToggle={() => {}} onStep={() => {}} onWeight={onWeight} labelSize="60x40" largeOn={false} onLargeToggle={onLargeToggle} {...over} />
      </TProvider>
    );
    return { ...r, onWeight, onLargeToggle };
  };

  it("shows the SAVED label size from Printer Settings (single source of truth; no size picker here)", () => {
    const { getByTestId, container } = renderPp(DEFAULT_PP);
    expect(getByTestId("pp-label-size").textContent).toContain("60 × 40 mm");
    expect(getByTestId("pp-label-size").textContent).toContain("Printer Settings");
    // no second size picker on this screen — no select and no size-option list
    expect(container.querySelector("select")).toBeNull();
  });

  it("labelSize comes from the same parser real prints use", () => {
    expect(parseStickerSize("60x40mm (Small)")).toBe("60x40");
  });

  it("renders a Bold toggle per weight-capable row with the P3 defaults pressed", () => {
    const { getByTestId, queryByTestId, onWeight } = renderPp(DEFAULT_PP);
    expect(getByTestId("pp-bold-buyerNum").getAttribute("aria-pressed")).toBe("true");
    expect(getByTestId("pp-bold-tiktokName").getAttribute("aria-pressed")).toBe("true");
    expect(getByTestId("pp-bold-tiktokUser").getAttribute("aria-pressed")).toBe("true");
    expect(getByTestId("pp-bold-shopName").getAttribute("aria-pressed")).toBe("false");
    expect(getByTestId("pp-bold-comment").getAttribute("aria-pressed")).toBe("false");
    expect(queryByTestId("pp-bold-dateTime")).toBeNull();   // fixed-size field: no weight
    fireEvent.click(getByTestId("pp-bold-buyerNum"));
    expect(onWeight).toHaveBeenCalledWith("buyerNumBold");
  });

  it("Large preset button fires and flips its label with largeOn", () => {
    const { getByTestId, onLargeToggle } = renderPp(DEFAULT_PP);
    expect(getByTestId("pp-large-btn").textContent).toContain("Large print mode");
    fireEvent.click(getByTestId("pp-large-btn"));
    expect(onLargeToggle).toHaveBeenCalledTimes(1);
    cleanup();   // RTL queries are document-scoped — one render at a time
    const { getByTestId: g2 } = renderPp(DEFAULT_PP, { largeOn: true });
    expect(g2("pp-large-btn").textContent).toContain("Restore previous sizes");
  });

  it("fit note appears only when the threshold trips for the SAVED size", () => {
    const { queryByTestId } = renderPp(DEFAULT_PP);
    expect(queryByTestId("pp-fit-note")).toBeNull();
    cleanup();
    const { queryByTestId: q2 } = renderPp(applyLargePreset(DEFAULT_PP));
    expect(q2("pp-fit-note")).not.toBeNull();
    cleanup();
    // same large values on a big label -> no note
    const { queryByTestId: q3 } = renderPp(applyLargePreset(DEFAULT_PP), { labelSize: "100x60" });
    expect(q3("pp-fit-note")).toBeNull();
  });
});
