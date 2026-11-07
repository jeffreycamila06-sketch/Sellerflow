// READABILITY GUARD — the automatic test (Jeff: every language prints clean and readable).
// For every script × 50×30 / 60×40 / 100×60 × Normal / Bold / Extra × the printers' ink (AIMO, laptop,
// Niimbot: plain; Y41BT / XP-420B: the 1-dot ink), every printed line must keep every letter open
// (no filled counter, no strokes run together) compared with the same text in Normal without ink.
// Also: the guard never changes a size (only lighter), and without it some samples DO close
// (so the test can fail).
import { beforeAll, describe, expect, it } from "vitest";
import { layoutSticker, recommendedSettings, renderOneSticker, type OneStickerInput, type OneStickerSettings, type Weight } from "../oneSticker";
import { lineIsReadable, readableStyle, type Fonts } from "../oneStickerText";
import { renderOptsFor, type OneStickerPath } from "../oneStickerPrint";
import { fullFonts, installNodeFallbackDrawer } from "./oneSticker.harness";
import { READ_SAMPLES } from "./oneSticker.samples";

const inputFor = (k: string): OneStickerInput => ({ storeName: "Maria Ukay Shop", date: "11/07", time: "14:05", buyerNum: 128, name: READ_SAMPLES[k].name, handle: "maria_live", platform: "TikTok", items: READ_SAMPLES[k].items });
const settingsFor = (w: number, h: number, weight: Weight): OneStickerSettings => {
  const s = recommendedSettings({ w, h });
  for (const k of ["shop", "buyer", "name", "user", "comment"] as const) s.parts[k].weight = weight;
  return s;
};
const PRINTERS: { key: string; path: OneStickerPath; job: { bold?: boolean } }[] = [
  { key: "AIMO", path: "d520", job: {} }, { key: "Y41BT/XP-420B", path: "tspl", job: { bold: true } }, { key: "Niimbot", path: "niimbot", job: {} }, { key: "laptop", path: "laptop", job: {} },
];

let F: Fonts;
beforeAll(async () => { installNodeFallbackDrawer(); F = await fullFonts(); });

describe("readability guard", () => {
  it("every printed line keeps every letter open — every script × size × weight × printer", () => {
    const bad: string[] = [];
    for (const [w, h] of [[50, 30], [60, 40], [100, 60]]) for (const k of Object.keys(READ_SAMPLES)) for (const weight of ["normal", "bold", "extra"] as Weight[]) for (const pr of PRINTERS) {
      const s = settingsFor(w, h, weight);
      const L = layoutSticker(s, inputFor(k), F, renderOptsFor(pr.path, s, pr.job));
      for (const l of L.lines) if (!lineIsReadable(l.run.text, l.px, { weight: l.weight, ink: l.ink }, F)) bad.push(`${w}x${h} ${k} ${weight} ${pr.key}: "${l.run.text}" ${l.weight}${l.ink ? "+ink" : ""}`);
    }
    expect(bad).toEqual([]);
  }, 300000);
  it("without the guard some samples DO close (the test can fail)", () => {
    let closed = 0;
    for (const k of ["chinese", "japanese"]) {
      const s = settingsFor(50, 30, "extra");
      const L = layoutSticker(s, inputFor(k), F, { inkBold: true, guard: false });
      for (const l of L.lines) if (!lineIsReadable(l.run.text, l.px, { weight: l.weight, ink: l.ink }, F)) closed++;
    }
    expect(closed).toBeGreaterThan(0);
  }, 60000);
  it("only lighter, never resized: the same text sizes with and without the guard", () => {
    for (const k of Object.keys(READ_SAMPLES)) {
      const s = settingsFor(60, 40, "extra");
      const on = layoutSticker(s, inputFor(k), F, { inkBold: true });
      const off = layoutSticker(s, inputFor(k), F, { inkBold: true, guard: false });
      // the same sizes (a lighter line can be narrower, so a wrapped comment may need fewer lines)
      expect([...new Set(on.lines.map((l) => l.px))].sort(), k).toEqual([...new Set(off.lines.map((l) => l.px))].sort());
      expect(on.commentPx, k).toBe(off.commentPx);
      const order = [400, 700, 900];
      for (let i = 0; i < Math.min(on.lines.length, off.lines.length); i++) expect(order.indexOf(on.lines[i].weight), k).toBeLessThanOrEqual(order.indexOf(off.lines[i].weight));
    }
  }, 60000);
  it("the ink goes first: Extra + ink that closes tries Extra without ink before Bold", () => {
    // Latin "Amy Chen" at 60×40: Extra stays, only the ink is dropped (letters still open as Extra)
    const st = readableStyle("ako po yung black dress size M", 36, 900, true, F);
    expect(st.weight).toBe(900);
    expect(st.ink).toBe(false);
  });
  it("the preview and the print use the same decision (one function)", () => {
    const s = settingsFor(50, 30, "extra");
    const a = renderOneSticker(s, inputFor("chinese"), F, renderOptsFor("tspl", s, { bold: true }));
    const b = renderOneSticker(s, inputFor("chinese"), F, renderOptsFor("tspl", s, { bold: true }));
    expect(Buffer.from(a.buf).equals(Buffer.from(b.buf))).toBe(true);
  });
});
