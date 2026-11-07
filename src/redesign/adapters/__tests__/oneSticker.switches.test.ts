// RELEASE RULES — proven on the bytes each printer receives:
//   1. switch OFF (even with a saved new pattern on the device) → today's bytes on EVERY path
//   2. switch ON but this device never saved the new pattern → today's bytes on every path
//   3. switch ON + saved → the new picture on the image paths only; the TEXT sticker (old app /
//      Classic text), the WiFi sticker and the receipt slip are untouched (Branch 2)
//   4. all-scripts switch: English / Latin / Chinese stickers byte-identical ON vs OFF on every image
//      path and size; Japanese kana prints only when ON
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { printSlip, DEF_SETTINGS, setStickerQrEntitled, setStickerQrOn, setStickerCompactV2, buildGenericStickerBytes, buildNiimbotImage, buildNativeStickerPayload, __resetNativePrintQueue, __resetWebPrintQueue, type Settings } from "../printing";
import { setOneStickerVisible, saveOneSticker, __resetOneStickerState, LS_ONE_STICKER } from "../oneStickerPrint";
import { setStickerAllScripts, prepareAllScripts, augmentAtlases, runEmFor } from "../oneStickerScripts";
import { recommendedSettings } from "../oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import { fallbackRun } from "../oneStickerFonts";
import { topology } from "../oneStickerReadable";
import { withSyntheticCjk, wrapCommentV2 } from "../stickerRaster";
import type { Buyer } from "../../../lib/orderTypes";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 7, 6, 5);
const buyer = (name: string, item: string, platform = "TikTok"): Buyer => ({
  num: 12, name, handle: "amy.shop", platform, totalSpent: 0, totalOrders: 1,
  orders: [{ orderNum: AT, item, qty: 1, price: 0, total: 0, time: "14:05", handle: "amy.shop", name, bNum: 12, platform, status: "New", date: "2026-11-07" }],
} as unknown as Buyer);
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);

type Path = "d520" | "text" | "generic" | "niimbot" | "lan" | "slip" | "web";
async function capture(path: Path, b: Buyer, size = "60x40"): Promise<string> {
  __resetNativePrintQueue(); __resetSavedPrinter(); __resetWebPrintQueue();
  const ok = () => vi.fn(async () => ({ ok: true }));
  if (path === "web") {
    delete (window as W).SellerFlowPrinter;
    let frame: HTMLIFrameElement | null = null;
    const orig = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "iframe") frame = el as HTMLIFrameElement; return el; });
    printSlip(b, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: size }, { at: AT });
    await vi.waitFor(() => expect((frame as HTMLIFrameElement | null)?.contentDocument?.documentElement.outerHTML ?? "").toContain("<body"));
    await new Promise((r) => setTimeout(r, 30));
    const html = (frame as unknown as HTMLIFrameElement).contentDocument!.documentElement.outerHTML;
    spy.mockRestore(); __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
    return sha(html);
  }
  const br: Record<string, ReturnType<typeof vi.fn>> = path === "text" ? { printStickerNative: ok() } : path === "lan" ? { printStickerLan: ok(), printStickerNative: ok() } : path === "slip" ? { printSlip: ok() } : { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  if (path === "generic") rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
  if (path === "niimbot") rememberSavedPrinter({ address: "AA", name: "B1-H1", transport: "niimbot" });
  (window as W).SellerFlowPrinter = br;
  const cfg: Settings = { ...DEF_SETTINGS, stickerSize: size, printerType: path === "lan" || path === "slip" ? "lan" : "bluetooth", lanFormat: path === "lan" ? "sticker" : "receipt" };
  printSlip(b, "NT$", "My Shop", cfg, { at: AT });
  const fn = { d520: "printStickerBitmap", text: "printStickerNative", generic: "printRawTspl", niimbot: "printStickerImage", lan: "printStickerLan", slip: "printSlip" }[path];
  await vi.waitFor(() => expect(br[fn].mock.calls.length).toBe(1), { timeout: 20000 });
  const arg = JSON.parse(JSON.stringify(br[fn].mock.calls[0][0]));
  if (path === "slip") delete arg.createdAt; // the slip's own clock
  delete (window as W).SellerFlowPrinter;
  return sha(JSON.stringify(arg));
}
const PATHS: Path[] = ["d520", "text", "generic", "niimbot", "lan", "slip", "web"];

beforeAll(() => { installSans(); installNodeFallbackDrawer(); });
afterEach(() => { __resetOneStickerState(); setStickerAllScripts(false); setStickerQrEntitled(false); setStickerQrOn(false); setStickerCompactV2(false); try { localStorage.removeItem(LS_ONE_STICKER); } catch { /* */ } });

describe("one sticker — never switches a device by itself", () => {
  it("switch OFF with a saved pattern, and switch ON without one = today's bytes on every path", async () => {
    const b = buyer("Amy Chen", "A2 x2 350");
    const today: Record<string, string> = {};
    for (const p of PATHS) today[p] = await capture(p, b);
    saveOneSticker({ ...recommendedSettings({ w: 60, h: 40 }), parts: { ...recommendedSettings().parts, comment: { on: true, weight: "extra", scale: 2 } } });
    setOneStickerVisible(false); // switch OFF, device saved
    for (const p of PATHS) expect(await capture(p, b), `off+saved ${p}`).toBe(today[p]);
    localStorage.removeItem(LS_ONE_STICKER); __resetOneStickerState(); setOneStickerVisible(true); // switch ON, never saved here
    for (const p of PATHS) expect(await capture(p, b), `on+unsaved ${p}`).toBe(today[p]);
  }, 60000);
  it("switch ON + saved: only the image paths change; TEXT, WiFi sticker and slip stay today's", async () => {
    const b = buyer("Amy Chen", "A2 x2 350");
    const today: Record<string, string> = {};
    for (const p of PATHS) today[p] = await capture(p, b);
    setOneStickerVisible(true); saveOneSticker(recommendedSettings({ w: 60, h: 40 }));
    for (const p of PATHS) {
      const now = await capture(p, b);
      if (p === "text" || p === "lan" || p === "slip") expect(now, p).toBe(today[p]);
      else expect(now, p).not.toBe(today[p]);
    }
  }, 60000);
});

describe("all-scripts switch", () => {
  const LATIN_CJK = [["Amy Chen", "A2 x2 350"], ["Nguyễn Thị Hằng", "Áo đỏ size M"], ["陳小美", "我要這件黑色洋裝 M 號"], ["Joy M 陳", "黑色 dress 350"], ["José Peña", "B12"]];
  it("English / Latin / Chinese stickers are byte-identical ON vs OFF (D520 every size, compact v2 on/off, generic, Niimbot, QR on/off)", async () => {
    setStickerQrEntitled(true);
    for (const qr of [false, true]) for (const v2 of [false, true]) {
      setStickerQrOn(qr); setStickerCompactV2(v2);
      for (const [name, item] of LATIN_CJK) for (const size of ["100x60", "80x60", "80x50", "70x50", "60x40", "50x30"]) {
        const b = buyer(name, item);
        setStickerAllScripts(false);
        const off = [await capture("d520", b, size)];
        const np = buildNativeStickerPayload(b, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: size });
        for (const lang of ["tspl", "escpos", "cpcl"] as const) off.push(Buffer.from(await buildGenericStickerBytes(lang, np, "TikTok")).toString("base64"));
        off.push(JSON.stringify(await buildNiimbotImage(np, "TikTok")));
        setStickerAllScripts(true);
        const on = [await capture("d520", b, size)];
        for (const lang of ["tspl", "escpos", "cpcl"] as const) on.push(Buffer.from(await buildGenericStickerBytes(lang, np, "TikTok")).toString("base64"));
        on.push(JSON.stringify(await buildNiimbotImage(np, "TikTok")));
        expect(on, `${name} ${size} qr=${qr} v2=${v2}`).toEqual(off);
      }
    }
  }, 300000);
  it("Japanese kana, Korean, Thai and Arabic print only when ON (today they are removed)", async () => {
    for (const [name, item] of [["田中さん", "「ワンピース」１２３"], ["김민지", "원피스"], ["สมใจ", "ชุดสีดำ"], ["مريم", "فستان"]]) {
      const np = buildNativeStickerPayload(buyer(name, item), "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "100x60" });
      setStickerAllScripts(false);
      const off = await buildGenericStickerBytes("escpos", np, "TikTok");
      setStickerAllScripts(true);
      const on = await buildGenericStickerBytes("escpos", np, "TikTok");
      expect(Buffer.from(on).equals(Buffer.from(off)), name).toBe(false);
      // every character that today is removed gets its own cell(s) (the run text is kept whole)
      const prep = prepareAllScripts({ ...np, settings: np.settings }, true, true)!;
      const kept = prep.cells.map((c) => c.text).join("");
      for (const ch of (name + item).replace(/[\u4e00-\u9fff\s]/g, "")) expect(kept, `${name} ${ch}`).toContain(ch);
    }
  }, 60000);

  it("Thai marks above and below the letters are kept (the device font draws into a generous box, then trims)", () => {
    const base = fallbackRun("ทน", 34, 400, false)!, marked = fallbackRun("ที่น้ำ", 34, 400, false)!;
    expect(base && marked).toBeTruthy();
    expect(marked.y0).toBeLessThan(base.y0);                       // ink above the letters (ี ่ ้)
    expect(marked.y0 + marked.h).toBeGreaterThanOrEqual(base.y0 + base.h);
    const below = fallbackRun("ปุ๊", 34, 400, false)!;             // ุ under the letter
    expect(below.y0 + below.h).toBeGreaterThan(base.y0 + base.h);
  });
  it("Thai / Arabic / Korean runs in EVERY cell (18 / 20 / 24 / 32 — Niimbot, generic 50×30, compact v2): no ink lost, no stroke broken, as big as the cell allows", () => {
    const text = "ชุด ญี่ปุ่น ที่น้ำ ขอบคุณค่ะ مريم العربية 김민지 한국어 원피스";
    const np = buildNativeStickerPayload(buyer("Amy", text), "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "50x30" });
    const prep = prepareAllScripts(np, true, true)!;
    const empty = (n: number) => ({ cjk: { w: n, h: n, glyphs: {} } });
    const at = augmentAtlases({ latin: {}, cjk: empty(24), cjkReg: { 18: empty(18), 20: empty(20), 24: empty(24), 32: empty(32) } }, prep);
    const inkOf = (b64: string) => [...Buffer.from(b64, "base64")].reduce((a, x) => { let n = 0; for (let v = x; v; v &= v - 1) n++; return a + n; }, 0);
    const bitsInk = (g: { w: number; h: number; rowBytes: number; buf: Uint8Array }) => { let n = 0; for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.buf[y * g.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) n++; return n; };
    const cut = (em: number) => (em < 20 ? 80 : 128);
    const lost: string[] = [];
    for (const [cell, font, reg] of [[24, at.cjk!.cjk, false], ...([18, 20, 24, 32] as const).map((c) => [c, at.cjkReg![c]!.cjk, true] as const)] as const) {
      for (const c of prep.cells) {
        if (c.one) continue;
        const em = reg ? prep.regEm.get(c.pua[0])!.get(cell)! : 17;
        expect(em, `${cell} ${c.text}`).toBeGreaterThanOrEqual(runEmFor(cell));
        // Hangul has no marks above / below: it keeps the whole cell
        if (reg && /[\uac00-\ud7af]/.test(c.text)) expect(em, `${cell} ${c.text}`).toBe(cell);
        const whole = fallbackRun(c.text, em, 400, c.rtl, cut(em))!;
        const got = c.pua.reduce((a, cp) => a + inkOf(font.glyphs[cp]), 0);
        if (got < bitsInk(whole)) lost.push(`cell ${cell} "${c.text}": ${bitsInk(whole) - got} dots lost`);
        // no stroke broken: as many separate pieces of ink as the same run drawn twice as big
        const parts = (g: Parameters<typeof topology>[0]) => topology(g).parts;
        const big = fallbackRun(c.text, em * 2, 400, c.rtl)!;
        if (parts(whole) > parts(big)) lost.push(`cell ${cell} "${c.text}": strokes broken (${parts(whole)} pieces vs ${parts(big)} at 2×)`);
      }
    }
    expect(lost).toEqual([]);
  });
  it("a Thai / Korean word stays whole: one run per word (real spaces between), no gap or line break inside it", () => {
    const np = buildNativeStickerPayload(buyer("สมใจ", "ชุด สีดำ"), "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "100x60" });
    const prep = prepareAllScripts(np, true, true)!;
    expect(prep.cells.map((c) => c.text)).toEqual(["สมใจ", "ชุด", "สีดำ"]); // left-to-right: the space is a real space
    // right-to-left keeps a phrase together (its words in reading order)
    const ar = prepareAllScripts(buildNativeStickerPayload(buyer("Amy", "فستان أسود"), "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "100x60" }), true, true)!;
    expect(ar.cells.map((c) => c.text)).toEqual(["فستان أسود"]);
    // the pieces of one word are joined: no line break between them
    const A = 0xe000, B = 0xe001;
    const word = String.fromCodePoint(A, B);
    const charW = (ch: string) => (ch === " " ? 8 : ch.codePointAt(0)! >= 0xe000 ? 20 : 16);
    const lines = withSyntheticCjk(new Set([A, B]), () => wrapCommentV2(`AB ${word}`, () => 16 * 2 + 8 + 20 + 5, 3, charW), null, new Set([A]));
    expect(lines).toEqual(["AB", word]);
    const loose = withSyntheticCjk(new Set([A, B]), () => wrapCommentV2(`AB ${word}`, () => 16 * 2 + 8 + 20 + 5, 3, charW), null, null);
    expect(loose).toEqual([`AB ${String.fromCodePoint(A)}`, String.fromCodePoint(B)]); // without the join: split
  });

  it("iPhone apostrophes, dashes and \"…\" keep a Latin name in the normal layout (folded, never Chinese-size cells)", async () => {
    for (const [fancy, plain] of [["O’Brien", "O'Brien"], ["Ana–Maria", "Ana-Maria"], ["Joy…", "Joy..."], ["“Bea”", '"Bea"']]) {
      setStickerAllScripts(true);
      const on = await capture("d520", buyer(fancy, "A2 350"), "100x60");
      setStickerAllScripts(false);
      const plainOff = await capture("d520", buyer(plain, "A2 350"), "100x60");
      expect(on, fancy).toBe(plainOff);
    }
  }, 60000);
});
