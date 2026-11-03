// Round 5 (item 1): a laptop with NO sticker size chosen prints origin/main's browser page EXACTLY — byte-identical
// HTML to origin/main (4abe581) `printSlip`'s web fallback for every size × control × level × switch × QR × Facebook
// name. The fixture is main's block, verbatim (fixtures/mainBrowserPage.ts). Size levels and the TikTok-name /
// Date&time switches are ignored in that mode, as main ignored them.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { printSlip, browserStickerHtml, setStickerQrOn, setStickerQrEntitled, __resetLaptopSizeChosen, __resetWebPrintQueue, DEF_SETTINGS, type Settings } from "../printing";
import { mainBrowserPage } from "./fixtures/mainBrowserPage";
import { printableBuyer, fbNameOnly } from "../fbName";
import type { Buyer } from "../../../lib/orderTypes";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AT = Date.UTC(2026, 10, 3, 6, 5, 0);
const SIZES = ["100x60", "80x60", "80x50", "70x50", "60x40", "50x30"];
const LEVELS = [1, 2, 3];
const SWITCHES: (keyof Settings)[] = ["printStoreName", "printBuyerNumber", "printBuyerName", "printBuyerUsername", "printOrderItems", "printDateTime"];
const SCALES: (keyof Settings)[] = ["printStoreScale", "printBuyerNumberScale", "printBuyerNameScale", "printUsernameScale", "printCommentScale"];
const tiktok: Buyer = { handle: "annc", name: "Ann Cruz", platform: "TikTok", num: 12, totalSpent: 320, totalOrders: 1,
  orders: [{ orderNum: 1, item: "A2 x2", qty: 1, price: 320, total: 320, time: "14:05", handle: "annc", name: "Ann Cruz", bNum: 12, platform: "TikTok", status: "New", date: "2026-11-03" }] } as Buyer;
const facebook: Buyer = { ...tiktok, platform: "Facebook", handle: "Maria Santos Dela Cruz", name: "Maria Santos Dela Cruz" } as Buyer;
const cjk: Buyer = { ...tiktok, name: "王小明", orders: [{ ...tiktok.orders[0], item: "我要黑色" }] } as Buyer;
// main's printSlip derives fbName/cfg before the page — mirrored here so the fixture sees the same inputs
const expectPage = (b: Buyer, base: Settings) => {
  const buyer = printableBuyer(b);
  const fbName = fbNameOnly(buyer.platform, buyer.name) && base.printBuyerUsername !== false;
  const cfg: Settings = fbName ? { ...base, printBuyerUsername: false } : base;
  return { got: browserStickerHtml({ buyer, cur: "NT$", storeName: "My Shop", cfg, fbName, at: AT }), want: mainBrowserPage(buyer, cfg, "My Shop", fbName, AT) };
};

beforeEach(() => { __resetLaptopSizeChosen(); __resetWebPrintQueue(); setStickerQrEntitled(false); setStickerQrOn(false); });
afterEach(() => { __resetWebPrintQueue(); setStickerQrEntitled(false); setStickerQrOn(false); vi.restoreAllMocks(); document.querySelectorAll("iframe").forEach((f) => f.remove()); });

describe("the old laptop page == origin/main, byte for byte", () => {
  it("every size × every switch off × every level 1–3 of every control, QR off and on, TikTok / Facebook / Chinese buyers", () => {
    let n = 0;
    for (const qr of [false, true]) {
      setStickerQrEntitled(qr); setStickerQrOn(qr);
      for (const size of SIZES) {
        const cases: Settings[] = [{ ...DEF_SETTINGS, stickerSize: size }];
        for (const k of SWITCHES) cases.push({ ...DEF_SETTINGS, stickerSize: size, [k]: false } as Settings);
        for (const k of SCALES) for (const lv of LEVELS) cases.push({ ...DEF_SETTINGS, stickerSize: size, [k]: lv } as Settings);
        cases.push({ ...DEF_SETTINGS, stickerSize: size, printStoreScale: 3, printBuyerNumberScale: 3, printBuyerNameScale: 3, printUsernameScale: 3, printCommentScale: 3, printDateTime: false, printBuyerName: false } as Settings);
        for (const cfg of cases) for (const b of [tiktok, facebook, cjk]) { const { got, want } = expectPage(b, cfg); expect(got).toBe(want); n++; }
      }
    }
    expect(n).toBeGreaterThan(700);
  });
  it("levels and the TikTok-name / Date&time switches change NOTHING on that page (main had none of them)", () => {
    const base = expectPage(tiktok, { ...DEF_SETTINGS, stickerSize: "60x40" }).got;
    expect(expectPage(tiktok, { ...DEF_SETTINGS, stickerSize: "60x40", printBuyerNumberScale: 3, printCommentScale: 3 } as Settings).got).toBe(base);
    expect(expectPage(tiktok, { ...DEF_SETTINGS, stickerSize: "60x40", printBuyerName: false, printDateTime: false } as Settings).got).toBe(base);
    expect(base).toContain("@page{size:auto;margin:0}");
    expect(base).toContain('<div class="name">Ann Cruz</div>');
    expect(base).toContain('<span class="date">11/03/2026</span>');
  });
  it("printSlip with no size chosen writes exactly that page into the print frame", async () => {
    vi.useFakeTimers();
    try {
      printSlip(tiktok, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: "60x40", printCommentScale: 3 } as Settings, { at: AT });
      const html = document.querySelector("iframe")?.contentDocument?.documentElement.outerHTML || "";
      const want = expectPage(tiktok, { ...DEF_SETTINGS, stickerSize: "60x40", printCommentScale: 3 } as Settings).want;
      // the frame's serialisation drops the doctype and normalises nothing else → compare from <html>
      expect(html).toBe(want.replace("<!DOCTYPE html>", ""));
    } finally { vi.useRealTimers(); }
  });
  it("the fixture IS origin/main's block (header pin) and printing.ts says so", () => {
    const fx = readFileSync(resolve(__dirname, "fixtures/mainBrowserPage.ts"), "utf8");
    expect(fx).toContain("origin/main (4abe581)");
    expect(fx).toContain("`@page{size:auto;margin:0}`");
    expect(readFileSync(resolve(__dirname, "../printing.ts"), "utf8")).toContain("origin/main's browser print (4abe581), VERBATIM");
  });
});
