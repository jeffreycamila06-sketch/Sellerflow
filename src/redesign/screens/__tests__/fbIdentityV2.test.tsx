// Build 4 — "Facebook identity v2", app half. With fb_identity_v2 ON the server sends a Facebook
// buyer's handle = the commenter id (server/fbComment.js). Pins:
//   (a) same name, different ids → two buyers, two numbers, no Auto "Duplicate";
//   (b) same id twice → one buyer;  (c) two hidden commenters → two buyers;
//   (d) the sticker and the Live feed row show the name only, never the id;
//   (e) Orders list + export, Miners/Sales labels + exports, Shipping, Customers export, basket
//       count and the Buyer Alert lookup use the NAME for a Facebook row, never the id;
//   buyer tag: Facebook id first, then name; the id key is ignored when the switch is off;
//   OFF / rows saved before the switch (handle = name) → every output exactly as today.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";

const exported = vi.hoisted(() => [] as { rows: unknown[][] }[]);
vi.mock("../../adapters/brandedExport", () => ({
  exportBrandedXlsx: vi.fn(async (input: { rows: unknown[][] }) => { exported.push(input); }),
  exportBrandedPdf: vi.fn((input: { rows: unknown[][] }) => { exported.push(input); }),
}));
vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));
vi.mock("../../adapters/shippingDb", () => ({
  loadShippingEntries: vi.fn(async () => []),
  upsertShippingEntry: vi.fn(async () => ({ ok: true })),
  deleteShippingEntry: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../adapters/shippingExport", () => ({
  quotaForPlan: () => null, callExportRpc: vi.fn(), loadExportedCount: vi.fn(async () => 0), entryToXlsRow: vi.fn(() => []),
  exportFilename: vi.fn(() => "f.xlsm"), fetchShipTemplate: vi.fn(async () => new ArrayBuffer(0)), buildXlsmFromTemplate: vi.fn(async () => new Uint8Array()),
  deliverXlsm: vi.fn(async () => ({ ok: true, via: "blob" })), hasNativeFileShare: () => false, markBatchShipped: vi.fn(async () => ({ ok: true })),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import { fbToPayload } from "../../../../server/fbComment.js";
import { buildOrderFromComment, rebuildSessionFromRows, type LiveSessionRow } from "../../../lib/orderLogic";
import type { Buyer, Comment as LogicComment } from "../../../lib/orderTypes";
import { fbHandleIsId, looksLikeFbId } from "../../adapters/fbName";
import { buyerTagFor, buyerTagKey, parseBuyerTags } from "../../adapters/buyerTag";
import { buildBasketCounts, basketCountFor } from "../../adapters/basketCounts";
import { normHandle, type BuyerAlertView } from "../../adapters/buyerAlert";
import { printSlip, setStickerQrOn, DEF_SETTINGS, __resetWebPrintQueue } from "../../adapters/printing";
import Dashboard from "../Dashboard";
import Orders from "../Orders";
import Miners from "../Miners";
import SalesTab from "../SalesTab";
import Shipping from "../Shipping";
import type { Comment, Order } from "../../data";
import type { UseMinersReport } from "../../adapters/minersReport";
import type { UseSalesTab } from "../../adapters/salesTab";

const MARIA = "Maria Santos";
const ID1 = "1029384756473829";
const ID2 = "1029384756470001";
const wrap = (ui: React.ReactNode) => render(<TProvider lang="en">{ui}</TProvider>);

// A server payload (identity v2 ON) → the app's order-logic comment.
const v2 = (commentId: string, from?: { id: string; name: string }) => {
  const p = fbToPayload({ id: commentId, message: "mine", ...(from ? { from } : {}) }, { sellerId: "s", pageId: "P1", liveVideoId: "LV1", nowMs: 1_760_000_000_000, identityV2: true });
  return { handle: p.handle, name: p.name, comment: p.comment, platform: "Facebook", isBuy: true, buyerNum: null, buyerData: null, time: p.time } as LogicComment;
};
const NOW = new Date("2026-10-09T12:00:00Z");
const order = (cs: LogicComment[]) => cs.reduce<Buyer[]>((bs, c) => buildOrderFromComment(c, bs, 100, NOW).nextBuyers, []);
// RedesignApp's Auto "Duplicate" key (copied shape; the source contract below pins it).
const autoDupKeyOf = (handle: string, code: string) => `${String(handle || "").trim().toLowerCase()}|${String(code || "").trim().toLowerCase()}`;

describe("(a)(b)(c) buyers and numbers — order logic untouched, keyed by handle + platform", () => {
  it("(a) two people both named Maria Santos → two buyers, #1 and #2; no Auto Duplicate", () => {
    const a = v2("LV1_1", { id: ID1, name: MARIA });
    const b = v2("LV1_2", { id: ID2, name: MARIA });
    const bs = order([a, b]);
    expect(bs.map((x) => [x.num, x.name, x.handle])).toEqual([[1, MARIA, ID1], [2, MARIA, ID2]]);
    expect(autoDupKeyOf(a.handle, "A01")).not.toBe(autoDupKeyOf(b.handle, "A01"));
  });
  it("(b) the same person twice → one buyer with two orders", () => {
    const bs = order([v2("LV1_1", { id: ID1, name: MARIA }), v2("LV1_2", { id: ID1, name: MARIA })]);
    expect(bs).toHaveLength(1);
    expect(bs[0].num).toBe(1);
    expect(bs[0].totalOrders).toBe(2);
  });
  it("(c) two hidden commenters → two buyers", () => {
    const bs = order([v2("LV1_7"), v2("LV1_8")]);
    expect(bs.map((x) => [x.num, x.handle])).toEqual([[1, "fb-anon-LV1_7"], [2, "fb-anon-LV1_8"]]);
  });
  it("reload (rebuildSessionFromRows) keeps the two Marias apart with their numbers", () => {
    const row = (n: number, handle: string): LiveSessionRow => ({ buyer_number: n, handle, customer_name: MARIA, platform: "Facebook", product: "A01", price: 100, created_at: "2026-10-09T12:00:00Z" });
    const { buyers } = rebuildSessionFromRows([row(1, ID1), row(2, ID2)]);
    expect(buyers.map((b) => [b.num, b.handle])).toEqual([[1, ID1], [2, ID2]]);
  });
  it("source contract: the Auto Duplicate key is the handle (+ code)", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain('`${String(handle || "").trim().toLowerCase()}|${String(code || "").trim().toLowerCase()}`');
    expect(src).toContain("autoDupKeyOf(c.handle, plan.code.code)");
  });
});

describe("fbHandleIsId / looksLikeFbId", () => {
  it("true only for a Facebook row with a real name whose handle is not that name", () => {
    expect(fbHandleIsId("Facebook", MARIA, ID1)).toBe(true);
    expect(fbHandleIsId("facebook", MARIA, `@${ID1}`)).toBe(true);
    expect(fbHandleIsId("Facebook", MARIA, MARIA)).toBe(false);           // before the switch
    expect(fbHandleIsId("Facebook", MARIA, `@${MARIA.toLowerCase()} `)).toBe(false);
    expect(fbHandleIsId("Facebook", "Unknown", ID1)).toBe(false);         // no name → keep the handle
    expect(fbHandleIsId("Facebook", "", ID1)).toBe(false);
    expect(fbHandleIsId("TikTok", "Joy M", "kaldag_queen_oo")).toBe(false);
    expect(fbHandleIsId("Instagram", "joy", "someone_else")).toBe(false);
  });
  it("looksLikeFbId: 10+ digits or fb-anon-…, nothing else", () => {
    for (const h of [ID1, `@${ID1}`, "fb-anon-LV1_9"]) expect(looksLikeFbId(h)).toBe(true);
    for (const h of ["maria_shops", "annelim", "123456789", "", "user1234567890"]) expect(looksLikeFbId(h)).toBe(false);
  });
});

// ── (d) Live feed + sticker ──────────────────────────────────────────────────
const noop = () => {};
const cm = (name: string, handle: string, platform: string, id = `c-${handle}`): Comment =>
  ({ id, name, handle, text: "mine", mine: true, time: "9:41:00 PM", platform });
const feed = (comments: Comment[], extra: Record<string, unknown> = {}) => wrap(<Dashboard {...{
  comments, cur: "NT$", historyReady: true, ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop, printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop, ...extra,
} as Parameters<typeof Dashboard>[0]} />);

describe("(d) Live feed row — the name only, never the id", () => {
  it("Facebook v2 rows show the name; the id never appears", () => {
    const { container } = feed([cm(MARIA, `@${ID1}`, "Facebook", "c1"), cm(MARIA, `@${ID2}`, "Facebook", "c2")]);
    expect(container.textContent).toContain(MARIA);
    expect(container.textContent).not.toContain(ID1);
    expect(container.textContent).not.toContain(ID2);
  });
  it("(e) basket count per person: two Marias each get their own count", () => {
    const buyers = order([v2("LV1_1", { id: ID1, name: MARIA }), v2("LV1_2", { id: ID1, name: MARIA }), v2("LV1_3", { id: ID2, name: MARIA })]);
    const counts = buildBasketCounts(buyers);
    expect(basketCountFor(counts, `@${ID1}`, "Facebook")).toBe(2);
    expect(basketCountFor(counts, `@${ID2}`, "Facebook")).toBe(1);
  });
  it("(e) Buyer Alert matches a Facebook v2 row by the NAME and opens with the name", () => {
    const tap = vi.fn();
    const alerts = new Map<string, BuyerAlertView>([[normHandle(MARIA), { returns: 2, red: true, near: null }]]);
    const { getByTestId } = feed([cm(MARIA, `@${ID1}`, "Facebook")], { buyerAlerts: alerts, onBuyerTap: tap });
    expect(getByTestId("ba-chip-red")).toBeTruthy();
    fireEvent.click(getByTestId("ba-name"));
    expect(tap).toHaveBeenCalledWith(normHandle(MARIA));
  });
  it("OFF data (handle = name) and TikTok: Buyer Alert keyed by the handle exactly as today", () => {
    const tap = vi.fn();
    const alerts = new Map<string, BuyerAlertView>([[normHandle(MARIA), { returns: 1, red: true, near: null }], ["joy_live", { returns: 1, red: true, near: null }]]);
    const { getAllByTestId } = feed([cm(MARIA, `@${MARIA}`, "Facebook", "c1"), cm("Joy M", "@joy_live", "TikTok", "c2")], { buyerAlerts: alerts, onBuyerTap: tap });
    const names = getAllByTestId("ba-name");
    fireEvent.click(names[0]); fireEvent.click(names[1]);
    expect(tap.mock.calls).toEqual([[normHandle(MARIA)], ["joy_live"]]);
  });
});

describe("(d) sticker (web print) — the name, never the id", () => {
  const mem = new Map<string, string>();
  let frame: HTMLIFrameElement | null = null;
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => { mem.set(k, String(v)); },
      removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, get length() { return mem.size; },
    });
    __resetWebPrintQueue(); setStickerQrOn(false);
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "iframe") frame = el as HTMLIFrameElement; return el; });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove()); });
  it("Facebook v2 buyer: name printed, id nowhere on the sticker", () => {
    const [b] = order([v2("LV1_1", { id: ID1, name: MARIA })]);
    printSlip(b, "NT$", "My Shop", { ...DEF_SETTINGS });
    const out = frame?.contentDocument?.documentElement.outerHTML || "";
    expect(out).toContain(MARIA);
    expect(out).not.toContain(ID1);
  });
});

// ── (e) Orders list + export ─────────────────────────────────────────────────
const ord = (over: Partial<Order>): Order => ({ id: "#1", buyer: MARIA, handle: `@${ID1}`, items: "A01", qty: 1, total: 320, status: "New", platform: "Facebook", time: "9:41 PM", orderNum: 1, date: "2026-10-09", ...over });
describe("(e) Orders — list row and Excel/PDF export", () => {
  beforeEach(() => { exported.length = 0; });
  const exportRows = (orders: Order[], kind: "xlsx" | "pdf") => {
    const r = wrap(<Orders onGoPrint={vi.fn()} cur="NT$" orders={orders} state="live" todayId="2026-10-09" />);
    fireEvent.click(r.getByTestId("orders-export"));
    fireEvent.click(r.getByTestId(`orders-export-${kind}`));
    return { r, rows: exported[exported.length - 1].rows };
  };
  it("list shows the name, never the id", () => {
    const { container } = wrap(<Orders onGoPrint={vi.fn()} cur="NT$" orders={[ord({}), ord({ id: "#2", handle: `@${ID2}` })]} state="live" todayId="2026-10-09" />);
    expect(container.textContent).toContain(MARIA);
    expect(container.textContent).not.toContain(ID1);
  });
  it("export Username column = the name for a Facebook v2 row (Excel and PDF)", () => {
    for (const kind of ["xlsx", "pdf"] as const) {
      const { r, rows } = exportRows([ord({})], kind);
      expect(rows[0][2]).toBe(MARIA);
      expect(JSON.stringify(rows)).not.toContain(ID1);
      r.unmount();
    }
  });
  it("OFF / old rows / TikTok / Unknown: the export column is the handle exactly as today", () => {
    const { rows } = exportRows([ord({ handle: `@${MARIA}` }), ord({ id: "#2", buyer: "Joy M", handle: "@kaldag_queen_oo", platform: "TikTok" }), ord({ id: "#3", buyer: "Unknown", handle: `@${ID1}` })], "xlsx");
    expect(rows.map((x) => x[2])).toEqual([`@${MARIA}`, "@kaldag_queen_oo", `@${ID1}`]);
  });
});

describe("(e) Miners — export uses the name for a Facebook v2 buyer", () => {
  beforeEach(() => { exported.length = 0; });
  it("Username column = name for Facebook v2; TikTok and old Facebook rows unchanged", () => {
    const rep: UseMinersReport = { state: "live", load: vi.fn(), reload: vi.fn(), data: {
      spent: 1000, orders: 3, buyers: 3, avg: 333, tiktokPct: 33, fbPct: 67, split: [], start: "2026-10-01", end: "2026-10-09", limit: 10,
      top: [
        { name: MARIA, handle: `@${ID1}`, platform: "Facebook", spent: 640, orders: 2, activeDays: 1, repeat: false },
        { name: "Joy M", handle: "@kaldag_queen_oo", platform: "TikTok", spent: 360, orders: 1, activeDays: 1, repeat: false },
        { name: "Ana", handle: "@Ana", platform: "Facebook", spent: 100, orders: 1, activeDays: 1, repeat: false },
      ] } };
    const r = wrap(<Miners cur="NT$" rep={rep} todayId="2026-10-09" sessionStartId="2026-10-01" />);
    expect(r.container.textContent).not.toContain(ID1);
    fireEvent.click(r.getByText("⬇ Export ▾"));
    fireEvent.click(r.getAllByText(/Excel/)[0]);
    expect(exported[0].rows.map((x) => x[2])).toEqual([MARIA, "@kaldag_queen_oo", "@Ana"]);
  });
});

describe("(e) Sales tab — top buyers (no platform in the data → id shape)", () => {
  beforeEach(() => { exported.length = 0; });
  const sales = (topBuyers: { name: string; handle: string; spent: number; orders: number }[]): UseSalesTab => ({
    state: "live", range: "session", load: vi.fn(), reload: vi.fn(),
    data: { revenue: 1000, orders: 3, buyers: 2, aov: 333, trendUnit: "day", dRevenue: null, dOrders: null, dBuyers: null, dAov: null, repeatPct: null,
      days: [{ d: "2026-10-09", rev: 1000, orders: 3 }], bestDay: null, topProducts: [], topBuyers, start: "2026-10-01", end: "2026-10-09" },
  } as UseSalesTab);
  it("a Facebook id handle is never shown or exported; a TikTok handle stays", () => {
    const r = wrap(<SalesTab cur="NT$" sessionStart="2026-10-01" today="2026-10-09" sales={sales([{ name: MARIA, handle: ID1, spent: 640, orders: 2 }, { name: "Joy M", handle: "kaldag_queen_oo", spent: 360, orders: 1 }])} />);
    expect(r.container.textContent).not.toContain(ID1);
    expect(r.container.textContent).toContain("@kaldag_queen_oo");
    fireEvent.click(r.getByTestId("sales-buyer-0"));
    expect(r.getByTestId("sales-buyer-detail").textContent).not.toContain(ID1);
    fireEvent.click(r.getByTestId("sales-buyer-back"));
    fireEvent.click(r.getByTestId("sales-export"));
    fireEvent.click(r.getByTestId("sales-export-xlsx"));
    expect(exported[0].rows.map((x) => x[1])).toEqual([MARIA, "Joy M (@kaldag_queen_oo)"]);
  });
});

describe("(e) Shipping — the bag label", () => {
  it("Facebook v2 group shows the name; TikTok keeps @handle", async () => {
    const buyers = [
      ...order([v2("LV1_1", { id: ID1, name: MARIA })]),
      { handle: "kaldag_queen_oo", name: "Joy M", platform: "TikTok", num: 2, totalOrders: 1, totalSpent: 100, orders: [{ orderNum: 2, item: "A02", qty: 1, price: 100, total: 100, time: "", handle: "kaldag_queen_oo", name: "Joy M", bNum: 2, platform: "TikTok", status: "New", date: "2026-10-09" }] } as Buyer,
    ];
    const r = wrap(<Shipping cur="NT$" buyers={buyers} sessionKey="2026-10-09" />);
    expect(await r.findByText(MARIA)).toBeTruthy();
    expect(r.container.textContent).not.toContain(ID1);
    expect(r.container.textContent).toContain("@kaldag_queen_oo");
  });
});

describe("(e) Customers export (RedesignApp) — source contract", () => {
  it("the Username column goes through fbHandleIsId", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("customersData.customers.map((c) => [c.name, fbHandleIsId(c.platform, c.name, c.handle) ? c.name : c.handle, c.platform,");
  });
});

// ── buyer tag ────────────────────────────────────────────────────────────────
describe("buyer tag — Facebook id first, then name", () => {
  const rpc = { facebook: ["maria santos", "unknown"], facebook_id: [ID1], tiktok: ["joy_live"] };
  it("switch OFF: the facebook_id key is dropped → every answer is today's", () => {
    const off = parseBuyerTags(rpc);
    const today = parseBuyerTags({ facebook: rpc.facebook, tiktok: rpc.tiktok });
    expect([...off].sort()).toEqual([...today].sort());
    for (const [h, n, p] of [[ID1, MARIA, "Facebook"], [ID2, "Ana", "Facebook"], [MARIA, MARIA, "Facebook"], ["@joy_live", "Joy", "TikTok"], ["fb-anon-x", "Unknown", "Facebook"]] as const)
      expect(buyerTagFor(off, h, n, p)).toBe(buyerTagFor(today, h, n, p));
  });
  it("switch ON: id match → OLD even under a new name; no id → falls back to the name", () => {
    const on = parseBuyerTags(rpc, true);
    expect(buyerTagFor(on, ID1, "Maria S. (new name)", "Facebook")).toBe("old");
    expect(buyerTagFor(on, `@${ID1}`, "x", "Facebook")).toBe("old");
    expect(buyerTagFor(on, ID2, MARIA, "Facebook")).toBe("old");      // name fallback (old rows keyed by name)
    expect(buyerTagFor(on, ID2, "Ana", "Facebook")).toBe("new");
    expect(buyerTagFor(on, "@joy_live", "Joy", "TikTok")).toBe("old"); // other platforms untouched
    expect(buyerTagFor(on, ID1, "Joy", "TikTok")).toBe("new");         // a TikTok handle never hits the Facebook id key
  });
  it("a hidden commenter (fb-anon-…) gets no pill; the key shape is unchanged", () => {
    const on = parseBuyerTags(rpc, true);
    expect(buyerTagFor(on, "fb-anon-LV1_9", "Unknown", "Facebook")).toBeNull();
    expect(buyerTagKey(ID1, MARIA, "Facebook")).toBe("facebook|maria santos");
  });
  it("RedesignApp loads the tags with the fbIdentityV2 switch", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("useBuyerTags(ttEff || fbEff || shopeeEff || igEff, featureSw.fbIdentityV2)");
  });
});
