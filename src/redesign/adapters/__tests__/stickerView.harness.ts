// Shared by the TikTok / Facebook view proofs: send ONE print on a path and return exactly what the
// printer was handed (the bridge argument; on a laptop the picture the page is made of).
import { expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { DEF_SETTINGS, __resetNativePrintQueue, __resetWebPrintQueue, setStickerQrEntitled, setStickerQrOn, type Settings } from "../printing";
import { __resetOneStickerState, LS_ONE_STICKER } from "../oneStickerPrint";
import { recommendedSettings, type OneStickerSettings } from "../oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";

export type ViewPath = "d520" | "tspl" | "escpos" | "cpcl" | "niimbot" | "laptop";
export const VIEW_PATHS: readonly ViewPath[] = ["d520", "tspl", "escpos", "cpcl", "niimbot", "laptop"];
export const AT = Date.UTC(2026, 10, 8, 6, 5);
export const SHOP = "Maria Ukay";
/** Niimbot takes at most 50 mm; every other path prints 60×40. QR on (TikTok prints it, Facebook never). */
export const draftFor = (p: ViewPath): OneStickerSettings => ({ ...recommendedSettings(p === "niimbot" ? { w: 50, h: 30 } : { w: 60, h: 40 }), qr: true });
export const cfgFor = (p: ViewPath): Settings => ({ ...DEF_SETTINGS, stickerSize: p === "niimbot" ? "50x30" : "60x40", printerType: "bluetooth" });
export const sha = (v: unknown): string => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
/** The pictures drawn since the last reset (the wrapped renderOneStickerFor pushes here). */
// (kept on globalThis: the wrapper lives in a vi.mock factory, which must not import this file)
type Drawn = { path: string; input: unknown; picture: string; raster?: { w: number; h: number; rowBytes: number; buf: Uint8Array } };
const G = globalThis as unknown as { __sflDrawn?: Drawn[] };
export const drawn: Drawn[] = (G.__sflDrawn ??= []);
export function resetAll(): void {
  delete (window as W).SellerFlowPrinter;
  __resetNativePrintQueue(); __resetWebPrintQueue(); __resetSavedPrinter(); __resetOneStickerState();
  try { localStorage.removeItem(LS_ONE_STICKER); } catch { /* */ }
  setStickerQrEntitled(true); setStickerQrOn(true);
  drawn.length = 0;
}
/** Sends one print (`send`) on `path`; returns what reached the printer + the engine input it was drawn from. */
export async function sentOn(path: ViewPath, send: () => unknown): Promise<{ handed: string; input: unknown; calls: number; raster?: Drawn["raster"] }> {
  drawn.length = 0;
  __resetNativePrintQueue(); __resetWebPrintQueue(); __resetSavedPrinter();
  const ok = () => vi.fn(async (_a: Record<string, unknown>) => ({ ok: true }));
  const br: Record<string, ReturnType<typeof ok>> = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  if (path === "laptop") delete (window as W).SellerFlowPrinter;
  else {
    if (path === "d520") rememberSavedPrinter({ address: "AA", name: "D520BT-Z" });
    if (path === "tspl") rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
    if (path === "escpos" || path === "cpcl") rememberSavedPrinter({ address: "AA", name: "GEN-1", model: "generic", lang: path });
    if (path === "niimbot") rememberSavedPrinter({ address: "AA", name: "B21-C123", transport: "niimbot" });
    (window as W).SellerFlowPrinter = br;
  }
  await send();
  await vi.waitFor(() => expect(drawn.length).toBe(1), { timeout: 20000, interval: 10 });
  expect(drawn[0].path, "drawn for this path").toBe(path);
  if (path === "laptop") return { handed: drawn[0].picture, input: drawn[0].input, calls: 0, raster: drawn[0].raster };
  const fn = path === "d520" ? "printStickerBitmap" : path === "niimbot" ? "printStickerImage" : "printRawTspl";
  await vi.waitFor(() => expect(br[fn].mock.calls.length).toBe(1), { timeout: 20000, interval: 10 });
  const calls = Object.values(br).reduce((a, f) => a + f.mock.calls.length, 0);
  const handed = JSON.stringify(br[fn].mock.calls[0][0]);
  delete (window as W).SellerFlowPrinter;
  return { handed, input: drawn[0].input, calls, raster: drawn[0].raster };
}

/** What Printer Test handed the printer on main (8253c004), per path — taken by running
 *  stickerView.tiktokMain.test.ts there with SFL_PRINT_GOLDEN set. */
export const MAIN_TIKTOK: Record<ViewPath, string> = {
  d520: "544a2f205c1816f663e3d6df4286dff3d145d1dc7b81c25095dd04450936b019",
  tspl: "586e29114f9a6d08ecce88547fd14ec05220f67850b6d3f8a9b8cc7c454ca08e",
  escpos: "e44b34f0929020569aaadf8aacee20d0476bebec5524fff5492abbc052076858",
  cpcl: "b4efce8e7cea4da09b9d36bdad28c0cb8ce60d08b1b19d30fb82f83696cc1b2f",
  niimbot: "0a65a54201fe6546830fe08c604c3671dc08d56192be3b99a50b84f98bd765d2",
  laptop: "cb0506b6d98b6ce00bddcc6e4b45809e586c43cabac702d72d5d84194e1abf62",
};
