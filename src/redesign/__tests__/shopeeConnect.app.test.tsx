// Shopee paste-link connect — the real RedesignApp, the real Live picker and the real paste box
// (2026-11-22). Boundaries mocked: auth, the Shopee beta row, the live feed, the session hook (its
// check is held open so the test can tap during it), the /shopee/live/connect call.
//   Item 2: ONE connect per tap burst — the box is busy from the tap through the session check and
//           the request; ✓ Connected once green with the same link.
import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from "vitest";
import { render, act, screen, fireEvent, within } from "@testing-library/react";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

type Deferred<T> = { p: Promise<T>; resolve: (v: T) => void };
const deferred = <T,>(): Deferred<T> => { let resolve!: (v: T) => void; const p = new Promise<T>((r) => { resolve = r; }); return { p, resolve }; };

const H = vi.hoisted(() => ({
  status: { v: { running: true, platform: "Shopee" as string | null } },
  statusGate: { p: null as Promise<void> | null },          // checkStatus waits on this when set
  checkStatus: { n: 0 },
  linkConnect: { fn: null as Mock<(...a: unknown[]) => unknown> | null },
  shopeeConnected: { v: false },
  ensureJoined: { fn: null as Mock<() => void> | null },
  startSession: { fn: null as Mock<(...a: unknown[]) => unknown> | null },
}));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "g@x.com", plan: "pro", planStatus: "active", planExpiry: "", role: "seller", connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "", country: "PH" },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));
vi.mock("../adapters/shopeeBeta", async (orig) => ({
  ...(await orig() as object),
  useShopeeBeta: () => ({ expiresAt: "2099-01-01T00:00:00Z", shopeeUid: null }),
}));
vi.mock("../adapters/useLiveFeed", async (orig) => ({
  ...(await orig() as object),
  useLiveFeed: () => ({
    comments: [], initialComments: [], connected: true, canInject: false, injectSynthetic: () => {}, getComment: () => undefined,
    activeAccounts: { TikTok: "", Facebook: "", Shopee: H.shopeeConnected.v ? "777" : "" }, ttConnected: false, fbConnected: false,
    ttRecovering: false, fbRecovering: false, ttViewers: null, fbLastStop: null,
    shopeeConnected: H.shopeeConnected.v, igConnected: false,
    connect: vi.fn(async () => ({ ok: true, account: "shop1" })), connectFacebook: vi.fn(async () => ({ ok: true })),
    ensureJoined: () => H.ensureJoined.fn!(),
  }),
}));
vi.mock("../adapters/useSessionInstance", async (orig) => ({
  ...(await orig() as object),
  useSessionInstance: () => ({
    currentSessionId: "S1", sessionStartedAt: null, sessionWindowDays: 1, ended: false, loaded: true, known: true, retry: () => {}, closed: false,
    ensureLoaded: async () => {},
    checkStatus: async () => { H.checkStatus.n++; if (H.statusGate.p) await H.statusGate.p; return H.status.v; },
    startSession: (...a: unknown[]) => H.startSession.fn!(...a), endSession: async () => true,
  }),
}));
vi.mock("../adapters/shopeeLink", async (orig) => ({
  ...(await orig() as object),
  shopeeLinkConnect: (...a: unknown[]) => H.linkConnect.fn!(...a),
}));
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: "2026-11-22",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => true, resync: () => {},
  }),
}));
vi.mock("../adapters/productsDb", async (orig) => ({
  ...(await orig() as object),
  resolveInitialProducts: vi.fn(async () => ({ products: [], source: "local" })),
}));

import RedesignApp from "../RedesignApp";

const t = buildT("en");
const LINK = "https://ph.shp.ee/AbCdEf12";
async function mount() { render(<RedesignApp />); await flush(); }
const openBox = async () => {
  fireEvent.click(screen.getByTestId("lpk-tile-sh"));
  await flush();
  return within(screen.getByTestId("lpk-panel-sh"));
};
const btn = () => screen.getByTestId("sh-link-connect") as HTMLButtonElement;
const typeLink = (v: string) => fireEvent.change(screen.getByTestId("sh-link-input"), { target: { value: v } });

beforeEach(() => {
  localStorage.clear();
  H.status.v = { running: true, platform: "Shopee" };
  H.statusGate.p = null;
  H.checkStatus.n = 0;
  H.shopeeConnected.v = false;
  H.ensureJoined.fn = vi.fn();
  H.startSession.fn = vi.fn(async () => "S2");
  H.linkConnect.fn = vi.fn(async () => ({ ok: true, uid: "777", region: "ph" }));
});

const sourceButton = () => screen.getByTestId("lpk-source-button");
const tile = () => screen.getByTestId("lpk-tile-sh");

describe("Item 2 — one connect per tap burst", () => {
  it("Live picker: a same-moment double tap → one session check, one connect request; the tile says Connecting… from the tap", async () => {
    const gate = deferred<void>();
    H.statusGate.p = gate.p;
    await mount();
    await openBox();
    typeLink(LINK);
    const b = btn();
    act(() => { b.click(); b.click(); });                       // two taps in the same moment
    await flush();
    expect(tile().textContent).toContain(t.rd_dash_connecting);  // busy during the session check
    expect(screen.queryByTestId("sh-link-form")).toBeNull();     // the picker hides the box while connecting
    gate.resolve();
    await flush();
    expect(H.checkStatus.n).toBe(1);
    expect(H.linkConnect.fn).toHaveBeenCalledTimes(1);
    expect(H.linkConnect.fn!.mock.calls[0][0]).toBe(LINK);
  });
  it("Change link (Shopee green): Connecting… and not tappable for the whole connect — check AND request — then ✓ Connected; another link → Connect", async () => {
    H.shopeeConnected.v = true;
    const gate = deferred<void>();
    const answer = deferred<unknown>();
    H.statusGate.p = gate.p;
    H.linkConnect.fn = vi.fn(() => answer.p);
    await mount();
    fireEvent.click(sourceButton());                            // "Shopee Live · Change link"
    await flush();
    typeLink(LINK);
    fireEvent.click(btn());
    expect(btn().textContent).toBe(t.rd_dash_connecting);       // from the tap, before the check answers
    expect(btn().disabled).toBe(true);
    fireEvent.click(btn());
    fireEvent.keyDown(screen.getByTestId("sh-link-input"), { key: "Enter" });
    gate.resolve();
    await flush();                                              // check done → request out, still busy
    expect(H.linkConnect.fn).toHaveBeenCalledTimes(1);
    expect(btn().textContent).toBe(t.rd_dash_connecting);
    fireEvent.click(btn());
    await flush();
    expect(H.linkConnect.fn).toHaveBeenCalledTimes(1);
    answer.resolve({ ok: true, uid: "777", region: "ph" });
    await flush();
    expect(btn().textContent).toBe(t.rd_sh_connected_btn);      // green + the box holds the connected link
    expect(btn().disabled).toBe(true);
    fireEvent.click(btn());
    await flush();
    expect(H.linkConnect.fn).toHaveBeenCalledTimes(1);          // no restart from a tap on ✓ Connected
    expect(H.checkStatus.n).toBe(1);
    typeLink("https://ph.shp.ee/NewLive99");
    expect(btn().textContent).toBe(t.rd_shp_connect);
    expect(btn().disabled).toBe(false);
  });
  it("no session running → the length picker opens; the box is back with the typed link and Connect is free", async () => {
    H.status.v = { running: false, platform: null };
    await mount();
    await openBox();
    typeLink(LINK);
    fireEvent.click(btn());
    await flush();
    expect(H.linkConnect.fn).not.toHaveBeenCalled();
    expect(screen.getByText(t.rd_sp_title)).toBeTruthy();       // the session-length picker
    expect(btn().disabled).toBe(false);
    expect(btn().textContent).toBe(t.rd_shp_connect);
    expect((screen.getByTestId("sh-link-input") as HTMLInputElement).value).toBe(LINK);
  });
});
