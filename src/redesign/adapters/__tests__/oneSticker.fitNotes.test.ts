// The notes under the preview (approved Step 0 preview): red only when a part runs off the label;
// a one-line part shortened with "…", a shrunk comment, a cut comment = amber; the recommended settings
// fit with no red at every standard size, on every printer path (Niimbot = its SDK frame).
import { beforeAll, describe, expect, it } from "vitest";
import { fitNotes, screenFitNotes, layoutSticker, recommendedSettings, STANDARD_SIZES, SCALE_STEPS, type OneStickerSettings, type Weight } from "../oneSticker";
import { ONE_STICKER_SAMPLE, sampleInput, renderOptsFor, type OneStickerPath } from "../oneStickerPrint";
import type { Fonts } from "../oneStickerText";
import { fullFonts, installNodeFallbackDrawer } from "./oneSticker.harness";

let F: Fonts;
beforeAll(async () => { installNodeFallbackDrawer(); F = await fullFonts(); });
const notes = (s: OneStickerSettings, path: OneStickerPath = "d520", items?: string[], shop = "Budgetukay") => {
  const inp = { ...sampleInput(shop), ...(items ? { items } : {}) };
  return fitNotes(layoutSticker(s, inp, F, renderOptsFor(path, s, path === "tspl" ? { bold: true } : {})), s);
};

describe("fit notes", () => {
  it("the preview sample is buyer #128 (not 8888)", () => { expect(ONE_STICKER_SAMPLE.buyerNum).toBe(128); });
  it("the screen is never \"all good\" when a real 4-digit buyer number would be cut (every size × path × Buyer # step × weight)", () => {
    const lies: string[] = [];
    for (const z of STANDARD_SIZES) for (const path of ["d520", "niimbot", "laptop", "tspl"] as OneStickerPath[]) for (const scale of SCALE_STEPS) for (const weight of ["normal", "bold", "extra"] as Weight[]) {
      const s = recommendedSettings(z);
      s.parts.buyer.scale = scale; s.parts.buyer.weight = weight;
      const opts = renderOptsFor(path, s, path === "tspl" ? { bold: true } : {});
      const shown = screenFitNotes(s, sampleInput("Budgetukay"), F, opts);
      const red = shown.some((n) => n.kind === "bad" && n.parts.includes("buyer"));
      for (const real of [1234, 8888]) {
        const cut = layoutSticker(s, { ...sampleInput("Budgetukay"), buyerNum: real }, F, opts).warnings.some((w) => w.part === "buyer");
        if (cut && !red) lies.push(`${z.w}x${z.h} ${path} ${scale}× ${weight}: #${real} cut, screen not red`);
      }
    }
    expect(lies).toEqual([]);
  }, 300000);
  it("recommended settings at common CUSTOM sizes: no red even with buyer #8888 (Niimbot 50 mm paper, square, tall)", () => {
    const bad: string[] = [];
    for (const [w, h] of [[40, 30], [50, 40], [50, 50], [50, 70], [40, 60], [40, 40], [50, 80], [60, 100], [75, 45], [30, 40], [30, 60]]) for (const path of ["d520", "niimbot", "laptop"] as OneStickerPath[]) {
      const s = { ...recommendedSettings({ w, h }), size: { w, h, custom: true } };
      const n = screenFitNotes(s, sampleInput("Budgetukay"), F, renderOptsFor(path, s));
      if (n.some((x) => x.kind === "bad")) bad.push(`${w}x${h} ${path}: ${JSON.stringify(n)}`);
    }
    expect(bad).toEqual([]);
  }, 120000);
  it("recommended settings: no red at every standard size, on every path (Niimbot in its SDK frame)", () => {
    const bad: string[] = [];
    for (const z of STANDARD_SIZES) for (const path of ["d520", "tspl", "niimbot", "laptop"] as OneStickerPath[]) for (const shop of ["", "Budgetukay", "Maria Ukay Ukay Shop TW"]) {
      const n = screenFitNotes(recommendedSettings(z), sampleInput(shop), F, renderOptsFor(path, recommendedSettings(z), path === "tspl" ? { bold: true } : {}));
      if (n.some((x) => x.kind === "bad")) bad.push(`${z.w}x${z.h} ${path} "${shop}": ${JSON.stringify(n)}`);
    }
    expect(bad).toEqual([]);
  });
  it("recommended settings + the preview sample: \"Everything fits\"", () => {
    for (const z of STANDARD_SIZES) expect(notes(recommendedSettings(z))[0], `${z.w}x${z.h}`).toEqual({ kind: "ok" });
  });
  it("a long name on one line ends in \"…\" → a grey info note (short), never red or amber; \"Everything fits\" still shows", () => {
    const s = recommendedSettings({ w: 60, h: 40 });
    s.parts.name.scale = 2;
    const L = layoutSticker(s, { ...sampleInput("Budgetukay"), name: "Maria Cristina Dela Cruz Santos Reyes" }, F);
    const n = fitNotes(L, s);
    expect(n.some((x) => x.kind === "short" && x.parts.includes("name"))).toBe(true);
    expect(n.some((x) => x.kind === "bad")).toBe(false);
    expect(n.some((x) => x.kind === "ok")).toBe(true);
  });
  it("a long comment shrinks (amber %), a very long one is cut (amber …), everything 2× runs off (red)", () => {
    const s = recommendedSettings({ w: 60, h: 40 });
    const shr = notes(s, "d520", ["A12 350 + B3 280 + C1 199 pasabay po yung itim na dress"]);
    expect(shr.find((x) => x.kind === "shrunk")).toBeTruthy();
    const cut = notes(s, "d520", ["A12 350 + B3 280 + C1 199 pasabay po yung itim na dress size M, ipon ko muna po hanggang Friday salamat po talaga sa inyo ulit po ".repeat(3)]);
    expect(cut.find((x) => x.kind === "cut")).toBeTruthy();
    expect(cut.some((x) => x.kind === "bad")).toBe(false);
    const big = recommendedSettings({ w: 50, h: 30 });
    for (const k of ["shop", "buyer", "name", "user", "comment"] as const) big.parts[k].scale = 2;
    // the print never cuts the buyer number now (made smaller, amber); the SCREEN is red (worst-case #8888)
    expect(notes(big).find((x) => x.kind === "smaller")).toBeTruthy();
    expect(screenFitNotes(big, sampleInput("Budgetukay"), F, renderOptsFor("d520", big)).find((x) => x.kind === "bad")).toBeTruthy();
  });
  it("50×30: no shop name (info)", () => {
    expect(notes(recommendedSettings({ w: 50, h: 30 })).some((x) => x.kind === "small")).toBe(true);
  });
});
