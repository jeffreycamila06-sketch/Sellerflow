// Round 4 — the laptop print path:
//   item 5: until a laptop sticker size is chosen (localStorage LAPTOP_SIZE_CHOSEN_KEY) printSlip prints the OLD laptop
//           page (round 2, unchanged) — queued FIRST, then the "choose your size" handler is asked; the sheet can never
//           delay or block a print. Chosen → the bitmap page, no handler.
//   item 1: one failed bitmap build settles ITS job as not printed and the next orders still print, in order.
//   item 2: the page image is shown at its own size (dots ÷ 8 mm) — 50×30's 384-dot bitmap is 48 mm on the 50 mm page.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { printSlip, setWebPrintOutcomeHandler, setLaptopSizeNeededHandler, markLaptopSizeChosen, laptopSizeChosen, __resetLaptopSizeChosen, LAPTOP_SIZE_CHOSEN_KEY, browserStickerPage, __resetWebPrintQueue, __webPrintIdle, DEF_SETTINGS, type Settings } from "../printing";
import { laptopChoiceFromStorage, laptopSizeSheetSeen, markLaptopSizeSheetSeen, __resetLaptopSizeSheetSeen, LAPTOP_SIZE_SHEET_SEEN_KEY } from "../laptopSize";
import { rasterFromBmpDataUrl } from "./printControls.harness";
import type { Buyer } from "../../../lib/orderTypes";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let failBuilds = 0;
vi.mock("../stickerRaster", async (orig) => {
  const m = await orig<typeof import("../stickerRaster")>();
  return { ...m, renderStickerBitmapForJob: (...a: Parameters<typeof m.renderStickerBitmapForJob>) => { if (failBuilds > 0) { failBuilds--; throw new Error("bitmap build failed (test)"); } return m.renderStickerBitmapForJob(...a); } };
});

const cfg = (over: Partial<Settings> = {}): Settings => ({ ...DEF_SETTINGS, ...over });
const buyer = (num: number): Buyer => ({ handle: "annc", name: "Ann Cruz", platform: "TikTok", num, totalSpent: 320, totalOrders: 1,
  orders: [{ orderNum: 1000 + num, item: "A1", qty: 1, price: 320, total: 320, time: "10:00", handle: "annc", name: "Ann Cruz", bNum: num, platform: "TikTok", status: "New", date: "2026-11-03" }] } as Buyer);
const frame = () => document.querySelector("iframe") as HTMLIFrameElement | null;
const pageHtml = () => frame()?.contentDocument?.documentElement.outerHTML || "";

beforeEach(() => { __resetLaptopSizeChosen(); __resetLaptopSizeSheetSeen(); __resetWebPrintQueue(); setWebPrintOutcomeHandler(null); setLaptopSizeNeededHandler(null); vi.useFakeTimers(); failBuilds = 0; });
afterEach(() => { __resetWebPrintQueue(); setWebPrintOutcomeHandler(null); setLaptopSizeNeededHandler(null); vi.useRealTimers(); vi.restoreAllMocks(); document.querySelectorAll("iframe").forEach((f) => f.remove()); });

describe("item 5 — the old laptop page until a size is chosen; the sheet never blocks a print", () => {
  it("no size chosen → the OLD page (driver-sized, text layout) is queued at once; the handler is asked AFTER the page is in the frame", () => {
    expect(laptopSizeChosen()).toBe(false);
    const seen: string[] = [];
    setLaptopSizeNeededHandler(() => { seen.push(pageHtml()); });
    const r = printSlip(buyer(12), "NT$", "My Shop", cfg({ stickerSize: "60x40" }));
    expect(r).toEqual({ ok: true, via: "browser" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("@page{size:auto;margin:0}");        // the old page was ALREADY written when the sheet was asked for
    expect(seen[0]).toContain('class="bnum">Buyer 12');
    expect(seen[0]).not.toContain("data:image/bmp");
    expect(seen[0]).not.toContain("<img");                         // no bitmap at all: origin/main's text page
  });
  it("a handler that throws never breaks the print", async () => {
    setLaptopSizeNeededHandler(() => { throw new Error("sheet exploded"); });
    const printSpy = vi.fn();
    expect(printSlip(buyer(3), "NT$", "My Shop", cfg()).ok).toBe(true);
    vi.spyOn(frame()!.contentWindow as Window, "print").mockImplementation(printSpy);
    await vi.advanceTimersByTimeAsync(60);
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(pageHtml()).toContain('class="bnum">Buyer 3');
  });
  it("size chosen → the bitmap page, no handler call", async () => {
    markLaptopSizeChosen();
    const handler = vi.fn();
    setLaptopSizeNeededHandler(handler);
    printSlip(buyer(5), "NT$", "My Shop", cfg({ stickerSize: "60x40" }));
    await __webPrintIdle();
    expect(handler).not.toHaveBeenCalled();
    expect(pageHtml()).toContain("@page{size:60mm 40mm;margin:0}");
    expect(pageHtml()).toMatch(/<img alt="" src="data:image\/bmp;base64,/);
  });
  it("source pin: the old page is queued BEFORE the handler; the sheet opens only via that handler or the Printer settings screen", () => {
    const src = readFileSync(resolve(__dirname, "../printing.ts"), "utf8");
    const i = src.indexOf("enqueueWebPrint({ id: jobId, html: browserStickerHtml(");
    const j = src.indexOf("laptopSizeNeededHandler?.()");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    const app = readFileSync(resolve(__dirname, "../../RedesignApp.tsx"), "utf8");
    expect(app).toContain("setLaptopSizeNeededHandler(openLaptopSheet)");
    expect(app).toContain('if (screen === "printersettings") openLaptopSheet();');
    expect(app).toMatch(/openLaptopSheet = useCallback\(\(\) => \{ if \(hasNativePrinter\(\) \|\| laptopSizeChosen\(\) \|\| laptopSizeSheetSeen\(\)\) return; markLaptopSizeSheetSeen\(\); setLaptopSheet\(true\); \}/);
    expect(app).toContain('window.addEventListener("storage", onStorage)'); // round 5 (item 4): another tab's choice applies here
  });
});

describe("round 5 (item 3) — storage blocked: the choice and the seen flag live in memory for the session", () => {
  const blocked = () => {
    const boom = () => { throw new Error("SecurityError: storage disabled"); };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 });
    vi.stubGlobal("sessionStorage", { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 });
  };
  afterEach(() => { vi.unstubAllGlobals(); });
  it("localStorage / sessionStorage throw → mark + read still agree; the print reads the same in-memory value", async () => {
    blocked();
    expect(laptopSizeChosen()).toBe(false);
    expect(() => markLaptopSizeChosen()).not.toThrow();
    expect(laptopSizeChosen()).toBe(true);
    const handler = vi.fn();
    setLaptopSizeNeededHandler(handler);
    printSlip(buyer(4), "NT$", "My Shop", cfg({ stickerSize: "60x40" }));
    await __webPrintIdle();
    expect(handler).not.toHaveBeenCalled();                       // chosen → the bitmap page, no sheet
    expect(pageHtml()).toContain("@page{size:60mm 40mm;margin:0}");
  });
  it("the sheet-seen flag: at most once per session even with storage throwing; a new session (reset) asks again", () => {
    blocked();
    expect(laptopSizeSheetSeen()).toBe(false);
    expect(() => markLaptopSizeSheetSeen()).not.toThrow();
    expect(laptopSizeSheetSeen()).toBe(true);
    __resetLaptopSizeSheetSeen();
    expect(laptopSizeSheetSeen()).toBe(false);
  });
  it("with storage working the seen flag is per SESSION (sessionStorage), the chosen flag per device (localStorage)", () => {
    markLaptopSizeSheetSeen();
    expect(sessionStorage.getItem(LAPTOP_SIZE_SHEET_SEEN_KEY)).toBe("1");
    expect(localStorage.getItem(LAPTOP_SIZE_SHEET_SEEN_KEY)).toBeNull();
    markLaptopSizeChosen();
    expect(localStorage.getItem(LAPTOP_SIZE_CHOSEN_KEY)).toBe("1");
  });
});

describe("round 5 (item 4) — another tab's choice", () => {
  it("laptopChoiceFromStorage: only the chosen key set to '1' applies; carries the saved size when readable", () => {
    expect(laptopChoiceFromStorage("k", { key: "k", newValue: "1" }, JSON.stringify({ psType: "bt", psOut: "sticker", psSize: "50x30mm" }))).toEqual({ chosen: true, psSize: "50x30mm" });
    expect(laptopChoiceFromStorage("k", { key: "k", newValue: "1" }, null)).toEqual({ chosen: true });
    expect(laptopChoiceFromStorage("k", { key: "k", newValue: "1" }, "{not json")).toEqual({ chosen: true });
    expect(laptopChoiceFromStorage("k", { key: "k", newValue: null }, null)).toEqual({ chosen: false });
    expect(laptopChoiceFromStorage("k", { key: "other", newValue: "1" }, null)).toEqual({ chosen: false });
  });
});

describe("item 1 — one failed image build never blocks the later prints", () => {
  it("job 1 fails to render → reported not printed; jobs 2 and 3 print, in order", async () => {
    markLaptopSizeChosen();
    failBuilds = 1;
    const outcomes: [string, boolean][] = [];
    setWebPrintOutcomeHandler((id, ok) => outcomes.push([id, ok]));
    printSlip(buyer(1), "NT$", "My Shop", cfg());
    printSlip(buyer(2), "NT$", "My Shop", cfg());
    printSlip(buyer(3), "NT$", "My Shop", cfg());
    await __webPrintIdle();
    expect(outcomes).toEqual([["1001", false]]);                   // the failed job, honest
    const titles: string[] = [];
    const win = frame()!.contentWindow as Window;
    vi.spyOn(win, "print").mockImplementation(() => { titles.push(frame()!.contentDocument!.title); win.onafterprint?.(new Event("afterprint")); });
    await vi.advanceTimersByTimeAsync(1000);
    expect(titles).toEqual(["Sticker #2", "Sticker #3"]);           // the next orders, in order
    expect(outcomes).toEqual([["1001", false], ["1002", true], ["1003", true]]);
  });
});

describe("item 2 — the page image at its own size", () => {
  it("50×30: a 384×240 image is 48 mm × 30 mm on the 50 mm × 30 mm page (1:1, the rest white); 60×40 fills its page", async () => {
    markLaptopSizeChosen();
    printSlip(buyer(1), "NT$", "My Shop", cfg({ stickerSize: "50x30" }));
    await __webPrintIdle();
    const html = pageHtml();
    expect(html).toContain("@page{size:50mm 30mm;margin:0}");
    expect(html).toContain("html,body{width:50mm;height:30mm");
    expect(html).toContain("img{display:block;width:48mm;height:30mm");
    const r = rasterFromBmpDataUrl(html.match(/src="(data:image\/bmp;base64,[^"]+)"/)![1]);
    expect([r.w, r.h]).toEqual([384, 240]);                       // 384 / 8 = 48 mm → never stretched
    __resetWebPrintQueue();
    printSlip(buyer(1), "NT$", "My Shop", cfg({ stickerSize: "60x40" }));
    await __webPrintIdle();
    expect(pageHtml()).toContain("img{display:block;width:60mm;height:40mm");
  });
  it("browserStickerPage: width = dots ÷ 8 for any raster", () => {
    const html = browserStickerPage({ wMm: 50, hMm: 30, img: { w: 384, h: 240, rowBytes: 48, buf: new Uint8Array(48 * 240) }, title: "t" });
    expect(html).toContain("img{display:block;width:48mm;height:30mm");
    expect(html).toContain("@page{size:50mm 30mm;margin:0}");
  });
});
