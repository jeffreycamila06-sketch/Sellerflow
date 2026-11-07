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
import { setStickerAllScripts, prepareAllScripts } from "../oneStickerScripts";
import { recommendedSettings } from "../oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
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
});
