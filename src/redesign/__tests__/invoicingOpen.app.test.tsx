// INVOICING inside the real RedesignApp — who gets the screen (sql/220) and that it works for them.
//   • switch off and not on the preview list → the card of today (covered line by line in
//     invoicing.app.test.tsx, which this branch leaves green); here: the screen cannot be reached;
//   • switch on → every plan, Free too: the card opens Invoicing, a Free seller sends an invoice and it is saved;
//   • an admin and a login on the preview list get it with the switch off;
//   • a seller with the Messenger receipt: the card opens Invoicing, the Facebook tab leads to Receipt format;
//   • the iPhone app: the same screen, and no plan / price-of-the-app words on it.
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { render, act, screen, fireEvent, cleanup } from "@testing-library/react";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  role: { v: "seller" }, plan: { v: "free" }, status: { v: "active" }, expiry: { v: "" }, country: { v: "PH" }, email: { v: "u1@x.com" },
  access: { v: { facebook: false, receipt: false } },
  sw: { v: null as unknown },
  buyers: { v: [] as unknown[] },
  features: { v: {} as Record<string, boolean> },   // what the database's my_feature_access() answers
}));
const flush = async () => { for (let i = 0; i < 12; i++) await act(async () => { await Promise.resolve(); }); };

// The two Invoicing tables are the in-memory stand-in; every other database call in the app answers "nothing".
vi.mock("../../supabase", async () => {
  const { DB } = await import("../adapters/__tests__/invoiceFakeDb");
  const nothing = { data: null, error: { message: "not in this test" } };
  const chain = (): unknown => new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(nothing).then(ok) : () => chain()),
    apply: () => chain(),
  });
  const supabase = {
    from: (table: string) => (table === "invoice_sends" || table === "seller_receipt_settings" ? DB.supabase.from(table) : chain()),
    rpc: (name: string) => (name === "my_feature_access" ? Promise.resolve({ data: H.features.v, error: null }) : chain()),
    auth: {
      getSession: DB.supabase.auth.getSession,
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    channel: () => chain(), removeChannel: () => {},
    storage: { from: () => chain() },
    functions: { invoke: async () => nothing },
  };
  return { isSupabaseConfigured: true, supabase };
});
vi.mock("../components/inviteShare", async (orig) => ({ ...(await orig() as object), copyText: vi.fn(async () => true) }));
vi.mock("../adapters/featureSwitches", async (orig) => ({ ...(await orig() as object), useFeatureSwitches: () => H.sw.v }));
vi.mock("../adapters/fbAccess", async (orig) => ({ ...(await orig() as object), useFbAccess: () => H.access.v }));
vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: H.email.v, plan: H.plan.v, planStatus: H.status.v, planExpiry: H.expiry.v, role: H.role.v, connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "", country: H.country.v },
    },
    reloadProfile: vi.fn(async () => {}),
    signOut: async () => {},
  }),
}));
vi.mock("../adapters/useLiveFeed", async (orig) => ({
  ...(await orig() as object),
  useLiveFeed: () => ({
    comments: [], initialComments: [], connected: true, canInject: false, injectSynthetic: () => {}, getComment: () => undefined,
    activeAccounts: { TikTok: "", Facebook: "", Shopee: "" }, ttConnected: false, fbConnected: false,
    ttRecovering: false, fbRecovering: false, ttViewers: null, fbLastStop: null,
    shopeeConnected: false, shopeeLastStop: null, igConnected: false,
    connect: vi.fn(async () => ({ ok: true, account: "shop1" })), connectFacebook: vi.fn(async () => ({ ok: true })),
    ensureJoined: () => {},
  }),
}));
vi.mock("../adapters/useSessionInstance", async (orig) => ({
  ...(await orig() as object),
  useSessionInstance: () => ({
    currentSessionId: "S1", sessionStartedAt: "2026-11-26T04:00:00.000Z", sessionWindowDays: 1, ended: false, loaded: true, known: true, retry: () => {}, closed: false,
    ensureLoaded: async () => {}, checkStatus: async () => ({ running: true, platform: "TikTok" }),
    startSession: async () => "S2", endSession: async () => true,
  }),
}));
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: { buyers: H.buyers.v, orders: [] }, state: "live", loadError: false, dayId: "2026-11-26",
    getBuyers: () => H.buyers.v, applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => true, resync: () => {},
  }),
}));
vi.mock("../adapters/productsDb", async (orig) => ({ ...(await orig() as object), resolveInitialProducts: vi.fn(async () => ({ products: [], source: "local" })) }));
vi.mock("../adapters/receiptSettings", async (orig) => ({
  ...(await orig() as object),
  loadReceiptSettings: vi.fn(async () => ({ ok: true, settings: { opening: "", note: "", qrImage: null } })),
  saveReceiptSettings: vi.fn(async () => ({ ok: true })),
}));

import RedesignApp from "../RedesignApp";
import { SWITCHES_OFF } from "../adapters/featureSwitches";
import { setFeatureAccess } from "../adapters/featureAccess";
import { DB } from "../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows } from "../../lib/orderLogic";

const t = buildT("en");
const byText = (label: string) => screen.getAllByText(label).map((el) => el.closest("button")).find(Boolean)!;
const screenNow = () => document.querySelector("[data-screen]")?.getAttribute("data-screen");
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const card = () => screen.getByTestId("tile-invoicing");
async function openSettingsTab() {
  render(<RedesignApp />); await flush();
  fireEvent.click(byText(t.rd_nav_settings)); await flush();
  expect(screenNow()).toBe("menu");
}
const order = (n: number, handle: string, product: string, price: number) =>
  ({ buyer_number: n, handle, customer_name: handle.replace("@", ""), platform: "TikTok", product, price, created_at: `2026-11-26T05:0${n}:00.000Z`, session_date: "2026-11-26" });

beforeEach(() => {
  localStorage.clear(); DB.reset();
  window.history.replaceState({}, "", "/");
  H.role.v = "seller"; H.plan.v = "free"; H.status.v = "active"; H.expiry.v = ""; H.country.v = "PH"; H.email.v = "u1@x.com";
  H.access.v = { facebook: false, receipt: false };
  H.sw.v = { ...SWITCHES_OFF };
  H.buyers.v = rebuildSessionFromRows([order(1, "@ana", "A1 dress", 350), order(2, "@ben.t", "B2 top", 280)]).buyers;
  H.features.v = {};
  setFeatureAccess(null);
});
afterEach(() => { cleanup(); setFeatureAccess(null); });

describe("switch off, not on the preview list", () => {
  it("the card says Soon and the Invoicing screen is never shown", async () => {
    await openSettingsTab();
    expect(card().textContent).toBe(`Invoicing${t.rd_invoice_sub}Soon`);
    expect(q("invoicing-open")).toBeNull();
    fireEvent.click(card()); await flush();
    expect(screenNow()).toBe("menu");
    expect(q("invoicing-screen")).toBeNull();
    expect(DB.s.calls).toEqual([]);                       // nothing of Invoicing is read
  });
});

describe("switch on — every plan", () => {
  const PLANS: Array<[string, () => void]> = [
    ["Free plan", () => {}],
    ["Free plan in Taiwan", () => { H.country.v = "TW"; }],
    ["Basic plan", () => { H.plan.v = "basic"; }],
    ["Master plan", () => { H.plan.v = "master"; }],
    ["a plan that ended", () => { H.plan.v = "basic"; H.status.v = "expired"; H.expiry.v = "2026-01-01T00:00:00Z"; }],
  ];
  for (const [who, set] of PLANS) {
    it(`${who}: the card opens Invoicing with the session's TikTok buyers; Back returns to Settings`, async () => {
      set();
      H.sw.v = { ...SWITCHES_OFF, invoicing: true };
      await openSettingsTab();
      expect(card().textContent).toBe(`Invoicing${t.rd_invoice_sub}›`);   // no "Soon"
      expect(q("invoicing-soon")).toBeNull();
      fireEvent.click(card()); await flush();
      expect(screenNow()).toBe("invoicing");
      expect(q("ivc-send-next")!.textContent).toContain("#1 @ana");
      expect(document.querySelectorAll("[data-testid='ivc-row']")).toHaveLength(2);
      fireEvent.click(q("back-btn")!); await flush();
      expect(screenNow()).toBe("menu");
    });
  }
  it("a Free seller sends: Send next twice → buyer #1 is saved as Sent under this seller and this session", async () => {
    H.sw.v = { ...SWITCHES_OFF, invoicing: true };
    await openSettingsTab();
    fireEvent.click(card()); await flush();
    const clock = vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    fireEvent.click(q("ivc-send-next")!); await flush();
    clock.mockReturnValue(2_000_000 + 5_000);                               // back from TikTok a few seconds later
    fireEvent.click(q("ivc-send-next")!); await flush();
    clock.mockRestore();
    expect(DB.s.sends.map((r) => [r.user_id, r.session_key, r.platform, r.buyer_number, r.status])).toEqual([["u1", "S1", "tiktok", 1, "sent"]]);
    expect(q("ivc-progress-text")!.textContent).toBe("1 of 2 sent");
  });
});

describe("before the switch", () => {
  it("an admin has it", async () => {
    H.role.v = "admin"; H.plan.v = "master";
    await openSettingsTab();
    fireEvent.click(card()); await flush();
    expect(screenNow()).toBe("invoicing");
  });
  it("a login on the preview list has it", async () => {
    H.features.v = { invoicing: true };
    await openSettingsTab();
    expect(q("invoicing-open")).not.toBeNull();
    fireEvent.click(card()); await flush();
    expect(screenNow()).toBe("invoicing");
  });
  it("another preview key does not open it", async () => {
    H.features.v = { blacklist: true, tiktok_send: true, shopee_public: true };
    await openSettingsTab();
    fireEvent.click(card()); await flush();
    expect(screenNow()).toBe("menu");
  });
});

describe("a seller with the Messenger receipt", () => {
  beforeEach(() => { H.plan.v = "plus"; H.access.v = { facebook: true, receipt: true }; });
  it("switch on: the card opens Invoicing; the Facebook tab's button opens Receipt format; Back returns to Invoicing", async () => {
    H.sw.v = { ...SWITCHES_OFF, invoicing: true };
    await openSettingsTab();
    fireEvent.click(card()); await flush();
    expect(screenNow()).toBe("invoicing");
    fireEvent.click(q("ivc-tab-facebook")!);
    fireEvent.click(q("ivc-receipt-format")!); await flush();
    expect(screenNow()).toBe("receiptformat");
    expect(screen.getAllByText(t.rd_rc_title).length).toBeGreaterThan(0);
    fireEvent.click(q("back-btn")!); await flush();
    expect(screenNow()).toBe("invoicing");
  });
  it("switch off: the card still opens Receipt format, as today", async () => {
    await openSettingsTab();
    expect(card().textContent).toBe(`Invoicing${t.rd_invoice_sub}Soon`);
    fireEvent.click(card()); await flush();
    expect(screenNow()).toBe("receiptformat");
  });
});

describe("the iPhone app", () => {
  it("the same screen; no plan, upgrade or subscription words on it or in any of its texts", async () => {
    window.history.replaceState({}, "", "/?ios=1");
    H.sw.v = { ...SWITCHES_OFF, invoicing: true };
    await openSettingsTab();
    fireEvent.click(card()); await flush();
    expect(screenNow()).toBe("invoicing");
    const BAD = /\b(plan|plans|upgrade|subscri\w*|premium|renew|pricing|buy now)\b/i;
    for (const p of ["tiktok", "facebook", "instagram", "shopee"]) {
      fireEvent.click(q(`ivc-tab-${p}`)!);
      expect(q("invoicing-screen")!.textContent || "").not.toMatch(BAD);
    }
    fireEvent.click(q("ivc-tab-tiktok")!);
    fireEvent.click(q("ivc-format-btn")!);
    expect(q("ivc-format-sheet")!.textContent || "").not.toMatch(BAD);
    for (const [k, v] of Object.entries(t)) if (k.startsWith("rd_ivc_")) expect(`${k}: ${v}`.replace(k, "")).not.toMatch(BAD);
  });
});
