// Build 11 (M2 + M3) — the real RedesignApp, TikTok Connect button, Auto handler.
//   M2: no session running (it ended) but Facebook is still live on this phone → tapping TikTok
//       Connect shows the SAME switch dialog; its confirm stops Facebook, then the length picker.
//   M3: Auto mode orders only the session's own platform — a Facebook comment arriving into a
//       TikTok session (incomplete switch) creates no order; TikTok comments still do.
// TikTok-only sellers: no dialog, the picker as before; Auto unchanged.
import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from "vitest";
import { render, act, screen, fireEvent } from "@testing-library/react";
import type { Comment as ProdComment } from "../../lib/orderTypes";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  onComment: { fn: null as ((c: ProdComment) => void) | null },
  createOrder: { fn: null as Mock<(...args: unknown[]) => unknown> | null },
  status: { v: { running: false, platform: null as string | null } },
  fbConnected: { v: false },
  connect: { fn: null as Mock<(...args: unknown[]) => unknown> | null },
  fbDisconnect: { fn: null as Mock<(...args: unknown[]) => unknown> | null },
  startSession: { fn: null as Mock<(...args: unknown[]) => unknown> | null },
}));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "g@x.com", plan: "pro", planStatus: "active", planExpiry: "", role: "seller", connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "" },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));
vi.mock("../adapters/useLiveFeed", async (orig) => ({
  ...(await orig() as object),
  useLiveFeed: (_a: boolean, _b: string | undefined, onComment?: (c: ProdComment) => void) => {
    H.onComment.fn = onComment ?? null;
    return { comments: [], connected: false, canInject: false, injectSynthetic: () => {}, getComment: () => undefined, activeAccounts: { TikTok: "", Facebook: H.fbConnected.v ? "555" : "" }, ttConnected: false, fbConnected: H.fbConnected.v, shopeeConnected: false, igConnected: false, connect: (...a: unknown[]) => H.connect.fn!(...a) };
  },
}));
vi.mock("../adapters/useOrders", async (orig) => ({
  ...(await orig() as object),
  useOrders: () => ({ createOrder: (...args: unknown[]) => H.createOrder.fn!(...args) }),
}));
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: "2026-10-09",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {},
  }),
}));
vi.mock("../adapters/useSessionInstance", async (orig) => ({
  ...(await orig() as object),
  useSessionInstance: () => ({
    currentSessionId: "S1", sessionStartedAt: null, sessionWindowDays: 1, ended: false, loaded: true, known: true, retry: () => {},
    ensureLoaded: async () => {}, checkStatus: async () => H.status.v,
    startSession: (...a: unknown[]) => H.startSession.fn!(...a), endSession: async () => true,
  }),
}));
vi.mock("../adapters/featureSwitches", async (orig) => {
  const a = await orig() as { SWITCHES_OFF: Record<string, boolean> };
  const on = { ...a.SWITCHES_OFF, fbConnectV2: true };
  return { ...a, useFeatureSwitches: () => on, loadFeatureSwitches: async () => on };
});
vi.mock("../adapters/fb", async (orig) => ({
  ...(await orig() as object),
  fbDisconnect: (...a: unknown[]) => H.fbDisconnect.fn!(...a),
  listFbPages: async () => [{ id: "r1", pageId: "555", name: "Shop Page", username: "", active: true }],
}));
vi.mock("../adapters/fbAccess", async (orig) => ({ ...(await orig() as object), useFbAccess: () => ({ facebook: true, receipt: false }) }));
vi.mock("../adapters/productsDb", async (orig) => ({
  ...(await orig() as object),
  resolveInitialProducts: vi.fn(async () => ({ products: [{ id: 14, name: "Brief", sku: "BR", price: 52, stock: 5, platform: "TikTok", status: "Active", liveCode: "D" }], source: "local" })),
}));

import RedesignApp from "../RedesignApp";

const t = buildT("en");
const comment = (platform: "TikTok" | "Facebook", n: number): ProdComment => ({
  handle: `${platform}${n}`, name: `B${n}`, comment: "D", platform, isBuy: false, buyerNum: null, buyerData: null,
  time: "9:41:00 PM", timestamp: `2026-10-09T13:41:0${n}.000Z`, sessionId: "s1", sourceUsername: "",
});
async function mount() {
  localStorage.setItem("sfl_rd_automode", "1");
  render(<RedesignApp />);
  await flush();
}
const tapTikTokConnect = async () => {
  fireEvent.click(screen.getAllByRole("button").find((b) => (b.textContent || "").includes("shop1"))!); // the TikTok chip
  await flush();
  const btn = screen.getAllByRole("button").find((b) => b.textContent === t.rd_dash_connect);
  expect(btn).toBeTruthy();
  fireEvent.click(btn!);
  await flush();
};

beforeEach(() => {
  localStorage.clear();
  H.status.v = { running: false, platform: null };
  H.fbConnected.v = false;
  H.connect.fn = vi.fn(async () => ({ ok: true, account: "shop1" }));
  H.fbDisconnect.fn = vi.fn(async () => ({ ok: true }));
  H.startSession.fn = vi.fn(async () => "S2");
  H.createOrder.fn = vi.fn(() => ({ orderNum: Date.now(), item: "D", qty: 1, price: 52, total: 52, time: "", handle: "h", name: "B", bNum: 1, platform: "TikTok", status: "New", date: "2026-10-09" }));
});

describe("M2 — switch while no session is running", () => {
  it("Facebook still live, session ended → TikTok Connect shows the switch dialog (not the picker)", async () => {
    H.fbConnected.v = true;
    await mount();
    await tapTikTokConnect();
    expect(screen.queryByTestId("livesource-switch-overlay")).not.toBeNull();
    expect(H.startSession.fn).not.toHaveBeenCalled();
    // confirm → Facebook is stopped, then the length picker (no forced start)
    fireEvent.click(screen.getByTestId("livesource-switch-confirm"));
    await flush();
    expect(H.fbDisconnect.fn).toHaveBeenCalledTimes(1);
    expect(H.fbDisconnect.fn).toHaveBeenCalledWith("555");
    expect(H.startSession.fn).not.toHaveBeenCalled();
    expect(screen.queryByTestId("livesource-switch-overlay")).toBeNull();
    expect(screen.getByText(t.rd_sp_title)).toBeTruthy(); // the length picker
  });

  it("TikTok-only seller (nothing else live): no dialog, the picker as before", async () => {
    await mount();
    await tapTikTokConnect();
    expect(screen.queryByTestId("livesource-switch-overlay")).toBeNull();
    expect(screen.getByText(t.rd_sp_title)).toBeTruthy();
    expect(H.fbDisconnect.fn).not.toHaveBeenCalled();
  });
});

describe("M3 — Auto mode orders only the session's platform", () => {
  it("TikTok session: a Facebook 'D' is ignored, a TikTok 'D' is ordered", async () => {
    H.status.v = { running: true, platform: "TikTok" };
    await mount();
    await tapTikTokConnect();                         // continue the running TikTok session
    await act(async () => { H.onComment.fn?.(comment("Facebook", 1)); });
    expect(H.createOrder.fn).not.toHaveBeenCalled();
    await act(async () => { H.onComment.fn?.(comment("TikTok", 2)); });
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
  });

  it("before any Connect on this phone (platform unknown): Auto works as before", async () => {
    await mount();
    await act(async () => { H.onComment.fn?.(comment("TikTok", 1)); });
    expect(H.createOrder.fn).toHaveBeenCalledTimes(1);
  });
});
