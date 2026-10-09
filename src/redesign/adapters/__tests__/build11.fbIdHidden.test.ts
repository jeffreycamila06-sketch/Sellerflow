// Build 11 (M1) — a Facebook commenter id (identity v2) or "fb-anon-…" (hidden commenter) is
// never printed on a sticker, never written to the 7-11 file's column J, and never opened by
// Pickup "Chase". TikTok stickers stay byte-identical (sha256 captured on main before this change).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printSlip, setStickerQrOn, setStickerQrEntitled, LS_CLASSIC_TEXT, DEF_SETTINGS, __resetWebPrintQueue, type Settings } from "../printing";
import { printableBuyer, fbDisplayName } from "../fbName";
import { buyerGroupsFrom, draftEntryFor, buildBagEntries, lateFormEntry, colJHandle } from "../shipping";
import { chaseTarget } from "../parcelTracking";
import type { Buyer } from "../../../lib/orderTypes";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, get length() { return mem.size; },
});
type W = { SellerFlowPrinter?: unknown };
const ID = "1029384756473829";
const order = (platform: string, handle: string, name: string) => ({ orderNum: 1750000000000, item: "A01", qty: 1, price: 320, total: 320, time: "9:41 PM", handle, name, bNum: 12, platform, status: "New", date: "2026-09-26" });
const mk = (platform: string, handle: string, name: string): Buyer => ({ handle, name, platform, num: 12, orders: [order(platform, handle, name)], totalOrders: 1, totalSpent: 320 } as unknown as Buyer);
const btCfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: "100x60" };
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");

describe("printableBuyer", () => {
  it("Facebook → no handle, the name (blank for 'Unknown'); everything else → the same object", () => {
    const fb = mk("Facebook", ID, "Ana Cruz");
    expect(printableBuyer(fb)).toMatchObject({ handle: "", name: "Ana Cruz" });
    expect(printableBuyer(mk("Facebook", "fb-anon-123_456", "Unknown"))).toMatchObject({ handle: "", name: "" });
    for (const p of ["TikTok", "Shopee", "Instagram"]) { const b = mk(p, "annc", "Ann"); expect(printableBuyer(b)).toBe(b); }
    expect(fbDisplayName("  Unknown ")).toBe("");
  });
});

describe("phone (bitmap) sticker", () => {
  let bitmap: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.removeItem(LS_CLASSIC_TEXT);
    bitmap = vi.fn().mockResolvedValue({ ok: true });
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: bitmap };
    setStickerQrEntitled(true);
    vi.useFakeTimers({ now: new Date("2026-10-06T04:00:00Z"), toFake: ["Date"] });
  });
  afterEach(() => { delete (window as W).SellerFlowPrinter; setStickerQrOn(false); setStickerQrEntitled(false); vi.useRealTimers(); });
  async function print(b: Buyer, qr = false): Promise<string> {
    setStickerQrOn(qr);
    const before = bitmap.mock.calls.length;
    printSlip(b, "NT$", "My Shop", btCfg);
    await vi.waitFor(() => expect(bitmap.mock.calls.length).toBe(before + 1));
    return (bitmap.mock.calls[before][0] as { data: string }).data;
  }

  it("TikTok stickers are byte-identical to main (Latin, Thai, emoji-only names; QR off and on)", async () => {
    expect(await sha(await print(mk("TikTok", "annc", "Ann Cruz")))).toBe("aeace78fe4e6eceb9f1202f717ff93aa9b38f4f73c26b267d4b0771003d73249");
    expect(await sha(await print(mk("TikTok", "annc", "Ann Cruz"), true))).toBe("03933e2c5b0fc508d0699b9179cfb9469cdec245cb6c4e0d51db490532196101");
    expect(await sha(await print(mk("TikTok", "annc", "สมชาย")))).toBe("b1930c49e62143df781369250dd9d111a66fdd278d34862ad0df248507fa189e");
    expect(await sha(await print(mk("TikTok", "annc", "🔥🔥")))).toBe("b1930c49e62143df781369250dd9d111a66fdd278d34862ad0df248507fa189e");
  });

  it("Facebook buyer with a Thai / emoji-only name: the id is not printed (same sticker as with no handle at all)", async () => {
    for (const name of ["สมชาย", "🔥🔥"]) {
      const withId = await print(mk("Facebook", ID, name));
      const noHandle = await print(mk("Facebook", "", name));
      expect(withId, name).toBe(noHandle);
      // with the id as handle, main printed it in the name line (ASCII fallback) → must differ from that
      const asTikTok = await print(mk("TikTok", ID, name));
      expect(withId, name).not.toBe(asTikTok);
    }
  });
});

describe("text (native TSPL) payload and browser print", () => {
  it("native payload: the Facebook buyer carries no handle", () => {
    const sent: string[] = [];
    (window as W).SellerFlowPrinter = { printStickerNative: (p: unknown) => { sent.push(typeof p === "string" ? p : JSON.stringify(p)); return Promise.resolve({ ok: true }); } };
    localStorage.setItem(LS_CLASSIC_TEXT, "1");
    try {
      printSlip(mk("Facebook", ID, "Unknown"), "NT$", "My Shop", btCfg);
    } finally { localStorage.removeItem(LS_CLASSIC_TEXT); }
    delete (window as W).SellerFlowPrinter;
    return vi.waitFor(() => {
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.join("")).not.toContain(ID);
    });
  });
  it("browser print: no id, no '@fb-anon-'", () => {
    __resetWebPrintQueue();
    let captured: HTMLIFrameElement | null = null;
    const orig = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "iframe") captured = el as HTMLIFrameElement; return el; });
    try {
      printSlip(mk("Facebook", "fb-anon-555_777", "Unknown"), "NT$", "My Shop", { ...DEF_SETTINGS });
      const html = (captured as HTMLIFrameElement | null)?.contentDocument?.documentElement.outerHTML || "";
      expect(html).not.toContain("fb-anon");
      expect(html).not.toContain(">Unknown<");
      __resetWebPrintQueue();
      printSlip(mk("TikTok", "annc", "Ann"), "NT$", "My Shop", { ...DEF_SETTINGS });
      expect((captured as HTMLIFrameElement | null)?.contentDocument?.documentElement.outerHTML || "").toContain("@annc"); // TikTok unchanged
    } finally { spy.mockRestore(); __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove()); }
  });
});

describe("7-11 file column J", () => {
  const groups = buyerGroupsFrom([mk("Facebook", ID, "Ana Cruz"), { ...mk("Facebook", "fb-anon-1_2", "Unknown"), num: 13 } as Buyer, { ...mk("TikTok", "annc", "Ann"), num: 14 } as Buyer]);
  it("Facebook → the display name (blank if none); TikTok → the handle, as before", () => {
    expect(groups.map(colJHandle)).toEqual(["Ana Cruz", "", "annc"]);
  });
  it("every entry builder writes it (draft, split bags, late bag)", () => {
    const g = groups[0];
    expect(draftEntryFor(g, "k", "id1").buyerUsername).toBe("Ana Cruz");
    const bags = buildBagEntries(g, "k", [{ orderIds: g.orderIds, items: 1, amount: 320 }] as never, { recipientName: "R", phone: "0912345678", storeId: "123456", tempLayer: "1" } as never, 38, ["b1"]);
    expect(bags[0].buyerUsername).toBe("Ana Cruz");
    const exported = { ...bags[0], status: "exported" as const, includedOrderIds: [] };
    expect(lateFormEntry(g, [exported], "k", "n1", 38)?.buyerUsername).toBe("Ana Cruz");
    expect(draftEntryFor(groups[2], "k", "id3").buyerUsername).toBe("annc");
  });
});

describe("Pickup Chase", () => {
  it("a long all-digit value (Facebook id) → Copy, never Open", () => {
    expect(chaseTarget(ID)).toEqual({ kind: "copy", handle: ID });
    expect(chaseTarget(`@${ID}`)).toEqual({ kind: "copy", handle: ID });
  });
  it("TikTok handles unchanged (letters, dots, short numbers still Open)", () => {
    expect(chaseTarget("annc").kind).toBe("open");
    expect(chaseTarget("shop.tw_2").kind).toBe("open");
    expect(chaseTarget("12345678901234").kind).toBe("open");
  });
});
