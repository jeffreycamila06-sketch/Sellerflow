// SCREEN LIMITS + BUYER # NEVER CUT (Jeff 2026-11-09, after the 2nd senior audit of 438b4a90).
//  1. the worst-case buyers include a SHORT TikTok handle (a small QR → a bigger module → less width for
//     #8888) and a comment of low-hanging letters / marks;
//  2. the print never cuts #8888 across its width beside the QR — the number is made just small enough;
//  5. only the part over its limit gets a limit below its size; the others are worked out with it held there.
// Uses only functions that also exist on 438b4a90, so the same file shows what failed there.
import { beforeAll, describe, expect, it } from "vitest";
import { layoutSticker, screenFitNotes, screenStepCaps, recommendedSettings, minReadablePx, SCALE_STEPS, STANDARD_SIZES, type OneStickerInput, type OneStickerSettings, type Layout } from "../oneSticker";
import { sampleInput, renderOptsFor, type OneStickerPath } from "../oneStickerPrint";
import type { Fonts } from "../oneStickerText";
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
const SAMPLE = () => sampleInput("My Shop", AT);
const SHORT = (): OneStickerInput => ({ ...SAMPLE(), name: "Nguyễn Thị Ngọc Quỳnh", handle: "ab", buyerNum: "8888", items: ["gjpqy Ụ ợ"] });
const LONG = (): OneStickerInput => ({ ...SAMPLE(), name: "Nguyễn Thị Ngọc Quỳnh", handle: "quynh.nguyen_gpqy", buyerNum: "8888", items: ["gjpqy Ụ ợ"] });
/** The buyer number as printed: the whole run inside its clip (never cut across its width). */
const numberWhole = (L: Layout): boolean => {
  const n = L.lines.filter((l) => l.part === "buyer" && l.run.text !== "Buyer");
  return n.length === 1 && n[0].x + n[0].run.width <= n[0].clip && !L.warnings.some((w) => w.part === "buyer" && w.kind === "width");
};
const made = (L: Layout) => L.warnings.filter((w) => w.kind === "smaller" || (w.kind === "height" && w.part !== "qr") || (w.part === "buyer" && w.kind === "width")).map((w) => `${w.part} ${w.kind}`);
const ok = (s: OneStickerSettings, path: OneStickerPath) => screenFitNotes(s, SAMPLE(), F, optsFor(path, s)).some((n) => n.kind === "ok");

const THAI = (): OneStickerInput => ({ ...SAMPLE(), name: "ฐิติพัฒน์ ปู่ฤทธิ์", handle: "thitiphat_gpqy", buyerNum: "8888", items: ["gjpqy Ụ ợ"] });
const HUYNH = (): OneStickerInput => ({ ...SAMPLE(), name: "Huỳnh Ỷ Ỵ Ỹ Ngọc", handle: "yy.jpg", buyerNum: "8888", items: ["gjpqy Ụ ợ"] });
const CYR = (): OneStickerInput => ({ ...SAMPLE(), name: "Йорданка Щерева", handle: "yordanka_jq", buyerNum: "8888", items: ["gjpqy Ụ ợ"] });
const VNFB = (): OneStickerInput => ({ ...SAMPLE(), name: "Nguyễn Thị Ngọc Quỳnh Huỳnh Phương Thùy Dương", handle: "Nguyễn Thị Ngọc Quỳnh Huỳnh Phương Thùy Dương", platform: "Facebook", fbNameOnly: true, buyerNum: "8888", items: ["gjpqy Ụ ợ"] });
const red = (s: OneStickerSettings, path: OneStickerPath) => screenFitNotes(s, SAMPLE(), F, optsFor(path, s)).some((n) => n.kind === "bad");

describe("1. worst-case buyers on the screen", () => {
  it("a SHORT handle: a 30 mm-wide label at Buyer # 1–1.5 is RED whenever #8888 would not print whole at that size (438b4a90: no red, the number cut)", () => {
    const lies: string[] = [];
    for (const h of [30, 40, 60, 80]) for (const scale of [1, 1.15, 1.3, 1.5]) for (const path of ["d520", "tspl", "laptop"] as OneStickerPath[]) {
      const s = S(30, h, (x) => { x.parts.buyer.scale = scale; });
      if (red(s, path)) continue;
      const L = layoutSticker(s, SHORT(), F, optsFor(path, s));
      if (!numberWhole(L) || made(L).length) lies.push(`30x${h} ×${scale} ${path}: no red but ${made(L).join(", ") || "#8888 cut"}`);
    }
    expect(lies).toEqual([]);
  }, 300000);
  it("low-hanging letters / marks: 80×30 / 110×30 / 60×30 / 50×30 with Buyer # / name / @username (± shop) at 2×, Normal / Bold / Extra, are never green while the print makes a line smaller (438b4a90: Bold/Extra Thai; 695e5127: Normal — Huỳnh Ỷ Ỵ Ỹ, Йорданка Щерева, a long Vietnamese 2-line Facebook name)", () => {
    const lies: string[] = [];
    for (const [w, h] of [[80, 30], [110, 30], [60, 30], [50, 30]] as [number, number][]) for (const shop of [true, false]) for (const weight of ["normal", "bold", "extra"] as const) for (const path of ["d520", "tspl", "laptop"] as OneStickerPath[]) {
      const s = S(w, h, (x) => { for (const p of [...(shop ? ["shop"] as const : []), "buyer", "name", "user"] as const) { x.parts[p].scale = 2; x.parts[p].weight = weight; } });
      if (!ok(s, path)) continue;
      for (const inp of [THAI(), LONG(), SHORT(), HUYNH(), CYR(), VNFB()]) { const m = made(layoutSticker(s, inp, F, optsFor(path, s))); if (m.length) lies.push(`${w}x${h} shop=${shop} ${weight} ${path} ${inp.name}: green but ${m.join(", ")}`); }
    }
    expect(lies).toEqual([]);
  }, 600000);
});

describe("2. the print never cuts #8888 across its width beside the QR", () => {
  it("every size (standard + 30–110 mm custom) × every Buyer # step × short / long handle × D520 / TSPL / laptop: the number prints whole (beside the QR or, with no QR, beside the date), never below the readable size", () => {
    const bad: string[] = [];
    const sizes: [number, number][] = [...STANDARD_SIZES.map((z) => [z.w, z.h] as [number, number]), [30, 30], [30, 40], [30, 60], [30, 110], [40, 30], [40, 60], [50, 50], [110, 30]];
    for (const [w, h] of sizes) for (const scale of SCALE_STEPS) for (const inp of [SHORT(), LONG()]) for (const path of ["d520", "tspl", "laptop"] as OneStickerPath[]) {
      const s = S(w, h, (x) => { x.parts.buyer.scale = scale; });
      const L = layoutSticker(s, inp, F, optsFor(path, s));
      // never cut (Jeff A): beside the QR, and — Jeff's decision on aa596acd — also with no QR, where the
      // date or the label edge would cut it (30×30)
      if (!numberWhole(L)) bad.push(`${w}x${h} ×${scale} ${path} @${inp.handle}: #8888 cut ${L.qr ? "beside the QR" : "by the date (no QR)"}`);
      const num = L.lines.find((l) => l.part === "buyer" && l.run.text !== "Buyer");
      // made smaller → never below the readable size
      if (num && L.warnings.some((x) => x.part === "buyer" && x.kind === "smaller") && num.px < minReadablePx(w, h)) bad.push(`${w}x${h} ×${scale} ${path}: ${num.px} px`);
    }
    expect(bad).toEqual([]);
  }, 600000);
  it("…the QR is kept and the note is amber \"made smaller\" (not cut, not removed)", () => {
    const s = S(60, 40, (x) => { x.parts.buyer.scale = 2; });
    const L = layoutSticker(s, SHORT(), F, optsFor("tspl", s));
    expect(L.qr).not.toBeNull();
    expect(L.warnings).toContainEqual({ part: "buyer", kind: "smaller" });
    expect(numberWhole(L)).toBe(true);
  });
});

describe("A with no QR (Jeff, aa596acd): the date never cuts #8888", () => {
  it("30×30, a long handle (no room for any QR), Buyer # 1.15–2: #8888 prints whole, made smaller (amber), the screen still red (aa596acd: cut by the date)", () => {
    for (const scale of [1.15, 1.3, 1.5, 2]) for (const path of ["d520", "tspl", "laptop"] as OneStickerPath[]) {
      const s = S(30, 30, (x) => { x.parts.buyer.scale = scale; });
      const L = layoutSticker(s, LONG(), F, optsFor(path, s));
      expect(L.qr, `${scale} ${path}`).toBeNull();
      expect(numberWhole(L), `${scale} ${path}`).toBe(true);
      expect(L.warnings, `${scale} ${path}`).toContainEqual({ part: "buyer", kind: "smaller" });
      const num = L.lines.find((l) => l.part === "buyer" && l.run.text !== "Buyer")!;
      expect(num.px, `${scale} ${path}`).toBeGreaterThanOrEqual(minReadablePx(30, 30));
      expect(red(s, path), `${scale} ${path} screen`).toBe(true);
    }
  });
});

describe("5. only the part over its limit gets a grey \"+\"", () => {
  it("60×40 with the QR, Buyer # 2× (over): Buyer # gets a limit below 2×; name / @username / shop are NOT held at their own size (438b4a90: every part grey)", () => {
    for (const path of ["d520", "tspl"] as OneStickerPath[]) {
      const s = S(60, 40, (x) => { x.parts.buyer.scale = 2; });
      const caps = screenStepCaps(s, SAMPLE(), F, optsFor(path, s));
      expect(caps.buyer, path).toBeLessThan(2);
      for (const k of ["shop", "name", "user"] as const) expect(caps[k] == null || caps[k]! > s.parts[k].scale, `${path} ${k}: ${caps[k]}`).toBe(true);
    }
  }, 300000);
  it("at the Buyer # limit every worst-case buyer prints whole with no line made smaller; one step above, not", () => {
    const s = S(60, 40, (x) => { x.parts.buyer.scale = 2; });
    const cap = screenStepCaps(s, SAMPLE(), F, optsFor("tspl", s)).buyer!;
    const at = (v: number) => S(60, 40, (x) => { x.parts.buyer.scale = v; });
    const clean = (t: OneStickerSettings) => [SHORT(), LONG()].every((inp) => made(layoutSticker(t, inp, { ...F, cjkBox: true }, optsFor("tspl", t))).length === 0);
    expect(clean(at(cap))).toBe(true);
    expect(clean(at(SCALE_STEPS[SCALE_STEPS.indexOf(cap as (typeof SCALE_STEPS)[number]) + 1]))).toBe(false);
  }, 300000);
});
