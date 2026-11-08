// ADMIN language test: Printer Test prints the picked sample through the NORMAL print functions, with
// the same input the preview drew; "Today's sticker" goes through printSlip (the real-order dispatch)
// with the one sticker off — today's sticker + the all-scripts language fix.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const seen = vi.hoisted(() => ({ inputs: [] as unknown[] }));
vi.mock("../oneStickerPrint", async (orig) => {
  const m = await orig<typeof import("../oneStickerPrint")>();
  return { ...m, renderOneStickerFor: (...a: Parameters<typeof m.renderOneStickerFor>) => { seen.inputs.push(a[2]); return m.renderOneStickerFor(...a); } };
});

import { printSlip, printOneStickerTest, DEF_SETTINGS, __resetNativePrintQueue, type Settings } from "../printing";
import { saveOneSticker, setOneStickerVisible, __resetOneStickerState, LS_ONE_STICKER } from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";
import { setStickerAllScripts } from "../oneStickerScripts";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { ADMIN_LANG_SAMPLES, adminSampleBuyer, adminSampleInput } from "../adminLangSamples";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 8, 6, 5);
const cfg: Settings = { ...DEF_SETTINGS, stickerSize: "60x40", printerType: "bluetooth" };
const bridge = () => ({ printStickerNative: vi.fn(async () => ({ ok: true })), printStickerBitmap: vi.fn(async () => ({ ok: true })) });

beforeAll(() => { installSans(); installNodeFallbackDrawer(); });
afterEach(() => { delete (window as W).SellerFlowPrinter; __resetOneStickerState(); __resetSavedPrinter(); __resetNativePrintQueue(); setStickerAllScripts(false); seen.inputs.length = 0; try { localStorage.removeItem(LS_ONE_STICKER); } catch { /* */ } });

describe("admin language test — prints through the normal path", () => {
  it("the samples: 11 chips, the requested languages, Facebook without @/QR, Buyer #1234", () => {
    expect(ADMIN_LANG_SAMPLES.map((s) => s.label)).toEqual(["English", "中文", "日本語", "한국어", "ไทย", "العربية", "Български", "Tiếng Việt", "Fancy/emoji", "Facebook", "Buyer #1234"]);
    expect(ADMIN_LANG_SAMPLES.find((s) => s.key === "ja")!.item).toBe("田中さん「ワンピース」１２３");
    expect(ADMIN_LANG_SAMPLES.find((s) => s.key === "fancy")!.name).toBe("🔥𝓐𝓶𝔂 𝐋𝐢𝐦🔥");
    expect(ADMIN_LANG_SAMPLES.find((s) => s.key === "n1234")!.num).toBe(1234);
    const fb = adminSampleInput(ADMIN_LANG_SAMPLES.find((s) => s.key === "fb")!, "My Shop", AT);
    expect(fb.fbNameOnly).toBe(true);
  });
  it("New sticker: printOneStickerTest renders EXACTLY the preview's input for every sample (D520 picture sent)", async () => {
    for (const s of ADMIN_LANG_SAMPLES) {
      __resetNativePrintQueue(); seen.inputs.length = 0;
      const br = bridge(); (window as W).SellerFlowPrinter = br;
      rememberSavedPrinter({ address: "AA", name: "D520BT-Z" });
      const r = await printOneStickerTest(recommendedSettings({ w: 60, h: 40 }), adminSampleBuyer(s, AT), "NT$", "My Shop", cfg);
      expect(r.ok, s.key).toBe(true);
      expect(br.printStickerBitmap, s.key).toHaveBeenCalledTimes(1);
      expect(seen.inputs[0], s.key).toEqual(adminSampleInput(s, "My Shop", AT));
    }
  }, 120000);
  it("Today's sticker: printSlip with the one sticker off → today's bytes even on a device that saved the new sticker; the new engine is not used", async () => {
    setStickerAllScripts(true); // admins have the language fix on
    const ja = adminSampleBuyer(ADMIN_LANG_SAMPLES.find((s) => s.key === "ja")!, AT);
    const send = async () => {
      __resetNativePrintQueue();
      const br = bridge(); (window as W).SellerFlowPrinter = br;
      rememberSavedPrinter({ address: "AA", name: "D520BT-Z" });
      printSlip(ja, "NT$", "My Shop", cfg, { noOneSticker: true });
      await vi.waitFor(() => expect(br.printStickerBitmap.mock.calls.length).toBe(1), { timeout: 20000, interval: 20 });
      return JSON.stringify(br.printStickerBitmap.mock.calls[0]);
    };
    const today = await send(); // nothing saved = today's sticker
    saveOneSticker(recommendedSettings({ w: 60, h: 40 })); setOneStickerVisible(true);
    seen.inputs.length = 0;
    expect(await send(), "saved device, Today's sticker chosen").toBe(today);
    expect(seen.inputs.length, "the new sticker engine never ran").toBe(0);
  }, 60000);
  it("RedesignApp: admin-only wiring — New = the screen's own test print, Today's = printSlip with noOneSticker", () => {
    const app = fs.readFileSync(path.join(__dirname, "../../RedesignApp.tsx"), "utf8");
    expect(app).toMatch(/isAdmin=\{isAdmin\}\s*onTestSample=\{isAdmin \? \(draft, sample, route, unsaved\) =>/);
    const h = app.slice(app.indexOf("onTestSample={isAdmin ?"), app.indexOf("onTestSample={isAdmin ?") + 700);
    expect(h).toContain('if (route === "new") { await oneStickerTestPrint(draft, buyer, unsaved); return; }');
    expect(h).toMatch(/printSlip\(buyer, cur, stickerShopName\(printShopName\), buildSettingsFromRedesign\(\{ pp, psType, psOut, psSize \}\), \{ noOneSticker: true \}\)/);
    expect(h).toContain(": undefined}");
  });
});
