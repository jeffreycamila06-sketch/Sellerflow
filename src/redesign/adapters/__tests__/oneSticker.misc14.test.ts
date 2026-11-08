// Audit item 14: brand check, printable text (keycaps, variation selectors, modifier letters),
// 24-hour Taipei time, the device-font cache cap, the Bulgarian "Extra".
import { describe, expect, it } from "vitest";
import { printableText } from "../oneStickerText";
import { stickerShopName, oneStickerInputFrom } from "../oneStickerPrint";
import { fallbackRun, setFallbackRunDrawer, RUN_CACHE_MAX, __runCacheSize, EMPTY_GLYPH } from "../oneStickerFonts";
import { buildT } from "../../i18n";
import type { Buyer } from "../../../lib/orderTypes";

describe("audit 14", () => {
  it("the app's brand is never printed as the shop — any case, any spaces", () => {
    for (const b of ["SellerFlowLive", "sellerflowlive", "SELLERFLOWLIVE", "Seller Flow Live", " seller flowlive "]) expect(stickerShopName(b), b).toBe("");
    expect(stickerShopName("Maria Ukay Shop")).toBe("Maria Ukay Shop");
    expect(stickerShopName("SellerFlowLive Fans")).toBe("SellerFlowLive Fans");
  });
  it("keycaps and variation selectors are removed; modifier letters become plain letters", () => {
    expect(printableText("#️⃣")).toBe("");
    expect(printableText("Order 1️⃣ 2⃣ *️⃣ A12")).toBe("Order A12");
    expect(printableText("ᴬᵐʸ")).toBe("Amy");
    expect(printableText("Love️ ❤️ Amy")).toBe("Love Amy");
    expect(printableText("ʰⁱ")).toBe("hi");
    expect(printableText("A12 350")).toBe("A12 350"); // ordinary text untouched
    expect(printableText("陳小美 田中さん")).toBe("陳小美 田中さん");
  });
  it("the time is 24-hour h23 (00:05 after midnight, never 24:05)", () => {
    const ts = Date.UTC(2026, 10, 7, 16, 5); // 00:05 Taipei
    const b = { num: 1, name: "A", handle: "a", platform: "TikTok", orders: [{ orderNum: ts, item: "A1" }] } as unknown as Buyer;
    expect(oneStickerInputFrom(b, "Shop", ts)).toMatchObject({ date: "11/08", time: "00:05" });
  });
  it("the device-font run cache never grows past its cap", () => {
    setFallbackRunDrawer({ drawRun: (_t, px) => EMPTY_GLYPH(px) });
    for (let i = 0; i < RUN_CACHE_MAX + 200; i++) fallbackRun(`w${i}`, 20, 400, false);
    expect(__runCacheSize()).toBeLessThanOrEqual(RUN_CACHE_MAX);
    setFallbackRunDrawer(null);
  });
  it("Bulgarian has its own word for Extra", () => {
    expect(buildT("bg").rd_os_w_extra).not.toBe("Extra");
  });
});
