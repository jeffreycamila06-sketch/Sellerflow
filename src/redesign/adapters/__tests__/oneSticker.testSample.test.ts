// Audit 9: the Printer Test + long-comment tests print the SAME sample as the preview (#128 Maria Santos
// @maria_live, the seller's own shop), the long tests swapping only the comment; no @sellerflow, no
// brand, no brand QR.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { sampleBuyer, sampleInput, oneStickerInputFrom, ONE_STICKER_SAMPLE, testPrintFor, saveOneSticker, setOneStickerVisible, __resetOneStickerState, LS_ONE_STICKER } from "../oneStickerPrint";
import { buildTestBuyer } from "../printerBridge";
import { recommendedSettings } from "../oneSticker";
import { tiktokProfileUrl } from "../../../lib/tiktokHandle";

describe("test prints = the preview's sample", () => {
  it("the sample order prints exactly what the preview shows (same moment)", () => {
    const at = Date.UTC(2026, 10, 8, 6, 5);
    const fromOrder = oneStickerInputFrom(sampleBuyer(undefined, at), "Budgetukay", at);
    const preview = sampleInput("Budgetukay", at);
    expect({ ...fromOrder, fbNameOnly: undefined }).toEqual({ ...preview, fbNameOnly: undefined });
    expect(preview).toMatchObject({ buyerNum: 128, name: "Maria Santos", handle: "maria_live", platform: "TikTok", items: ["COMMENT / PRICE"] });
  });
  it("the long tests swap only the comment", () => {
    const b = sampleBuyer("ako po yung black dress size M");
    expect(b).toMatchObject({ num: ONE_STICKER_SAMPLE.buyerNum, name: "Maria Santos", handle: "maria_live", platform: "TikTok" });
    expect(b.orders[0].item).toBe("ako po yung black dress size M");
  });
  it("no @sellerflow, no brand shop line, no brand QR", () => {
    const inp = oneStickerInputFrom(sampleBuyer(), "SellerFlowLive");
    expect(inp.storeName).toBe("");
    expect(inp.handle).not.toMatch(/sellerflow/i);
    expect(tiktokProfileUrl(inp.handle ?? "")).toBe("https://tiktok.com/@maria_live");
    const app = fs.readFileSync(path.join(__dirname, "../../RedesignApp.tsx"), "utf8");
    const onTest = app.slice(app.indexOf("onTest={(draft, sample, unsaved)"), app.indexOf("onTest={(draft, sample, unsaved)") + 900);
    expect(onTest).toContain("sampleBuyer(");
    expect(onTest).not.toContain("buildTestBuyer");
    expect(onTest).toContain("await oneStickerTestPrint(draft, buyer, unsaved)");
    const helper = app.slice(app.indexOf("const oneStickerTestPrint = async"), app.indexOf("const oneStickerTestPrint = async") + 400);
    expect(helper).toContain("printOneStickerTest(draft, buyer, cur, stickerShopName(printShopName)"); // the seller's shop, never the brand
  });
});

describe("Printer settings / old-pattern test print (audit-2 item 3)", () => {
  it("a device that never saved the new sticker: exactly today's test buyer and shop (same objects)", () => {
    __resetOneStickerState(); localStorage.removeItem(LS_ONE_STICKER);
    const b = buildTestBuyer();
    const r = testPrintFor(b, "SellerFlowLive");
    expect(r.buyer).toBe(b);
    expect(r.storeName).toBe("SellerFlowLive");
    expect(testPrintFor(b, undefined).storeName).toBeUndefined();
  });
  it("a device on the new sticker (phone and laptop): the preview's sample, the seller's own shop — never @sellerflow or the brand", () => {
    saveOneSticker(recommendedSettings({ w: 60, h: 40 })); setOneStickerVisible(true);
    const r = testPrintFor(buildTestBuyer(), "SellerFlowLive");
    expect(r.buyer).toMatchObject({ num: 128, name: "Maria Santos", handle: "maria_live" });
    expect(r.storeName).toBe("");
    expect(testPrintFor(buildTestBuyer(), "Budgetukay").storeName).toBe("Budgetukay");
    __resetOneStickerState(); localStorage.removeItem(LS_ONE_STICKER);
  });
  it("wired in Printer settings (Test print + the setup test) and the RedesignApp test print (laptop / web)", () => {
    const ps = fs.readFileSync(path.join(__dirname, "../../screens/PrinterSettings.tsx"), "utf8");
    expect(ps.match(/testPrintFor\(/g)?.length).toBe(2);
    expect(ps).not.toMatch(/printStickerBtRouted\(testBuyer\(\)/);
    const app = fs.readFileSync(path.join(__dirname, "../../RedesignApp.tsx"), "utf8");
    expect(app).toContain("const { buyer: testBuyer, storeName } = testPrintFor(todayBuyer, printShopName);");
  });
});
