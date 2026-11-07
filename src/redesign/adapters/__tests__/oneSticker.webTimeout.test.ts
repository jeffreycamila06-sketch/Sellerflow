// Laptop: a sticker picture that is not ready in time (a font file stuck on a bad connection) must
// never hold the print queue — that sticker prints today's page and the next order still prints.
import { describe, expect, it, vi } from "vitest";
vi.mock("../oneStickerFonts", async (orig) => {
  const real = await orig<typeof import("../oneStickerFonts")>();
  return { ...real, loadSansFace: () => new Promise(() => {}) }; // never arrives
});
import { printSlip, DEF_SETTINGS, __resetWebPrintQueue, __webPrintIdle, ONE_STICKER_WEB_TIMEOUT_MS, getLastOneStickerWebMiss } from "../printing";
import { setOneStickerVisible, saveOneSticker, __resetOneStickerState } from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";
import type { Buyer } from "../../../lib/orderTypes";

describe("laptop picture timeout", () => {
  it("prints today's page after the time limit (never stuck, never blank)", async () => {
    vi.useFakeTimers();
    try {
      __resetWebPrintQueue(); __resetOneStickerState(); setOneStickerVisible(true); saveOneSticker(recommendedSettings({ w: 60, h: 40 }));
      let frame: HTMLIFrameElement | null = null;
      const orig = document.createElement.bind(document);
      const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "iframe") frame = el as HTMLIFrameElement; return el; });
      const b = { num: 3, name: "Amy", handle: "amy", platform: "TikTok", orders: [{ orderNum: Date.now(), item: "A1" }] } as unknown as Buyer;
      expect(printSlip(b, "NT$", "Shop", { ...DEF_SETTINGS }).via).toBe("browser");
      await vi.advanceTimersByTimeAsync(ONE_STICKER_WEB_TIMEOUT_MS + 100);
      await __webPrintIdle();
      await vi.advanceTimersByTimeAsync(100);
      const html = (frame as HTMLIFrameElement | null)?.contentDocument?.documentElement.outerHTML ?? "";
      expect(html).toContain("Buyer 3"); // today's page
      expect(getLastOneStickerWebMiss()?.error).toMatch(/timeout/);
      spy.mockRestore();
    } finally { vi.useRealTimers(); __resetOneStickerState(); __resetWebPrintQueue(); }
  });
});
