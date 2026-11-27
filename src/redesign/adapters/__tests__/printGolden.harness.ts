// Shared by the print golden proof (printGolden.test.ts): one print per printer family, what the printer received.
import { expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { printOneStickerTest, printSlip, setStickerQrEntitled, setStickerQrOn, DEF_SETTINGS, __resetNativePrintQueue, type Settings } from "../printing";
import { recommendedSettings } from "../oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter, type SavedBtPrinter } from "../savedPrinter";
import { setApprovedPrinters } from "../printerModels";
import { parseApprovedRows } from "../printerTesters";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import type { Buyer } from "../../../lib/orderTypes";

export const GOLDEN_FILE = resolve(__dirname, "fixtures/printGoldens.main.json");
const AT = Date.UTC(2026, 10, 27, 6, 5);                      // 14:05 Taipei — the sticker prints the day
type W = Window & { SellerFlowPrinter?: Record<string, unknown> };

export type Fam = "d520" | "d520text" | "xp420b" | "ae241" | "ct221b" | "pt210l" | "escpos" | "cpcl" | "niimbot";
export const FAMS: Fam[] = ["d520", "d520text", "xp420b", "ae241", "ct221b", "pt210l", "escpos", "cpcl", "niimbot"];
export const SAVED: Record<Fam, SavedBtPrinter> = {
  d520: { address: "AA", name: "D520BT-Z" },
  d520text: { address: "AA", name: "D520BT-Z" },
  xp420b: { address: "AA", name: "XP-420B", model: "generic", lang: "tspl" },
  ae241: { address: "AA", name: "AE241-BT_C11D-LE", model: "generic", lang: "tspl" },
  ct221b: { address: "AA", name: "CT221B-D4F8", model: "generic", lang: "tspl" },
  pt210l: { address: "AA", name: "PT210L_30EF", model: "generic", lang: "escpos" },
  escpos: { address: "AA", name: "GEN-1", model: "generic", lang: "escpos" },
  cpcl: { address: "AA", name: "GEN-1", model: "generic", lang: "cpcl" },
  niimbot: { address: "AA", name: "B21-C123", transport: "niimbot" },
};
const APPROVED = parseApprovedRows(JSON.parse(readFileSync(resolve(__dirname, "fixtures/approvedPrinters.live.json"), "utf8")).rows);

const cfgFor = (w: number, h: number): Settings => ({ ...DEF_SETTINGS, stickerSize: `${w}x${h}`, printerType: "bluetooth" });
const buyerOf = (name: string, handle: string): Buyer => ({ handle, name, platform: "TikTok", num: 128, totalOrders: 1, totalSpent: 150,
  orders: [{ orderNum: AT, item: "Blue dress A3", qty: 1, price: 150, total: 150, time: "14:05", handle, name, bNum: 128, platform: "TikTok", status: "New", date: "2026-11-27" }] });
export const BUYERS = { latin: () => buyerOf("Maria Santos", "maria_live"), cjk: () => buyerOf("陳小美", "chen_xiaomei") };
export const sizesFor = (f: Fam): [number, number][] => (f === "niimbot" ? [[50, 30]] : [[60, 40], [100, 60]]);
export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** One print on family `f`; returns the bridge function called + the sha256 of its argument (JSON). */
export async function handed(f: Fam, send: () => unknown): Promise<{ fn: string; arg: string }> {
  __resetNativePrintQueue(); __resetSavedPrinter();
  const ok = () => vi.fn(async (_a: Record<string, unknown>) => ({ ok: true }));
  const br: Record<string, ReturnType<typeof ok>> = f === "d520text"
    ? { printStickerNative: ok() }
    : { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  rememberSavedPrinter(SAVED[f]);
  (window as W).SellerFlowPrinter = br;
  await send();
  await vi.waitFor(() => expect(Object.values(br).reduce((a, x) => a + x.mock.calls.length, 0)).toBe(1), { timeout: 20000, interval: 10 });
  const [fn, call] = Object.entries(br).find(([, x]) => x.mock.calls.length)!;
  delete (window as W).SellerFlowPrinter;
  return { fn, arg: JSON.stringify(call.mock.calls[0][0]) };
}
export const todayPrint = (_f: Fam, w: number, h: number, b: Buyer) => () => printSlip(b, "NT$", "My Shop", cfgFor(w, h), { noOneSticker: true });
export const newPrint = (_f: Fam, w: number, h: number, b: Buyer) => () => printOneStickerTest({ ...recommendedSettings({ w, h }), qr: false }, b, "NT$", "My Shop", cfgFor(w, h));

export function beforeGolden(): void {
  installSans(); installNodeFallbackDrawer();
  setStickerQrEntitled(true); setStickerQrOn(false);
  setApprovedPrinters(APPROVED);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(AT);
}
export function afterGolden(): void { vi.useRealTimers(); setApprovedPrinters(null); setStickerQrEntitled(false); __resetSavedPrinter(); }

