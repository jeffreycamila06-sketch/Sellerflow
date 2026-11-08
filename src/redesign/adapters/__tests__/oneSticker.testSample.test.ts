// Audit 9: the Printer Test + long-comment tests print the SAME sample as the preview (#128 Maria Santos
// @maria_live, the seller's own shop), the long tests swapping only the comment; no @sellerflow, no
// brand, no brand QR.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { sampleBuyer, sampleInput, oneStickerInputFrom, ONE_STICKER_SAMPLE } from "../oneStickerPrint";
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
    expect(onTest).toContain("stickerShopName(printShopName)");
  });
});
