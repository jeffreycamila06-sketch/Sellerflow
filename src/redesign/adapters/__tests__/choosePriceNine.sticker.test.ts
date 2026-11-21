// Choose price before print, 9 prices — the printed sticker is the one main prints for that price.
// Part 1 (choosePriceNine.app.test.tsx): tapping the 9th price (NT$300) makes the very same createOrder
// call main makes when 300 is tapped, and Free at 9 prices the same call as Free at 3. Part 2 (here):
// that order, built by the SAME order builder the app uses (buildOrderFromComment → singleOrderBuyer),
// reaches the printer with the same bytes as on main — on every bluetooth print path, today's sticker
// and the new sticker. The fingerprints below were taken by running THIS file on main (991c24b2, before
// the 9-price change) with SFL_PRINT_GOLDEN=<file>. Fingerprint = sha256 of the bridge argument.
// THE CLOCK IS PINNED to AT for the whole file: today's sticker prints the day it is printed, so without
// the pin the fingerprints only matched on the day they were taken (main CI went red on Nov 22 Taipei).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { printSlip, DEF_SETTINGS, __resetNativePrintQueue, __resetWebPrintQueue, setStickerQrEntitled, setStickerQrOn, type Settings } from "../printing";
import { __resetOneStickerState, LS_ONE_STICKER, setOneStickerVisible, oneStickerActive } from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import { buildOrderFromComment } from "../../../lib/orderLogic";
import { FREE_ITEM } from "../../../lib/freeOrder";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

type Path = "d520" | "tspl" | "escpos" | "cpcl" | "niimbot";
const PATHS: Path[] = ["d520", "tspl", "escpos", "cpcl", "niimbot"];
type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = new Date(Date.UTC(2026, 10, 21, 6, 5));              // 14:05 Taipei
const comment: ProdComment = {
  handle: "maria_live", name: "Maria Santos", comment: "mine po #12", platform: "TikTok",
  isBuy: false, buyerNum: null, buyerData: null, time: "14:05:00", timestamp: AT.toISOString(), sessionId: "s1", sourceUsername: "",
} as ProdComment;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const cfgFor = (p: Path): Settings => ({ ...DEF_SETTINGS, stickerSize: p === "niimbot" ? "50x30" : "60x40", printerType: "bluetooth" });

/** The order a price tap makes (useOrders.createOrder: the same builder, then itemOverride for Free). */
function buyerFor(price: number, free = false) {
  const { order, singleOrderBuyer } = buildOrderFromComment(comment, [], price, AT);
  if (free) order.item = FREE_ITEM;
  return singleOrderBuyer;
}

async function handed(path: Path, send: () => unknown): Promise<string> {
  __resetNativePrintQueue(); __resetWebPrintQueue(); __resetSavedPrinter();
  const ok = () => vi.fn(async (_a: Record<string, unknown>) => ({ ok: true }));
  const br: Record<string, ReturnType<typeof ok>> = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  if (path === "d520") rememberSavedPrinter({ address: "AA", name: "D520BT-Z" });
  if (path === "tspl") rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
  if (path === "escpos" || path === "cpcl") rememberSavedPrinter({ address: "AA", name: "GEN-1", model: "generic", lang: path });
  if (path === "niimbot") rememberSavedPrinter({ address: "AA", name: "B21-C123", transport: "niimbot" });
  (window as W).SellerFlowPrinter = br;
  await send();
  await vi.waitFor(() => expect(Object.values(br).reduce((a, f) => a + f.mock.calls.length, 0)).toBe(1), { timeout: 20000, interval: 10 });
  const fn = Object.keys(br).find((k) => br[k].mock.calls.length === 1)!;
  const arg = JSON.stringify({ fn, arg: br[fn].mock.calls[0][0] });
  delete (window as W).SellerFlowPrinter;
  return arg;
}

const CASES: [string, number, boolean, boolean][] = [
  ["today's sticker, NT$300", 300, false, false],
  ["today's sticker, Free", 0, true, false],
  ["new sticker, NT$300", 300, false, true],
  ["new sticker, Free", 0, true, true],
];

beforeAll(() => {
  installSans(); installNodeFallbackDrawer();
  vi.useFakeTimers({ toFake: ["Date"] });   // only the date — the print queue's timers stay real
  vi.setSystemTime(AT);                       // "now" = AT: the sticker's date is Nov 21 whatever day the test runs
});
afterAll(() => { vi.useRealTimers(); });
afterEach(() => {
  delete (window as W).SellerFlowPrinter;
  __resetNativePrintQueue(); __resetWebPrintQueue(); __resetSavedPrinter(); __resetOneStickerState();
  try { localStorage.removeItem(LS_ONE_STICKER); } catch { /* */ }
});

describe("the sticker of a price picked from 9 = the sticker main prints for that price", () => {
  for (const [what, price, free, newSticker] of CASES) {
    it.each(PATHS)(`${what.replace("NT$", "NT ")} — %s`, async (path) => {
      setStickerQrEntitled(true); setStickerQrOn(true);
      if (newSticker) {
        localStorage.setItem(LS_ONE_STICKER, JSON.stringify({ saved: true, settings: { ...recommendedSettings(path === "niimbot" ? { w: 50, h: 30 } : { w: 60, h: 40 }), qr: true } }));
        setOneStickerVisible(true);
      }
      expect(oneStickerActive() != null).toBe(newSticker);                     // the engine really in use
      const buyer = buyerFor(price, free);
      expect(buyer.orders[0]).toMatchObject(free ? { item: "FREE", price: 0 } : { item: "300", price: 300 });
      const out = await handed(path, () => printSlip(buyer, "NT$", "Maria Ukay", cfgFor(path)));
      const key = `${what} — ${path}`;
      if (process.env.SFL_PRINT_GOLDEN) appendFileSync(process.env.SFL_PRINT_GOLDEN, `  ${JSON.stringify(key)}: "${sha(out)}",\n`);
      else expect(sha(out), key).toBe(MAIN[key]);
    }, 60000);
  }
});

// Taken on main 991c24b2 (before this change), clock pinned to AT (re-taken 2026-11-22 = the same 20):
// SFL_PRINT_GOLDEN=<file> npx vitest run choosePriceNine.sticker
const MAIN: Record<string, string> = {
  "today's sticker, NT$300 — d520": "7a12bf1f4f66cf77bfd7d9cb5626c0899c9ce57846fa3af2dea0b39c1015741e",
  "today's sticker, NT$300 — tspl": "1eadc8b7d0ff4bf7199dd5ee589f83208f33cf3cadb428bd865796f9918f7986",
  "today's sticker, NT$300 — escpos": "86a92bfb612cdb8fc27b2ae7a7e1974920e60fe1f05f96749621ceddaf55fe2e",
  "today's sticker, NT$300 — cpcl": "fdb04ed0b8dd328702bb87606a98c57b747b76c2e82d6d8d06a21f40e4e9d580",
  "today's sticker, NT$300 — niimbot": "803266e17cb7edf048b78c239c60cfbb82fe5d4ab3ac598ee06a9bf816284ba0",
  "today's sticker, Free — d520": "7d4701731f0b5509179370ec1bf80cd8aadee1af4b77c8a788b9ea0d8e4aae32",
  "today's sticker, Free — tspl": "4eea03125c12253bfa0c168dac6f171471dbfb5b121c58413aab063984f57cab",
  "today's sticker, Free — escpos": "ded4ca7af7ade91c85a1e4ff10a5a62d95e05b0c3dd0f7786723f4c6123df1da",
  "today's sticker, Free — cpcl": "ffc6f985fca5e2fb4b803e2ab53bee9162615e3588e185876da5596334e214af",
  "today's sticker, Free — niimbot": "6af8eabcec2b9ac329735f9c06b86098f5f957a42ea7275588e2134eea29e835",
  "new sticker, NT$300 — d520": "85f00060c9c3f15a31496aec603b730e6ebeea57ec44e07191e3412eb8f91ee9",
  "new sticker, NT$300 — tspl": "cb68d12b14cd73ded44fd8648b20b33be746eb1b0ebbfbf721a1b4af0e9d54a8",
  "new sticker, NT$300 — escpos": "19b1edbf23c11e2dc9edb5aac08b9b2b1929557ce471466e4e603d49f0b7255b",
  "new sticker, NT$300 — cpcl": "1314cbc2f11edaf2dc45c1c144a141909c08bf14aedc89d57a283cd43e06f517",
  "new sticker, NT$300 — niimbot": "336256e3e1fbcf51ff742eaaa6f1d53373756c86a1c06f4e0439bd0820fb45e1",
  "new sticker, Free — d520": "c1d9e5831756e8ef920cd0f9f4031cb426922444521781239812d7580ec9b20b",
  "new sticker, Free — tspl": "c0aa89d5d77836fedf05ef4fe93f24ab33c0b1380e8441f92b3d9490d4855281",
  "new sticker, Free — escpos": "23afa9049323aa9e4d5262057541b1421cc49a64d4576b917f7d0290205b9947",
  "new sticker, Free — cpcl": "5478740e97980e7909d9ad45dffc98ad821d26623b8e67999e1e534bf0df2a3c",
  "new sticker, Free — niimbot": "17289650128accfb7b396f5e94acc96ddc1a88f25f9e611d8cfcd0cb24f1d814",
};
