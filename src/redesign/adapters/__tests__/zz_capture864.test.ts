// Byte capture: 9 paths × 6 sizes × 8 buyers × QR on/off = 864 prints with every switch OFF.
// Run on origin/main and on the branch; the JSON of hashes must be identical.
import { it, vi } from "vitest";
import * as fs from "node:fs";
import { printSlip, DEF_SETTINGS, setStickerQrEntitled, setStickerQrOn, __resetNativePrintQueue, __resetWebPrintQueue, type Settings } from "../printing";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import type { Buyer } from "../../../lib/orderTypes";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 7, 6, 5);
const mk = (num: number, name: string, handle: string, item: string, platform = "TikTok"): Buyer => ({
  num, name, handle, platform, totalSpent: 0, totalOrders: 1,
  orders: [{ orderNum: AT, item, qty: 1, price: 0, total: 0, time: "14:05", handle, name, bNum: num, platform, status: "New", date: "2026-11-07" }],
} as unknown as Buyer);
const BUYERS: [string, Buyer][] = [
  ["latin", mk(12, "Amy Chen", "amy.shop", "A2 x2 350")],
  ["long", mk(88, "Joy M", "joy.m", "ako po yung black dress size M pa reserve po and the red one too thank you so much po")],
  ["chinese", mk(23, "陳小美", "chen.mei", "我要這件黑色洋裝 M 號 兩件")],
  ["japanese", mk(7, "田中さん", "tanaka", "日本語 田中さん「ワンピース」１２３")],
  ["korean", mk(31, "김민지", "minji", "한국어 원피스 주세요")],
  ["thai", mk(45, "สมใจ", "somjai", "ไทย ขอบคุณค่ะ ชุดสีดำ")],
  ["cyr-fancy", mk(64, "Мария 🔥𝓐𝓶𝔂🔥 O’Brien", "maria.iv", "Българска рокля М — €20")],
  ["facebook", mk(345, "Maria Clara Dela Cruz Santos Reyes", "Maria Clara Dela Cruz Santos Reyes", "B7 black dress", "Facebook")],
];
const SIZES = ["50x30", "60x40", "70x50", "80x50", "80x60", "100x60"];
type Path = "d520" | "text" | "tspl" | "escpos" | "cpcl" | "niimbot" | "lan" | "slip" | "web";
const PATHS: Path[] = ["d520", "text", "tspl", "escpos", "cpcl", "niimbot", "lan", "slip", "web"];
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");

async function capture(path: Path, b: Buyer, size: string): Promise<string> {
  __resetNativePrintQueue(); __resetSavedPrinter(); __resetWebPrintQueue();
  const ok = () => vi.fn(async (_a: unknown) => ({ ok: true }));
  if (path === "web") {
    delete (window as W).SellerFlowPrinter;
    let frame: HTMLIFrameElement | null = null;
    const orig = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "iframe") frame = el as HTMLIFrameElement; return el; });
    printSlip(b, "NT$", "My Shop", { ...DEF_SETTINGS, stickerSize: size }, { at: AT });
    for (let i = 0; i < 400 && !((frame as HTMLIFrameElement | null)?.contentDocument?.documentElement.outerHTML ?? "").includes("<body"); i++) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 30));
    const html = (frame as unknown as HTMLIFrameElement).contentDocument!.documentElement.outerHTML;
    spy.mockRestore(); __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
    return sha(html);
  }
  const br: Record<string, ReturnType<typeof ok>> = path === "text" ? { printStickerNative: ok() } : path === "lan" ? { printStickerLan: ok(), printStickerNative: ok() } : path === "slip" ? { printSlip: ok() } : { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  if (path === "tspl" || path === "escpos" || path === "cpcl") rememberSavedPrinter({ address: "AA", name: path === "tspl" ? "XP-420B" : "GEN-1", model: "generic", lang: path });
  if (path === "niimbot") rememberSavedPrinter({ address: "AA", name: "B1-H1", transport: "niimbot" });
  (window as W).SellerFlowPrinter = br;
  const cfg: Settings = { ...DEF_SETTINGS, stickerSize: size, printerType: path === "lan" || path === "slip" ? "lan" : "bluetooth", lanFormat: path === "lan" ? "sticker" : "receipt" };
  printSlip(b, "NT$", "My Shop", cfg, { at: AT });
  const fn = { d520: "printStickerBitmap", text: "printStickerNative", tspl: "printRawTspl", escpos: "printRawTspl", cpcl: "printRawTspl", niimbot: "printStickerImage", lan: "printStickerLan", slip: "printSlip" }[path];
  for (let i = 0; i < 2000 && br[fn].mock.calls.length < 1; i++) await new Promise((r) => setTimeout(r, 10));
  if (!br[fn].mock.calls.length) return "NOT-CALLED";
  const arg = JSON.parse(JSON.stringify(br[fn].mock.calls[0][0]));
  if (path === "slip") delete arg.createdAt;
  delete (window as W).SellerFlowPrinter;
  return sha(JSON.stringify(arg));
}

it("capture 864", async () => {
  // CAPTURE_STATE=saved: this device saved the NEW sticker, the switch is OFF (main ignores the key)
  if (process.env.CAPTURE_STATE === "saved") localStorage.setItem("sfl_rd_one_sticker", JSON.stringify({ saved: true, settings: { size: { w: 60, h: 40 }, qr: true, parts: { shop: { on: true, weight: "extra", scale: 2 }, buyer: { on: true, weight: "extra", scale: 2 }, name: { on: true, weight: "bold", scale: 1 }, user: { on: true, weight: "bold", scale: 1 }, comment: { on: true, weight: "bold", scale: 1 } } } }));
  const out: Record<string, string> = {};
  for (const qr of [false, true]) {
    setStickerQrEntitled(qr); setStickerQrOn(qr);
    for (const p of PATHS) for (const size of SIZES) for (const [k, b] of BUYERS) out[`${p}|${size}|${k}|qr=${qr}`] = await capture(p, b, size);
  }
  fs.writeFileSync(process.env.CAPTURE_OUT!, JSON.stringify(out, null, 1));
}, 1200000);
