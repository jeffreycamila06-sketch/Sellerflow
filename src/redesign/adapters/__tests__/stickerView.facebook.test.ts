// TikTok / Facebook view — PROOF, part 2: Printer Test in the FACEBOOK view hands the printer the
// same bytes as a REAL Facebook order of the same buyer (#128 Maria Santos) with the same settings,
// on every print path (D520, TSPL, ESC/POS, CPCL, Niimbot, laptop).
//   Printer Test = printOneStickerTest(draft, viewSampleBuyer("facebook"))   (what the screen calls)
//   real order   = printSlip(buyer) on a phone that saved the same settings   (the order dispatch)
// The real buyer is written out here by hand (not through the view helper), in both shapes a Facebook
// order has: handle = the display name, and handle = the commenter's id (identity v2).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

vi.mock("../oneStickerPrint", async (orig) => {
  const m = await orig<typeof import("../oneStickerPrint")>();
  const G = globalThis as unknown as { __sflDrawn?: { path: string; input: unknown; picture: string }[] };
  return { ...m, renderOneStickerFor: async (...a: Parameters<typeof m.renderOneStickerFor>) => {
    const r = await m.renderOneStickerFor(...a);
    (G.__sflDrawn ??= []).push({ path: a[0], input: a[2], picture: `${r.w}x${r.h}/${r.rowBytes}:${Buffer.from(r.buf).toString("base64")}`, raster: { w: r.w, h: r.h, rowBytes: r.rowBytes, buf: r.buf } } as never);
    return r;
  } };
});

import { printOneStickerTest, printSlip } from "../printing";
import { saveOneSticker, setOneStickerVisible, sampleBuyer, sampleInput, ONE_STICKER_SAMPLE } from "../oneStickerPrint";
import { viewSampleBuyer, viewSampleInput, STICKER_VIEWS } from "../stickerViewSample";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import { AT, SHOP, VIEW_PATHS, MAIN_TIKTOK, cfgFor, draftFor, resetAll, sentOn, sha } from "./stickerView.harness";
import { rasterPng } from "./oneSticker.harness";
import type { Buyer } from "../../../lib/orderTypes";

/** A Facebook order of Maria Santos, buyer #128, as the app holds it (written by hand). */
const realFacebookOrder = (handle: string): Buyer => ({
  num: 128, name: "Maria Santos", handle, platform: "Facebook", totalSpent: 0, totalOrders: 1,
  orders: [{ orderNum: AT, item: "COMMENT / PRICE", qty: 1, price: 0, total: 0, time: "14:05", handle, name: "Maria Santos", bNum: 128, platform: "Facebook", status: "New", date: "2026-11-08" }],
} as unknown as Buyer);

beforeAll(() => { installSans(); installNodeFallbackDrawer(); });
afterEach(() => resetAll());

describe("the view's samples", () => {
  it("four buttons in order; Instagram and Shopee are 'Soon'", () => {
    expect(STICKER_VIEWS.map((v) => `${v.label}${v.soon ? " (soon)" : ""}`)).toEqual(["TikTok", "Facebook", "Instagram (soon)", "Shopee (soon)"]);
  });
  it("TikTok view = today's sample, the very same input and order", () => {
    expect(viewSampleInput("tiktok", SHOP, AT)).toEqual(sampleInput(SHOP, AT));
    expect(viewSampleBuyer("tiktok", undefined, AT)).toEqual(sampleBuyer(undefined, AT));
  });
  it("Facebook view = the same buyer as a Facebook order: no @username, name only, same number / comment / time", () => {
    const fb = viewSampleInput("facebook", SHOP, AT), tt = sampleInput(SHOP, AT);
    expect(fb).toEqual({ ...tt, platform: "Facebook", handle: "", fbNameOnly: true });
    expect(viewSampleBuyer("facebook", undefined, AT)).toMatchObject({ num: ONE_STICKER_SAMPLE.buyerNum, name: "Maria Santos", handle: "Maria Santos", platform: "Facebook" });
  });
});

describe("Facebook view: Printer Test = a real Facebook order, on every print path", () => {
  it.each(VIEW_PATHS)("%s: the same bytes reach the printer", async (p) => {
    resetAll();
    const draft = draftFor(p), cfg = cfgFor(p);
    const test = await sentOn(p, () => printOneStickerTest(draft, viewSampleBuyer("facebook", undefined, AT), "NT$", SHOP, cfg));
    // what the screen's preview draws is what the test print drew
    expect(test.input).toEqual(viewSampleInput("facebook", SHOP, AT));
    // a phone that saved these settings gets a real Facebook order (both handle shapes)
    for (const handle of ["Maria Santos", "24681357902468135"]) {
      resetAll();
      saveOneSticker(draft); setOneStickerVisible(true);
      const real = await sentOn(p, () => printSlip(realFacebookOrder(handle), "NT$", SHOP, cfg));
      expect(real.input, `${p} ${handle}: engine input`).toEqual(test.input);
      expect(real.handed === test.handed, `${p} ${handle}: bytes handed to the printer`).toBe(true);
      expect(real.calls, "one job").toBe(test.calls);
    }
    // the proof pictures (docs/design/pattern-view): SFL_VIEW_PICS=<folder> writes them
    if (process.env.SFL_VIEW_PICS) {
      const save = (name: string, r?: { w: number; h: number; rowBytes: number; buf: Uint8Array }) => { const png = r && rasterPng(r, 1); if (png) fs.writeFileSync(path.join(process.env.SFL_VIEW_PICS!, name), png); };
      save(`${p}-facebook-view.png`, test.raster);
      resetAll();
      save(`${p}-tiktok-view.png`, (await sentOn(p, () => printOneStickerTest(draft, sampleBuyer(undefined, AT), "NT$", SHOP, cfg))).raster);
    }
    // and it is a different sticker from the TikTok view (no @username, no QR)
    expect(sha(test.handed)).not.toBe(MAIN_TIKTOK[p]);
  }, 120000);
});

describe("wiring", () => {
  it("RedesignApp: Printer Test prints the picked view through the screen's one test print; nothing else changed", () => {
    const app = fs.readFileSync(path.join(__dirname, "../../RedesignApp.tsx"), "utf8");
    const i = app.indexOf("onTest={(draft, sample, unsaved, view)");
    expect(i).toBeGreaterThan(0);
    const h = app.slice(i, i + 900);
    expect(h).toContain('view === "facebook" ? viewSampleBuyer("facebook") : sampleBuyer(sample === "en" ? V2_SAMPLE_LATIN : sample === "zh" ? V2_SAMPLE_CJK : ONE_STICKER_SAMPLE.items[0])');
    expect(h).toContain("await oneStickerTestPrint(draft, buyer, unsaved)");
  });
  it("the view is never stored and touches no print code", () => {
    const helper = fs.readFileSync(path.join(__dirname, "../stickerViewSample.ts"), "utf8");
    const screen = fs.readFileSync(path.join(__dirname, "../../components/OneStickerPattern.tsx"), "utf8");
    expect(helper).not.toMatch(/localStorage|sessionStorage/);
    expect(screen).toContain('useState<StickerView>("tiktok")');
    expect(screen).not.toMatch(/localStorage|sessionStorage/);
    expect(helper).not.toMatch(/from "\.\/printing"/);
  });
});
