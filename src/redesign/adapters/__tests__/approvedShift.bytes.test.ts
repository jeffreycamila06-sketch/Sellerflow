// Approved printers' "Flip 180°" + "Shift left (mm)" (sql/161) — PROOF that nothing else moved: with approved rows
// loaded INCLUDING flip + a 3 mm shift for "CT221B-" (and one that tries to shadow the Y41BT), every other
// saved printer gets byte-for-byte the bytes main sent, on today's sticker AND on the one-sticker engine.
// Fingerprints taken by running THIS file on origin/main 3666d6cd (SFL_SHIFT_GOLDEN=<file> run there) — the file
// imports only modules main already has, so it runs there unchanged.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DEF_SETTINGS, printOneStickerTest, printStickerBtRouted, __resetNativePrintQueue, __resetWebPrintQueue, setStickerQrEntitled, setStickerQrOn, type Settings } from "../printing";
import { sampleBuyer, __resetOneStickerState, LS_ONE_STICKER } from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";
import { buildTestBuyer } from "../printerBridge";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { setApprovedPrinters } from "../printerModels";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";

const AT = Date.UTC(2026, 10, 8, 6, 5);
const SHOP = "Maria Ukay";
const APPROVED = [
  { prefix: "CT221B-", brand: "Clabel", model: "CT221B", lang: "tspl" as const, shiftMm: 3, flip: true }, // flip + shift: main ignores both fields
  { prefix: "Y41", brand: "Other", model: "Fake", lang: "tspl" as const, shiftMm: 5 }, // tries to shadow the built-in Y41BT: must never apply
];
const CASES: { name: string; lang: "tspl" | "escpos" | "cpcl" }[] = [
  { name: "Y41BT-0FC4_LE", lang: "tspl" }, { name: "XP-420B", lang: "tspl" }, { name: "LabelThing-9", lang: "tspl" },
  { name: "GEN-ESC", lang: "escpos" }, { name: "GEN-CPCL", lang: "cpcl" },
];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
type W = { SellerFlowPrinter?: unknown };

beforeAll(() => { installSans(); installNodeFallbackDrawer(); });
afterEach(() => { delete (window as unknown as W).SellerFlowPrinter; __resetNativePrintQueue(); __resetWebPrintQueue(); __resetSavedPrinter(); __resetOneStickerState(); setApprovedPrinters(null); vi.useRealTimers(); });

async function handed(name: string, lang: string, send: (cfg: Settings) => Promise<unknown>): Promise<string> {
  __resetNativePrintQueue(); __resetWebPrintQueue(); __resetSavedPrinter(); __resetOneStickerState();
  try { localStorage.removeItem(LS_ONE_STICKER); } catch { /* */ }
  setStickerQrEntitled(true); setStickerQrOn(true);
  setApprovedPrinters(APPROVED);
  const ok = () => vi.fn(async (_a: Record<string, unknown>) => ({ ok: true }));
  const br = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  rememberSavedPrinter({ address: "AA", name, model: "generic", lang: lang as "tspl" });
  (window as unknown as W).SellerFlowPrinter = br;
  await send({ ...DEF_SETTINGS, stickerSize: "60x40", printerType: "bluetooth" });
  await vi.waitFor(() => expect(br.printRawTspl.mock.calls.length).toBe(1), { timeout: 20000, interval: 10 });
  return JSON.stringify(br.printRawTspl.mock.calls[0][0]);
}

// sha256 of what printRawTspl received, on origin/main (SFL_SHIFT_GOLDEN run there)
const MAIN: Record<string, string> = {
  "today:Y41BT-0FC4_LE": "a4a5d4f15e96a4b6e561b69b775ee1f0f1ac215eb5a640517c5c982b6550473a",
  "one:Y41BT-0FC4_LE": "586e29114f9a6d08ecce88547fd14ec05220f67850b6d3f8a9b8cc7c454ca08e",
  "today:XP-420B": "a4a5d4f15e96a4b6e561b69b775ee1f0f1ac215eb5a640517c5c982b6550473a",
  "one:XP-420B": "586e29114f9a6d08ecce88547fd14ec05220f67850b6d3f8a9b8cc7c454ca08e",
  "today:LabelThing-9": "b210d12d2a8de51798b61f076eddd53ffb1ec5b851f8eb6b553c4b9c637e5f71",
  "one:LabelThing-9": "dd75b5910c4e28980aea84aa6c6d83d3265ca00ac1e5032b1f5d83f7b54ea97c",
  "today:GEN-ESC": "903767ec62d54e4e8538c6c7232f5d2e2fef0a206664c94b0d1941085d696738",
  "one:GEN-ESC": "e44b34f0929020569aaadf8aacee20d0476bebec5524fff5492abbc052076858",
  "today:GEN-CPCL": "9b1ef3d6dd8aa30f7b8940f08f9eea88497157ae4431f4f187c544807f08f93b",
  "one:GEN-CPCL": "b4efce8e7cea4da09b9d36bdad28c0cb8ce60d08b1b19d30fb82f83696cc1b2f",
};

describe("approved rows + a CT221B shift loaded: every other printer = main's bytes", () => {
  for (const c of CASES) {
    it(`${c.name} (${c.lang}) — today's sticker`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(AT);
      const h = sha(await handed(c.name, c.lang, (cfg) => printStickerBtRouted(buildTestBuyer(), "NT$", SHOP, cfg, false, AT, true)));
      if (process.env.SFL_SHIFT_GOLDEN) appendFileSync(process.env.SFL_SHIFT_GOLDEN, `  "today:${c.name}": "${h}",\n`);
      else expect(h).toBe(MAIN[`today:${c.name}`]);
    }, 60000);
    it(`${c.name} (${c.lang}) — one-sticker engine`, async () => {
      const h = sha(await handed(c.name, c.lang, (cfg) => printOneStickerTest({ ...recommendedSettings({ w: 60, h: 40 }), qr: true }, sampleBuyer(undefined, AT), "NT$", SHOP, cfg)));
      if (process.env.SFL_SHIFT_GOLDEN) appendFileSync(process.env.SFL_SHIFT_GOLDEN, `  "one:${c.name}": "${h}",\n`);
      else expect(h).toBe(MAIN[`one:${c.name}`]);
    }, 60000);
  }
});
