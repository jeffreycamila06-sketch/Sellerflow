// Build 11 (H3) — Shipping keyed by the SESSION (switch build11_enabled).
// A same-day platform switch: the day key already holds the OTHER session's buyer #1 bag. With the
// switch ON the new session never shows it (so never overwrites or exports it); a bag of THIS
// session saved under the day key before the switch was turned on is still shown. Switch OFF →
// exactly today (one read, the day key). Real RedesignApp → Orders → Shipping.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, act, screen, fireEvent } from "@testing-library/react";
import type { ShippingEntry } from "../adapters/shipping";
import { shippingSessionKey, ownLegacyEntries, lateFormEntry, buyerGroupsFrom } from "../adapters/shipping";
import { readFileSync } from "node:fs";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  build11: { v: true },
  rows: {} as Record<string, unknown[] | null>,
  reads: [] as string[],
}));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "g@x.com", plan: "pro", planStatus: "active", planExpiry: "", role: "seller", connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));
const order = (n: number, bNum: number) => ({ orderNum: n, item: "A", qty: 1, price: 100, total: 100, time: "", handle: `h${bNum}`, name: `N${bNum}`, bNum, platform: "TikTok", status: "New", date: "2026-10-09" });
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: {
      buyers: [
        { handle: "h1", name: "N1", platform: "TikTok", num: 1, orders: [order(222, 1)], totalSpent: 100, totalOrders: 1 },
        { handle: "h2", name: "N2", platform: "TikTok", num: 2, orders: [order(333, 2)], totalSpent: 100, totalOrders: 1 },
      ],
      orders: [],
    },
    state: "live", loadError: false, dayId: "2026-10-09",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {},
  }),
}));
vi.mock("../adapters/useSessionInstance", async (orig) => ({
  ...(await orig() as object),
  useSessionInstance: () => ({
    currentSessionId: "S2", sessionStartedAt: null, sessionWindowDays: 1, ended: false, loaded: true, known: true, retry: () => {},
    ensureLoaded: async () => {}, checkStatus: async () => ({ running: true, platform: "TikTok" }), startSession: async () => "S2", endSession: async () => true,
  }),
}));
vi.mock("../adapters/featureSwitches", async (orig) => {
  const a = await orig() as { SWITCHES_OFF: Record<string, boolean> };
  return { ...a, useFeatureSwitches: () => ({ ...a.SWITCHES_OFF, build11: H.build11.v }) };
});
vi.mock("../adapters/shippingDb", async (orig) => ({
  ...(await orig() as object),
  loadShippingEntries: async (k: string) => { H.reads.push(k); return (H.rows[k] ?? []) as ShippingEntry[]; },
  loadShippingEntriesOrNull: async (k: string) => { H.reads.push(k); return (k in H.rows ? H.rows[k] : []) as ShippingEntry[] | null; },
}));

import RedesignApp from "../RedesignApp";

const t = buildT("en");
const bag = (o: Partial<ShippingEntry>): ShippingEntry => ({
  id: "x", sessionKey: "2026-10-09", buyerNumber: 1, bagNumber: 1, includedOrderIds: [], recipientName: "", phone: "0912345678", storeId: "123456",
  tempLayer: "1", productDesc: "#1 商品x1", orderAmount: 100, shippingFee: 38, buyerUsername: "", status: "encoded", exportBatchId: null, exportedAt: null, shippedAt: null, ...o,
} as ShippingEntry);
const OTHER_SESSION_1 = bag({ id: "old1", buyerNumber: 1, includedOrderIds: [111], recipientName: "Other Buyer" });
const THIS_SESSION_2 = bag({ id: "own2", buyerNumber: 2, includedOrderIds: [333], recipientName: "My Buyer" });

async function openShipping() {
  render(<RedesignApp />);
  await flush();
  fireEvent.click(screen.getAllByText(t.rd_nav_orders).find((el) => el.closest("button"))!.closest("button")!);
  await flush();
  fireEvent.click(screen.getByText((s) => s.includes(t.rd_sh_shipping) && s.includes("🚚")));
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  H.build11.v = true;
  H.reads.length = 0;
  H.rows = { "2026-10-09": [OTHER_SESSION_1, THIS_SESSION_2] };
});

describe("pure", () => {
  it("session key: sid:<id>; no session id → the old key", () => {
    expect(shippingSessionKey("S2", "2026-10-09")).toBe("sid:S2");
    expect(shippingSessionKey(null, "2026-10-09")).toBe("2026-10-09");
  });
  it("old-key bags: only those holding this session's orders; the session key wins on the same buyer # + bag #", () => {
    const sessionRow = bag({ id: "s2", sessionKey: "sid:S2", buyerNumber: 2, includedOrderIds: [333] });
    expect(ownLegacyEntries([], [OTHER_SESSION_1, THIS_SESSION_2], new Set([222, 333])).map((e) => e.id)).toEqual(["own2"]);
    expect(ownLegacyEntries([sessionRow], [THIS_SESSION_2], new Set([333])).map((e) => e.id)).toEqual(["s2"]);
  });
});

describe("saved bags keep their key; new bags get the session key", () => {
  const g = buyerGroupsFrom([{ handle: "h2", name: "N2", platform: "TikTok", num: 2, orders: [order(333, 2), order(444, 2)], totalSpent: 200, totalOrders: 2 } as never])[0];
  it("late bag: editing a saved (old-key) draft keeps its key; a brand-new late bag takes the session key", () => {
    const exported = bag({ id: "e1", buyerNumber: 2, bagNumber: 1, includedOrderIds: [333], status: "exported" as const });
    const oldDraft = bag({ id: "d2", buyerNumber: 2, bagNumber: 2, includedOrderIds: [], status: "draft" as const });
    expect(lateFormEntry(g, [exported, oldDraft], "sid:S2", "n", 38)).toMatchObject({ id: "d2", sessionKey: "2026-10-09" });
    expect(lateFormEntry(g, [exported], "sid:S2", "n", 38)).toMatchObject({ id: "n", sessionKey: "sid:S2" });
  });
  it("split bags: a bag that already exists keeps its own key (source)", () => {
    const src = readFileSync("src/redesign/screens/Shipping.tsx", "utf8");
    expect(src).toContain("return ex && ex.sessionKey !== r.sessionKey ? { ...r, sessionKey: ex.sessionKey } : r;");
  });
});

describe("Shipping after a same-day switch", () => {
  it("switch ON: the other session's buyer #1 bag is NOT shown (or exported); this session's old-key bag is", async () => {
    await openShipping();
    expect(document.body.textContent).not.toContain("Other Buyer");
    expect(document.body.textContent).toContain("My Buyer");
    expect(H.reads.sort()).toEqual(["2026-10-09", "sid:S2"]);
  });
  it("switch ON: a failed read → a plain note, no buyer list (no second encode of the same bag)", async () => {
    H.rows["sid:S2"] = null;
    await openShipping();
    expect(screen.getByTestId("shp-load-failed").textContent).toBe(t.rd_shp_load_failed);
    expect(document.body.textContent).not.toContain("My Buyer");
  });
  it("switch OFF: exactly today — one read of the day key", async () => {
    H.build11.v = false;
    await openShipping();
    expect(H.reads).toEqual(["2026-10-09"]);
    expect(document.body.textContent).toContain("Other Buyer"); // today's behaviour, unchanged
  });
});
