// NO LINE IS EVER MISSING (Jeff 2026-11-09, after the label-overflow audit). When a real buyer's
// Buyer #, name, @username or 2-line Facebook name would cross the bottom 1.5 mm, the comment gives up
// space first (shrink → fewer lines → "…", at least one line), then that fixed line is made smaller just
// enough — never dropped, never below the readable minimum, amber note; the preview is the print. The
// screen checks worst-case buyers before Save: a part one of them would need made smaller is red and
// its "+" stops at the largest size that always fits.
import { beforeAll, describe, expect, it } from "vitest";
import {
  layoutSticker, screenFitNotes, screenStepCaps, recommendedSettings, minReadablePx, worstCaseInputs, WORST_CASE_BUYERS,
  BOTTOM_SAFE_DOTS, SCALE_STEPS, STANDARD_SIZES, isSmallClass, isFacebookLike, renderOneSticker,
  type OneStickerInput, type OneStickerSettings, type Weight, type Layout, type PartKey,
} from "../oneSticker";
import { lineExtent, printableText, type Fonts } from "../oneStickerText";
import { sampleInput, renderOptsFor, type OneStickerPath } from "../oneStickerPrint";
import { ADMIN_LANG_SAMPLES, adminSampleInput } from "../adminLangSamples";
import { fullFonts, installNodeFallbackDrawer } from "./oneSticker.harness";

let F: Fonts;
beforeAll(async () => { installNodeFallbackDrawer(); F = await fullFonts(); });
const AT = Date.UTC(2026, 10, 8, 6, 5);

const S = (w: number, h: number, f?: (s: OneStickerSettings) => void): OneStickerSettings => {
  const s: OneStickerSettings = { ...recommendedSettings({ w, h }), size: { w, h, ...(STANDARD_SIZES.some((z) => z.w === w && z.h === h) ? {} : { custom: true }) } };
  f?.(s);
  return s;
};
const optsFor = (path: OneStickerPath, s: OneStickerSettings) => renderOptsFor(path, s, path === "tspl" ? { bold: true } : {});
const bottomOf = (L: Layout, opts: ReturnType<typeof optsFor>) => L.h - (opts.canvas?.edgeY ?? BOTTOM_SAFE_DOTS);
/** Every part switched ON with text must be on the sticker (FB name: every wrapped line); no ink below the
 *  bottom limit; nothing made smaller than the readable minimum; no "off the label" warning. */
function problems(s: OneStickerSettings, inp: OneStickerInput, L: Layout, opts: ReturnType<typeof optsFor>): string[] {
  const out: string[] = [];
  const fb = inp.fbNameOnly === true || isFacebookLike(inp.platform);
  const want: PartKey[] = [];
  if (s.parts.shop.on && printableText(inp.storeName) && !isSmallClass(s.size.w, s.size.h)) want.push("shop");
  if (s.parts.buyer.on && String(inp.buyerNum ?? "")) want.push("buyer");
  if (s.parts.name.on && printableText(inp.name)) want.push("name");
  if (s.parts.user.on && printableText(inp.handle) && !fb) want.push("user");
  if (s.parts.comment.on && printableText(inp.items.join(" "))) want.push("comment");
  for (const k of want) if (!L.lines.some((l) => l.part === k)) out.push(`${k} missing`);
  if (L.lines.filter((l) => l.part === "buyer").length === 1) out.push("buyer: only one of word / number");
  const limit = bottomOf(L, opts);
  for (const l of L.lines) {
    const d = lineExtent(l.run, l.px, l.weight, F).desc;
    if (l.baseline + d > limit) out.push(`${l.part} ink ${l.baseline + d - limit} dots into the margin`);
  }
  if (L.qr && L.qr.y + L.qr.matrix.length * L.qr.mod > limit) out.push("qr in the margin");
  const min = minReadablePx(s.size.w, s.size.h);
  for (const w of L.warnings) {
    if (w.kind === "height" && w.part !== "qr") out.push(`${w.part}: off the label`); // "qr" = no room for a QR (amber), not a line
    if (w.kind === "smaller") for (const l of L.lines.filter((x) => x.part === w.part && x.run.text !== "Buyer")) if (l.px < min) out.push(`${w.part} ${l.px} px < ${min}`);
  }
  return out;
}
const SIZES: [number, number][] = [...STANDARD_SIZES.map((z) => [z.w, z.h] as [number, number]), ...[30, 50, 70, 90, 110].flatMap((w) => [30, 50, 70, 90, 110].map((h) => [w, h] as [number, number]))];
const BUYERS = (): OneStickerInput[] => [...ADMIN_LANG_SAMPLES.map((a) => adminSampleInput(a, "My Shop", AT)), ...worstCaseInputs(sampleInput("My Shop", AT))];

describe("print safety net: a line is made smaller, never dropped", () => {
  it("Vietnamese 60×40 (#8888, tall marks), Buyer # / name / @username at 2×: the @username is still there (smaller), amber, ≥ the readable size, clear of the margin", () => {
    const s = S(60, 40, (x) => { for (const k of ["buyer", "name", "user"] as const) x.parts[k].scale = 2; });
    const inp = worstCaseInputs(sampleInput("My Shop", AT))[0];
    const L = layoutSticker(s, inp, F, optsFor("tspl", s));
    expect(problems(s, inp, L, optsFor("tspl", s))).toEqual([]);
    expect(L.lines.some((l) => l.run.text.startsWith("@quy"))).toBe(true);
    expect(L.lines.some((l) => l.part === "comment")).toBe(true); // 7273e026 dropped the comment here (red "Too big: comment")
    expect(L.warnings.some((w) => w.kind === "smaller")).toBe(true);
    expect(s.parts.user.scale).toBe(2); // the saved setting is never changed
  });
  it("the comment gives up space first: a comment that still has a line → no fixed line is made smaller", () => {
    const s = S(60, 40, (x) => { x.parts.name.scale = 1.3; });
    const inp = { ...sampleInput("My Shop", AT), items: ["a very long comment ".repeat(12)] };
    const L = layoutSticker(s, inp, F);
    expect(L.warnings.filter((w) => w.kind === "smaller")).toEqual([]);
    expect(L.lines.filter((l) => l.part === "comment").length).toBeGreaterThanOrEqual(1);
  });
  it("…and when the comment would have NO line left, the fixed lines above give way (comment kept, ≥ 1 line)", () => {
    const s = S(50, 30, (x) => { for (const k of ["buyer", "name", "user"] as const) x.parts[k].scale = 2; });
    const inp = adminSampleInput(ADMIN_LANG_SAMPLES.find((a) => a.key === "en")!, "My Shop", AT);
    const L = layoutSticker(s, inp, F);
    expect(problems(s, inp, L, {})).toEqual([]);
    expect(L.lines.filter((l) => l.part === "comment").length).toBeGreaterThanOrEqual(1); // was red "comment off the label"
  });
  it("Buyer # always prints: the buyer line at 2× on a short label shrinks, word and number both on it", () => {
    for (const [w, h] of [[30, 30], [50, 30], [110, 30]] as [number, number][]) {
      const s = S(w, h, (x) => { x.parts.buyer.scale = 2; x.parts.name.scale = 2; x.parts.user.scale = 2; });
      const inp = { ...worstCaseInputs(sampleInput("My Shop", AT))[0] };
      const L = layoutSticker(s, inp, F);
      expect(problems(s, inp, L, {}), `${w}x${h}`).toEqual([]);
      expect(L.lines.filter((l) => l.part === "buyer").map((l) => l.run.text), `${w}x${h}`).toEqual(["Buyer", "8888"]);
    }
  });
  for (const path of ["d520", "tspl", "niimbot", "laptop"] as OneStickerPath[]) {
    it(`${path}: worst-case buyers + every admin sample × every size (custom 30–110 too) × scales 0.6–2 × weights × QR on/off → no line missing, no ink in the margin`, () => {
      const bad: string[] = [];
      const sizes = path === "niimbot" ? SIZES.filter(([w]) => w <= 50) : path === "d520" ? SIZES : SIZES.filter(([w, h]) => w === h || STANDARD_SIZES.some((z) => z.w === w && z.h === h));
      for (const [w, h] of sizes) for (const scale of [0.6, 1, 1.3, 2]) for (const weight of ["normal", "extra"] as Weight[]) for (const qr of [true, false]) {
        const s = S(w, h, (x) => { for (const k of ["shop", "buyer", "name", "user"] as const) { x.parts[k].scale = scale; x.parts[k].weight = weight; } x.qr = qr; });
        const opts = optsFor(path, s);
        for (const inp of BUYERS()) {
          if (!qr && isFacebookLike(inp.platform)) continue; // Facebook never has a QR: one pass is enough
          const p = problems(s, inp, layoutSticker(s, inp, F, opts), opts);
          if (p.length) bad.push(`${w}x${h} ×${scale} ${weight} qr=${qr} ${inp.name}: ${p.join("; ")}`);
        }
      }
      expect(bad).toEqual([]);
    }, 600000);
  }
  it("the picture is the layout: the rendered ink never reaches the bottom 1.5 mm (each part alone at 2×, every size)", () => {
    const bad: string[] = [];
    for (const [w, h] of SIZES) for (const k of ["shop", "buyer", "name", "user"] as const) for (const inp of worstCaseInputs(sampleInput("My Shop", AT))) {
      const s = S(w, h, (x) => { x.parts[k].scale = 2; });
      const r = renderOneSticker(s, inp, F, optsFor("tspl", s));
      let low = -1; for (let y = r.h - 1; y >= 0 && low < 0; y--) for (let b = 0; b < r.rowBytes; b++) if (r.buf[y * r.rowBytes + b]) { low = y; break; }
      if (r.h - 1 - low < BOTTOM_SAFE_DOTS) bad.push(`${w}x${h} ${k} 2× ${inp.name}: ${r.h - 1 - low} dots`);
    }
    expect(bad).toEqual([]);
  }, 600000);
});

describe("item 4: the Buyer word's 'y' and the comment's first line", () => {
  it("Buyer line last on the sticker: the small word's 'y' never reaches the margin (short canvases 40–140 dots × every step; 7273e026: 21 cases)", () => {
    const bad: string[] = [];
    for (let H = 40; H <= 140; H += 2) for (const scale of SCALE_STEPS) {
      const s = S(60, 40, (x) => { for (const k of ["shop", "name", "user", "comment"] as const) x.parts[k].on = false; x.parts.buyer.scale = scale; x.qr = false; });
      const L = layoutSticker(s, { ...sampleInput("My Shop", AT), buyerNum: 8 }, F, { canvas: { w: 480, h: H, edgeX: 12, edgeY: 6 } });
      const word = L.lines.find((l) => l.run.text === "Buyer");
      if (!word) { bad.push(`h=${H} ×${scale}: no Buyer word`); continue; }
      const d = word.baseline + lineExtent(word.run, word.px, word.weight, F).desc;
      if (d > H - 6) bad.push(`h=${H} ×${scale}: 'y' ${d - (H - 6)} dots in the margin`);
    }
    expect(bad).toEqual([]);
  });
  it("a comment that is the first line: only the marks on ITS first line move it down (a tall Ễ later in the comment does not)", () => {
    const s = S(100, 60, (x) => { for (const k of ["shop", "buyer", "name", "user"] as const) x.parts[k].on = false; x.qr = false; });
    const inp = { ...sampleInput("My Shop", AT), items: ["black dress size M with a long note for the shop please wrap it well ".repeat(2) + "Ễ Ỗ Ặ"] };
    const L = layoutSticker(s, inp, F);
    const first = L.lines.filter((l) => l.part === "comment")[0];
    expect(first.run.text).not.toMatch(/[ỄỖẶ]/);
    expect(first.baseline).toBe(BOTTOM_SAFE_DOTS + Math.round(first.px * 0.88)); // no lead (7273e026 moved it down for the Ễ on line 3)
    const tall = layoutSticker(s, { ...inp, items: ["Ễ Ỗ Ặ " + inp.items[0]] }, F).lines.filter((l) => l.part === "comment")[0];
    expect(tall.baseline).toBeGreaterThan(first.baseline); // marks on the first line still move it
  });
});

describe("screen: worst-case buyers before Save", () => {
  it("the worst-case set: tall Vietnamese / Thai marks, Chinese, a 2-line Facebook name, all #8888", () => {
    expect(WORST_CASE_BUYERS.map((b) => b.platform)).toEqual(["TikTok", "TikTok", "TikTok", "Facebook"]);
    for (const i of worstCaseInputs(sampleInput("x"))) expect(i.buyerNum).toBe("8888");
  });
  it("never \"Everything fits\" while a worst-case buyer or an admin sample would need a line made smaller (sizes × each part's steps × weights × QR × paths)", () => {
    const lies: string[] = [];
    const sizes: [number, number][] = [...STANDARD_SIZES.map((z) => [z.w, z.h] as [number, number]), [30, 30], [40, 30], [50, 50], [110, 30]];
    for (const [w, h] of sizes) for (const path of ["d520", "tspl", "niimbot"] as OneStickerPath[]) for (const k of ["shop", "buyer", "name", "user", "all"] as const) for (const scale of [1, 1.3, 1.75, 2]) for (const weight of ["normal", "extra"] as Weight[]) for (const qr of [true, false]) {
      if (path === "niimbot" && w > 50) continue;
      const s = S(w, h, (x) => { for (const p of k === "all" ? (["buyer", "name", "user"] as const) : [k]) { x.parts[p].scale = scale; x.parts[p].weight = weight; } x.qr = qr; });
      const opts = optsFor(path, s);
      const shown = screenFitNotes(s, sampleInput("My Shop", AT), F, opts);
      if (!shown.some((n) => n.kind === "ok")) continue;
      for (const inp of BUYERS()) {
        const L = layoutSticker(s, inp, F, opts);
        const g = L.warnings.filter((x) => x.kind === "smaller" || x.kind === "height");
        if (g.length) lies.push(`${w}x${h} ${path} ${k} ${scale}× ${weight} qr=${qr}: "Everything fits" but ${inp.name} → ${g.map((x) => `${x.part} ${x.kind}`).join(", ")}`);
      }
    }
    expect(lies).toEqual([]);
  }, 600000);
  it("80×50, Buyer 1.75× / name 2× / @username 2× (7273e026: \"Everything fits\" while a Thai buyer lost the comment): not green", () => {
    const s = S(80, 50, (x) => { x.parts.buyer.scale = 1.75; x.parts.name.scale = 2; x.parts.user.scale = 2; });
    const n = screenFitNotes(s, sampleInput("My Shop", AT), F);
    expect(n.some((x) => x.kind === "ok")).toBe(false);
    expect(n.some((x) => x.kind === "bad")).toBe(true);
  });
  it("a part a worst-case buyer needs made smaller is RED on the screen, with the sample still fine", () => {
    const s = S(50, 30, (x) => { for (const k of ["buyer", "name", "user"] as const) x.parts[k].scale = 2; });
    const n = screenFitNotes(s, sampleInput("My Shop", AT), F);
    const red = n.find((x) => x.kind === "bad");
    expect(red && red.kind === "bad" ? red.parts.length : 0).toBeGreaterThan(0);
    expect(n.some((x) => x.kind === "ok")).toBe(false);
  });
  it("Buyer # \"+\" stops before #8888 is cut across its width beside the QR (60×40, QR on; guardian HIGH-1)", () => {
    for (const path of ["d520", "tspl", "laptop"] as OneStickerPath[]) {
      const s = S(60, 40);
      const caps = screenStepCaps(s, sampleInput("My Shop", AT), F, optsFor(path, s));
      expect(caps.buyer, path).toBeDefined();
      const at = (v: number) => S(60, 40, (x) => { x.parts.buyer.scale = v; });
      const cut = (v: number) => worstCaseInputs(sampleInput("My Shop", AT)).some((inp) => layoutSticker(at(v), inp, { ...F, cjkBox: true }, optsFor(path, at(v))).warnings.some((w) => w.part === "buyer" && w.kind === "width"));
      expect(cut(caps.buyer!), `${path} at the cap`).toBe(false);
      expect(cut(SCALE_STEPS[SCALE_STEPS.indexOf(caps.buyer as (typeof SCALE_STEPS)[number]) + 1]), `${path} above the cap`).toBe(true);
    }
  });
  it("the \"+\" caps: the cap step fits every worst-case buyer, the step above it does not; recommended settings: no cap below 1× at any standard size", () => {
    for (const z of STANDARD_SIZES) { const c = screenStepCaps(S(z.w, z.h), sampleInput("My Shop", AT), F); for (const k of ["shop", "name", "user"] as const) expect(c[k], `${z.w}x${z.h} ${k}`).toBeUndefined(); if (c.buyer != null) expect(c.buyer, `${z.w}x${z.h} buyer`).toBeGreaterThanOrEqual(1); }
    let seen = 0;
    for (const [w, h] of [[50, 30], [60, 40], [30, 30], [40, 30]] as [number, number][]) for (const others of [1.5, 2]) {
      const base = S(w, h, (x) => { for (const k of ["buyer", "name", "user"] as const) x.parts[k].scale = others; });
      const caps = screenStepCaps(base, sampleInput("My Shop", AT), F);
      for (const [k, cap] of Object.entries(caps) as [PartKey, number][]) {
        seen++;
        const at = (v: number) => ({ ...base, parts: { ...base.parts, [k]: { ...base.parts[k], scale: v } } });
        const i = SCALE_STEPS.indexOf(cap as (typeof SCALE_STEPS)[number]);
        const fitsAt = (t: OneStickerSettings) => [sampleInput("My Shop", AT), ...worstCaseInputs(sampleInput("My Shop", AT))].every((inp) => !layoutSticker(t, inp, { ...F, cjkBox: true }).warnings.some((x) => x.kind === "smaller" || (x.kind === "height" && x.part !== "qr") || (x.part === "buyer" && x.kind === "width" && inp.buyerNum === "8888")));
        if (cap > base.parts[k].scale || fitsAt(at(cap))) {
          expect(fitsAt(at(cap)), `${w}x${h} ${k} cap ${cap}`).toBe(true);
          if (i < SCALE_STEPS.length - 1) expect(fitsAt(at(SCALE_STEPS[i + 1])), `${w}x${h} ${k} above cap`).toBe(false);
        } else expect(cap, `${w}x${h} ${k}: past the cap → its own size`).toBe(base.parts[k].scale);
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 300000);
});
