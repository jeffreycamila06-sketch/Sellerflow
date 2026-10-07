// Sticker spacing — Normal/Compact row HIDDEN (STICKER_SPACING_CHOICE_VISIBLE = false): every seller
// with sticker spacing prints Compact whatever pp.spacing holds. Visible = true restores the stored
// choice (absent = Normal), exactly as before. Non-image print paths never see the flags.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const preview = vi.hoisted(() => ({ flags: [] as unknown[] }));
vi.mock("../../components/ExactStickerPreview", () => ({
  default: (p: { flags?: unknown }) => { preview.flags.push(p.flags); return <canvas data-testid="pp-exact-preview" />; },
}));

import { TProvider } from "../../i18n";
import PrintPattern, { DEFAULT_PP } from "../PrintPattern";
import {
  printSlip, buildSettingsFromRedesign, buildNativeStickerPayload, setStickerQrOn, setStickerQrEntitled, setStickerSpacingAllowed, setStickerSpacingChoice,
  stickerSpacingFlags, spacingFlagsFor, effectiveSpacing, STICKER_SPACING_CHOICE_VISIBLE, STICKER_SPACING_FIXED, LS_CLASSIC_TEXT, DEF_SETTINGS,
  __resetNativePrintQueue, __resetWebPrintQueue, type Settings, type StickerSpacing,
} from "../../adapters/printing";
import { rasterizeToSdkBitmapTspl, type RasterPayload } from "../../adapters/stickerRaster";
import { LATIN_ATLAS } from "../../adapters/glyphAtlas.latin";
import { CJK_ATLAS } from "../../adapters/glyphAtlas.cjk";
import type { Buyer } from "../../../lib/orderTypes";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, get length() { return mem.size; },
});

const SIZES: [number, number][] = [[100, 60], [80, 60], [80, 50], [70, 50], [60, 40]];
const mk = (platform: string): Buyer => ({ handle: "cristineramos", name: "Cristine Ramos Cabañas", platform, num: 7, orders: [{ orderNum: 1750000000000, item: "Mine black size XL 2pcs 350", qty: 1, price: 350, total: 350, time: "9:41 PM", handle: "cristineramos", name: "Cristine Ramos Cabañas", bNum: 7, platform, status: "New", date: "2026-10-07" }], totalOrders: 1, totalSpent: 350 } as unknown as Buyer);
type W = { SellerFlowPrinter?: unknown };
async function viaBridge(b: Buyer, cfg: Settings, bridge: Record<string, ReturnType<typeof vi.fn>>, key: string): Promise<string> {
  __resetNativePrintQueue();
  (window as W).SellerFlowPrinter = bridge;
  printSlip(b, "NT$", "My Shop", cfg);
  await vi.waitFor(() => expect(bridge[key].mock.calls.length).toBe(1));
  delete (window as W).SellerFlowPrinter;
  return JSON.stringify(bridge[key].mock.calls[0][0]);
}
const bitmapBridge = () => ({ printStickerNative: vi.fn().mockResolvedValue({ ok: true }), printStickerBitmap: vi.fn().mockResolvedValue({ ok: true }) });
const bt = (size: string): Settings => ({ ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: size });
const b64 = (u: Uint8Array) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };

beforeEach(() => {
  localStorage.removeItem(LS_CLASSIC_TEXT); setStickerQrEntitled(true); setStickerQrOn(false);
  vi.useFakeTimers({ now: new Date("2026-10-07T04:00:00Z"), toFake: ["Date"] });
});
afterEach(() => { vi.useRealTimers(); setStickerSpacingAllowed(false); setStickerSpacingChoice("normal"); setStickerQrEntitled(false); setStickerQrOn(false); });

describe("the switch", () => {
  it("row hidden, fixed spacing = Compact", () => {
    expect(STICKER_SPACING_CHOICE_VISIBLE).toBe(false);
    expect(STICKER_SPACING_FIXED).toBe("compact");
  });
  it("effectiveSpacing: hidden → Compact for every stored value; visible → stored choice, absent = Normal", () => {
    for (const s of [undefined, null, "normal", "compact"] as (StickerSpacing | undefined | null)[]) expect(effectiveSpacing(s)).toBe("compact");
    expect(effectiveSpacing(undefined, true)).toBe("normal");
    expect(effectiveSpacing("normal", true)).toBe("normal");
    expect(effectiveSpacing("compact", true)).toBe("compact");
  });
  it("visible = true pins today's (main) flags exactly", () => {
    setStickerSpacingAllowed(true);
    for (const stored of [undefined, "normal", "compact"] as (StickerSpacing | undefined)[]) {
      setStickerSpacingChoice(stored);
      expect(stickerSpacingFlags(true)).toEqual(spacingFlagsFor(true, stored)); // main: spacingFlagsFor(on, stored choice)
    }
    setStickerSpacingAllowed(false);
    expect(stickerSpacingFlags(true)).toEqual({});
    expect(stickerSpacingFlags()).toEqual({});
  });
});

describe("print: no stored choice / stored Normal → identical to explicit Compact", () => {
  it("every size, QR on/off, TikTok and Facebook: flags + sticker bytes = explicit Compact", async () => {
    setStickerSpacingAllowed(true);
    for (const stored of [undefined, "normal"] as (StickerSpacing | undefined)[]) {
      setStickerSpacingChoice(stored);
      for (const [w, h] of SIZES) for (const qr of [false, true]) for (const platform of ["TikTok", "Facebook"]) {
        setStickerQrOn(qr);
        const cfg = bt(`${w}x${h}`);
        const sent = JSON.parse(await viaBridge(mk(platform), cfg, bitmapBridge(), "printStickerBitmap")) as { data: string };
        // the explicit-Compact reference: the same native payload + the image flags with printSpacing "compact"
        const np = buildNativeStickerPayload(mk(platform), "NT$", "My Shop", platform === "Facebook" ? { ...cfg, printBuyerUsername: false } : cfg);
        const fb = platform === "Facebook";
        const ref: RasterPayload = { ...np, settings: { ...np.settings, printStickerQr: qr && !fb, printCommentFullWidth: true, ...(fb ? { printFacebookName: true } : {}), printHalfWordGap: true, printSpacing: "compact" } };
        const want = b64(rasterizeToSdkBitmapTspl(ref, w, h, { latin: LATIN_ATLAS, cjk: CJK_ATLAS }).bytes);
        expect(sent.data, `${stored ?? "none"} ${w}x${h} qr=${qr} ${platform}`).toBe(want);
      }
    }
  }, 60000);
  it("stored Normal → still Compact while the row is hidden (flags)", () => {
    setStickerSpacingAllowed(true); setStickerSpacingChoice("normal");
    expect(stickerSpacingFlags()).toEqual({ printHalfWordGap: true, printSpacing: "compact" });
  });
});

describe("non-image print paths never see the flags (byte-identical with spacing on or off)", () => {
  it("text fallback, WiFi/LAN sticker, slip and web print", async () => {
    const run = async () => {
      const out: string[] = [];
      for (const size of ["60x40", "100x60"]) {
        out.push(await viaBridge(mk("TikTok"), bt(size), { printStickerNative: vi.fn().mockResolvedValue({ ok: true }) }, "printStickerNative"));
        out.push(await viaBridge(mk("TikTok"), { ...bt(size), printerType: "lan", lanFormat: "sticker" }, { printStickerLan: vi.fn().mockResolvedValue({ ok: true }) }, "printStickerLan"));
      }
      out.push(await viaBridge(mk("TikTok"), { ...DEF_SETTINGS, printerType: "lan", lanFormat: "receipt" }, { printSlip: vi.fn().mockResolvedValue({ ok: true }) }, "printSlip"));
      __resetWebPrintQueue();
      let frame: HTMLIFrameElement | null = null;
      const orig = document.createElement.bind(document);
      const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "iframe") frame = el as HTMLIFrameElement; return el; });
      printSlip(mk("TikTok"), "NT$", "My Shop", { ...DEF_SETTINGS });
      out.push((frame as HTMLIFrameElement | null)?.contentDocument?.documentElement.outerHTML || "");
      spy.mockRestore(); __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
      return out;
    };
    setStickerSpacingAllowed(false);
    const off = await run();
    setStickerSpacingAllowed(true); setStickerSpacingChoice("normal");
    const on = await run();
    // the slip payload carries a print-time createdAt stamp (the clock moves between the two runs)
    const norm = (xs: string[]) => xs.map((x) => x.replace(/"createdAt":"[^"]*"/, '"createdAt":"T"'));
    expect(norm(on)).toEqual(norm(off));
    for (const s of on) expect(s).not.toMatch(/printHalfWordGap|printSpacing/);
  });
});

describe("Live print pattern: row hidden, the preview shows Compact", () => {
  const settings = (size = "100x60mm") => buildSettingsFromRedesign({ pp: DEFAULT_PP, psType: "bt", psOut: "sticker", psSize: size });
  const view = (pp = DEFAULT_PP) => render(<TProvider lang="en"><PrintPattern onBack={() => {}} pp={pp} onToggle={() => {}} onStep={() => {}} layoutV2 previewSettings={settings()} shopName="My Shop" spacingAllowed imagePath /></TProvider>);
  it("no Normal/Compact row; the exact preview gets the Compact flags (no stored choice and stored Normal)", () => {
    for (const pp of [DEFAULT_PP, { ...DEFAULT_PP, spacing: "normal" as const }]) {
      preview.flags.length = 0;
      const v = view(pp);
      expect(v.queryByTestId("pp-spacing")).toBeNull();
      expect(v.getByTestId("pp-exact-preview")).toBeTruthy();
      expect(preview.flags.at(-1)).toMatchObject({ printHalfWordGap: true, printSpacing: "compact" });
      v.unmount();
    }
  });
});
