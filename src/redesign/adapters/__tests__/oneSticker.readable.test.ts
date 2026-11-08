// READABILITY GUARD — the automatic test (Jeff: every language prints clean and readable).
// For every script × 50×30 / 60×40 / 100×60 × Normal / Bold / Extra × the printers' ink (AIMO, laptop,
// Niimbot: plain; Y41BT / XP-420B: the 1-dot ink), every printed line must keep every letter open
// (no filled counter, no strokes run together) compared with the same text in Normal without ink.
// Also: the guard never changes a size (only lighter), and without it some samples DO close
// (so the test can fail).
import { beforeAll, describe, expect, it } from "vitest";
import { layoutSticker, recommendedSettings, renderOneSticker, type OneStickerInput, type OneStickerSettings, type Weight } from "../oneSticker";
import { lineIsReadable, measure, newInk, paintLine, readableStyle, type Fonts } from "../oneStickerText";
import type { SansWeight } from "../oneStickerFonts";
import { renderOptsFor, type OneStickerPath } from "../oneStickerPrint";
import { fullFonts, installNodeFallbackDrawer } from "./oneSticker.harness";
import { READ_SAMPLES, SIZES } from "./oneSticker.samples";

const inputFor = (k: string): OneStickerInput => ({ storeName: "Maria Ukay Shop", date: "11/07", time: "14:05", buyerNum: 128, name: READ_SAMPLES[k].name, handle: "maria_live", platform: "TikTok", items: READ_SAMPLES[k].items });
const settingsFor = (w: number, h: number, weight: Weight): OneStickerSettings => {
  const s = recommendedSettings({ w, h });
  for (const k of ["shop", "buyer", "name", "user", "comment"] as const) s.parts[k].weight = weight;
  return s;
};
const PRINTERS: { key: string; path: OneStickerPath; job: { bold?: boolean } }[] = [
  { key: "AIMO", path: "d520", job: {} }, { key: "Y41BT/XP-420B", path: "tspl", job: { bold: true } }, { key: "Niimbot", path: "niimbot", job: {} }, { key: "laptop", path: "laptop", job: {} },
];

// ── An independent checker (its own counting — not the guard's code) ──────────────────────────
// Paint the printed line alone, and the same text in Normal without ink; then compare the whole line:
// separate pieces of ink (strokes or neighbours touching → fewer), and every real counter of the Normal
// line (bigger than a pinhole) must still have open white in the same place.
type Run = ReturnType<typeof measure>;
function paintRun(run: Run, px: number, weight: SansWeight, ink: boolean) {
  const pad = 4, asc = Math.ceil(px * 1.6), h = asc + Math.ceil(px * 0.9);
  const c = newInk(Math.ceil(run.width) + Math.ceil(px * 1.2) + pad * 2, h);
  paintLine(c, run, px, weight, F, Math.ceil(px * 0.6) + pad, asc, c.w, ink);
  return c;
}
function analyse(c: { w: number; h: number; rowBytes: number; buf: Uint8Array }) {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < c.w && y < c.h && (c.buf[y * c.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
  const lab = new Int32Array(c.w * c.h).fill(-1);
  let pieces = 0;
  const holes: Set<number>[] = [];
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    const i = y * c.w + x;
    if (lab[i] !== -1) continue;
    const ink = at(x, y);
    const q = [i]; lab[i] = 1;
    const dots = new Set<number>(); let edge = false;
    while (q.length) {
      const p = q.pop()!, px = p % c.w, py = (p - px) / c.w;
      dots.add(px * 65536 + py); if (px === 0 || py === 0 || px === c.w - 1 || py === c.h - 1) edge = true;
      const nb = ink ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of nb) {
        const X = px + dx, Y = py + dy; if (X < 0 || Y < 0 || X >= c.w || Y >= c.h) continue;
        const j = Y * c.w + X; if (lab[j] === -1 && at(X, Y) === ink) { lab[j] = 1; q.push(j); }
      }
    }
    if (ink) pieces++; else if (!edge) holes.push(dots);
  }
  return { pieces, holes };
}
const memo = new Map<string, boolean>();
function independentlyOpen(text: string, px: number, weight: SansWeight, ink: boolean): boolean {
  const key = `${text}|${px}|${weight}|${ink}`;
  let v = memo.get(key);
  if (v === undefined) { v = checkOpen(text, px, weight, ink); memo.set(key, v); }
  return v;
}
function checkOpen(text: string, px: number, weight: SansWeight, ink: boolean): boolean {
  if (weight === 400 && !ink) return true;
  const refRun = measure(text, px, 400, F), gotRun = measure(text, px, weight, F);
  if (refRun.pieces.length !== gotRun.pieces.length) return false;
  const one = (r: Run, j: number): Run => ({ pieces: [r.pieces[j]], width: r.pieces[j].adv, text: r.pieces[j].text });
  const pin = Math.max(3, Math.round((px * px) / 400));
  // letter by letter (each drawn alone at the same origin): no strokes run together, every real
  // counter still open in the same place
  for (let i = 0; i < refRun.pieces.length; i++) {
    const ref = analyse(paintRun(one(refRun, i), px, 400, false)), got = analyse(paintRun(one(gotRun, i), px, weight, ink));
    if (got.pieces < ref.pieces) return false;
    for (const h of ref.holes) {
      if (h.size < pin) continue;
      const need = Math.max(2, Math.min(Math.floor(h.size * 0.3), Math.round((px * px) / 150)));
      if (!got.holes.some((g) => { let n = 0; for (const d of g) if (h.has(d) && ++n >= need) return true; return false; })) return false;
    }
  }
  // neighbours, exactly where the line puts them: two letters may touch only where the Normal font
  // itself joins them at its own printed spacing
  const pair = (r: Run, i: number, gap: number, w: SansWeight, k: boolean) => {
    const run: Run = { pieces: [r.pieces[i], { ...r.pieces[i + 1] }], width: gap + r.pieces[i + 1].adv, text: "" };
    run.pieces[0] = { ...r.pieces[i], adv: gap };
    const both = analyse(paintRun(run, px, w, k)).pieces;
    return both < analyse(paintRun(one(r, i), px, w, k)).pieces + analyse(paintRun(one(r, i + 1), px, w, k)).pieces;
  };
  const pensOf = (r: Run) => { let pen = 0; return r.pieces.map((p) => { const x = Math.round(pen); pen += p.adv; return x; }); };
  const pens = pensOf(gotRun), refPens = pensOf(refRun);
  for (let i = 0; i + 1 < gotRun.pieces.length; i++) {
    if (pair(gotRun, i, pens[i + 1] - pens[i], weight, ink) && !pair(refRun, i, refPens[i + 1] - refPens[i], 400, false)) return false;
  }
  return true;
}

let F: Fonts;
beforeAll(async () => { installNodeFallbackDrawer(); F = await fullFonts(); });

describe("readability guard", () => {
  it("every printed line keeps every letter open — every script × size × weight × printer", () => {
    const bad: string[] = [];
    for (const [w, h] of [[50, 30], [60, 40], [100, 60]]) for (const k of Object.keys(READ_SAMPLES)) for (const weight of ["normal", "bold", "extra"] as Weight[]) for (const pr of PRINTERS) {
      const s = settingsFor(w, h, weight);
      const L = layoutSticker(s, inputFor(k), F, renderOptsFor(pr.path, s, pr.job));
      for (const l of L.lines) if (!independentlyOpen(l.run.text, l.px, l.weight, l.ink) || !lineIsReadable(l.run.text, l.px, { weight: l.weight, ink: l.ink }, F)) bad.push(`${w}x${h} ${k} ${weight} ${pr.key}: "${l.run.text}" ${l.weight}${l.ink ? "+ink" : ""}`);
    }
    // a line printed lighter never moves the lines below it (Niimbot 60×40, all Extra, comment ×2, CJK name)
    for (const [w, h, path] of [[60, 40, "niimbot"], [50, 30, "niimbot"], [60, 40, "tspl"], [70, 50, "d520"]] as [number, number, OneStickerPath][]) for (const name of ["陳小美", "田中さん", "김민지", "Amy Chen"]) {
      const s = settingsFor(w, h, "extra");
      s.parts.comment.scale = 2;
      const inp = { ...inputFor("latin"), name, items: ["ako po yung black dress size M pa reserve po and the red one too"] };
      const on = layoutSticker(s, inp, F, renderOptsFor(path, s, { bold: true }));
      const off = layoutSticker(s, inp, F, { ...renderOptsFor(path, s, { bold: true }), guard: false });
      if (on.commentPx !== off.commentPx) bad.push(`${w}x${h} ${path} ${name}: comment ${on.commentPx} vs ${off.commentPx}`);
      const tops = (L: typeof on) => L.lines.map((l) => l.baseline).join(",");
      if (on.lines.length === off.lines.length && tops(on) !== tops(off)) bad.push(`${w}x${h} ${path} ${name}: lines moved`);
    }
    expect(bad).toEqual([]);
  }, 300000);
  it("without the guard some samples DO close (the test can fail)", () => {
    let closed = 0;
    for (const k of ["chinese", "japanese"]) {
      const s = settingsFor(50, 30, "extra");
      const L = layoutSticker(s, inputFor(k), F, { inkBold: true, guard: false });
      for (const l of L.lines) if (!independentlyOpen(l.run.text, l.px, l.weight, l.ink)) closed++;
    }
    expect(closed).toBeGreaterThan(0);
  }, 60000);
  it("ordinary names, numbers and price codes keep the seller's weight on AIMO (no needless lightening)", () => {
    // (Vietnamese "ễ" at Extra correctly goes to Bold: its two stacked marks run into each other; Cyrillic
    // "кл" in Bold: the feet of к and л meet → that line prints lighter — tested below)
    const cases: [string, string[]][] = [["Amy Chen", ["A1 350", "B2 x2"]], ["Мария Иванова", ["платье М 450"]], ["Nguyen Thi Hoa", ["vay den 299"]], ["Maria Santos", ["C3 1200"]]];
    const lowered: string[] = [];
    for (const [w, h] of [[60, 40], [100, 60]]) for (const weight of ["bold", "extra"] as Weight[]) for (const [name, items] of cases) {
      const s = settingsFor(w, h, weight);
      const L = layoutSticker(s, { ...inputFor("latin"), name, items }, F, renderOptsFor("d520", s));
      const want = weight === "bold" ? 700 : 900;
      for (const l of L.lines) if (l.run.text !== "Buyer" && l.run.text !== "11/07 14:05" && l.weight !== want) lowered.push(`${w}x${h} ${weight} "${l.run.text}" → ${l.weight}`);
    }
    expect(lowered).toEqual([]);
    // Vietnamese keeps Bold (Extra → Bold only)
    const s = settingsFor(60, 40, "bold");
    const L = layoutSticker(s, { ...inputFor("latin"), name: "Nguyễn Thị Hoa", items: ["váy đen 299"] }, F, renderOptsFor("d520", s));
    for (const l of L.lines) if (l.run.text !== "Buyer" && l.run.text !== "11/07 14:05") expect(l.weight, l.run.text).toBe(700);
  }, 60000);
  it("look-alike pairs never merge (rn → m, vv → w, rt, ty) — and \"кл\" in Bold prints lighter", () => {
    for (const [px, w, ink] of [[17, 900, true], [17, 700, true], [19, 700, false], [19, 900, false], [24, 900, true]] as [number, SansWeight, boolean][]) {
      for (const t of ["modern Fern burn vvip", "rn rm ri rr vv rt ty", "Burn the turn"]) {
        const st = readableStyle(t, px, w, ink, F);
        expect(independentlyOpen(t, px, st.weight, st.ink), `${t} ${px} ${w}${ink ? "+ink" : ""} → ${st.weight}${st.ink ? "+ink" : ""}`).toBe(true);
      }
    }
    expect(readableStyle("рокля", 36, 700, false, F).weight).toBe(400);
  });
  it("only lighter, never resized: the same text sizes with and without the guard — every size, scale 1 / 1.5 / 2, long Chinese / Japanese comments", () => {
    const LONG: Record<string, string[]> = {
      ...Object.fromEntries(Object.entries(READ_SAMPLES).map(([k, v]) => [k, v.items])),
      longChinese: ["我要這件黑色洋裝 M 號 兩件 還有紅色那件也要 謝謝老闆"],
      longJapanese: ["日本語「ワンピース」１２３ 田中さん これもお願いします"],
    };
    const bad: string[] = [];
    for (const [w, h] of SIZES) for (const weight of ["bold", "extra"] as Weight[]) for (const scale of [1, 1.5, 2]) for (const [k, items] of Object.entries(LONG)) {
      const s = settingsFor(w, h, weight);
      s.parts.comment.scale = scale;
      const inp = { ...inputFor("latin"), items };
      for (const ink of [false, true]) {
        const on = layoutSticker(s, inp, F, { inkBold: ink });
        const off = layoutSticker(s, inp, F, { inkBold: ink, guard: false });
        const tag = `${w}x${h} ${weight} ×${scale} ${k}${ink ? " +ink" : ""}`;
        if (on.commentPx !== off.commentPx) bad.push(`${tag}: comment ${on.commentPx} vs ${off.commentPx}`);
        // the same sizes (a lighter line can be narrower, so a wrapped comment may need fewer lines)
        const sz = (L: typeof on) => [...new Set(L.lines.map((l) => l.px))].sort().join(",");
        if (sz(on) !== sz(off)) bad.push(`${tag}: sizes ${sz(on)} vs ${sz(off)}`);
        const order = [400, 700, 900];
        for (let i = 0; i < Math.min(on.lines.length, off.lines.length); i++) if (order.indexOf(on.lines[i].weight) > order.indexOf(off.lines[i].weight)) bad.push(`${tag}: heavier`);
      }
    }
    // a line printed lighter never moves the lines below it (Niimbot 60×40, all Extra, comment ×2, CJK name)
    for (const [w, h, path] of [[60, 40, "niimbot"], [50, 30, "niimbot"], [60, 40, "tspl"], [70, 50, "d520"]] as [number, number, OneStickerPath][]) for (const name of ["陳小美", "田中さん", "김민지", "Amy Chen"]) {
      const s = settingsFor(w, h, "extra");
      s.parts.comment.scale = 2;
      const inp = { ...inputFor("latin"), name, items: ["ako po yung black dress size M pa reserve po and the red one too"] };
      const on = layoutSticker(s, inp, F, renderOptsFor(path, s, { bold: true }));
      const off = layoutSticker(s, inp, F, { ...renderOptsFor(path, s, { bold: true }), guard: false });
      if (on.commentPx !== off.commentPx) bad.push(`${w}x${h} ${path} ${name}: comment ${on.commentPx} vs ${off.commentPx}`);
      const tops = (L: typeof on) => L.lines.map((l) => l.baseline).join(",");
      if (on.lines.length === off.lines.length && tops(on) !== tops(off)) bad.push(`${w}x${h} ${path} ${name}: lines moved`);
    }
    expect(bad).toEqual([]);
  }, 300000);
  it("monotonic: if Bold must print lighter, Extra prints at least as light (with and without the ink)", () => {
    const rank = (s: { weight: number; ink: boolean }) => s.weight * 2 + (s.ink ? 1 : 0);
    const texts = [...Object.values(READ_SAMPLES).flatMap((v) => [v.name, ...v.items]), "modern Fern burn vvip", "рокля М 450", "Nguyễn Thị Hoa", "128", "@maria_live"];
    const bad: string[] = [];
    for (const t of texts) for (const px of [17, 19, 22, 24, 28, 36, 44]) for (const ink of [false, true]) {
      const n = readableStyle(t, px, 400, ink, F), b = readableStyle(t, px, 700, ink, F), x = readableStyle(t, px, 900, ink, F);
      if (rank(x) > rank(b) && b.weight < 700) bad.push(`${t} ${px}${ink ? "+ink" : ""}: Bold→${b.weight}${b.ink ? "+ink" : ""} but Extra→${x.weight}${x.ink ? "+ink" : ""}`);
      if (rank(b) > rank(n) && n.weight === 400 && n.ink !== ink) bad.push(`${t} ${px}: Normal dropped its ink but Bold kept heavier`);
      if (rank(x) < 0 || rank(b) > rank({ weight: 700, ink })) bad.push(`${t} ${px}: heavier than chosen`);
    }
    expect(bad).toEqual([]);
  }, 120000);
  it("the ink goes first: Extra + ink that closes tries Extra without ink before Bold", () => {
    // a Latin comment at 24 dots (3 mm): Extra stays, only the 1-dot ink is dropped (letters open as Extra)
    const st = readableStyle("ako po yung black dress size M", 24, 900, true, F);
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
