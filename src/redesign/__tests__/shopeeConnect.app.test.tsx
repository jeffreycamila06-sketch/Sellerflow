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
  lastStop: { v: null as { reason: string; at: number } | null },
  uid: { v: "u1" },
  signOut: { fn: null as Mock<(...a: unknown[]) => unknown> | null },
  ensureJoined: { fn: null as Mock<() => void> | null },
  startSession: { fn: null as Mock<(...a: unknown[]) => unknown> | null },
}));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: H.uid.v, email: `${H.uid.v}@x.com`, plan: "pro", planStatus: "active", planExpiry: "", role: "seller", connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "", country: "PH" },
    },
    reloadProfile: vi.fn(async () => {}),
    signOut: async () => {},
  }),
}));
vi.mock("../adapters/logoutReset", async (orig) => ({
  ...(await orig() as object),
  signOutAndReload: (...a: unknown[]) => H.signOut.fn!(...a),
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
    shopeeConnected: H.shopeeConnected.v, shopeeLastStop: H.lastStop.v, igConnected: false,
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
let app: ReturnType<typeof render> | null = null;
async function mount() { app = render(<RedesignApp />); await flush(); }
const rerender = async () => { app!.rerender(<RedesignApp />); await flush(); };
const serverStop = async (reason: string) => { H.shopeeConnected.v = false; H.lastStop.v = { reason, at: Date.now() }; await rerender(); };
const notice = () => screen.queryByTestId("sh-link-notice");
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
  H.lastStop.v = null;
  H.uid.v = "u1";
  H.signOut.fn = vi.fn(async () => {});
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

describe("Item 3 — the stop line on the box", () => {
  it.each([
    ["session_end", "rd_sh_stop_ended"], ["unreachable", "rd_sh_stop_unreachable"], ["restart", "rd_sh_stop_other_device"],
    ["shutdown", "rd_sh_stop_reset"], ["max_session", "rd_sh_stop_time_limit"],
  ])("server stop %s → one orange line on the box", async (reason, key) => {
    H.shopeeConnected.v = true;
    await mount();
    await serverStop(reason);
    await openBox();
    expect(notice()?.textContent).toBe((t as unknown as Record<string, string>)[key]);
    expect(notice()?.className).toBe("sfl-sh-notice");
    expect(screen.getAllByRole("status").filter((e) => e.dataset.testid === "sh-link-notice")).toHaveLength(1);
  });
  it("an unknown reason → no line (the pill still turns gray)", async () => {
    H.shopeeConnected.v = true;
    await mount();
    await serverStop("something_new");
    await openBox();
    expect(notice()).toBeNull();
  });
  it("this device's OWN new connect stops its old reader ('restart') → never 'connected on another device'", async () => {
    H.shopeeConnected.v = true;
    const answer = deferred<unknown>();
    H.linkConnect.fn = vi.fn(() => answer.p);
    await mount();
    fireEvent.click(sourceButton());
    await flush();
    typeLink("https://ph.shp.ee/NewLive99");
    fireEvent.click(btn());
    await flush();                                              // our request is out
    await serverStop("restart");                                // the server stops our old reader first
    answer.resolve({ ok: false, error: "unreachable" });        // …and then our connect fails
    await flush();
    await openBox();
    expect(notice()).toBeNull();                                // no "another device" line
    expect(screen.getByTestId("sh-link-error").textContent).toBe(t.rd_sh_err_unreach);
  });
  it("a restart long after our own connect → another device → the line", async () => {
    H.shopeeConnected.v = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-22T05:00:00Z"));
      await mount();
      fireEvent.click(sourceButton());
      await flush();
      typeLink(LINK);
      fireEvent.click(btn());
      await flush();
      vi.setSystemTime(new Date("2026-11-22T05:20:00Z"));      // 20 minutes later
      await serverStop("restart");
      await openBox();
      expect(notice()?.textContent).toBe(t.rd_sh_stop_other_device);
    } finally { vi.useRealTimers(); }
  });
  it("the line goes when Shopee is green again, and at the next Connect tap", async () => {
    H.shopeeConnected.v = true;
    await mount();
    await serverStop("unreachable");
    await openBox();
    expect(notice()).not.toBeNull();
    const gate = deferred<void>();
    H.statusGate.p = gate.p;
    fireEvent.click(btn() /* the box still holds nothing */);
    typeLink(LINK);
    fireEvent.click(btn());                                     // a new connect → the old line goes
    gate.resolve();
    await flush();
    expect(notice()).toBeNull();
    await serverStop("shutdown");
    expect(notice()?.textContent).toBe(t.rd_sh_stop_reset);
    H.shopeeConnected.v = true;                                 // green again
    await rerender();
    fireEvent.click(sourceButton());
    await flush();
    expect(notice()).toBeNull();
  });
});

const KEY = (uid: string) => `sfl_rd_shopee_last_link:${uid}`;
const lastNote = () => screen.queryByTestId("sh-link-last-note");
const inputValue = () => (screen.getByTestId("sh-link-input") as HTMLInputElement).value;
const connectOk = async () => {
  await openBox();
  typeLink(LINK);
  fireEvent.click(btn());
  await flush();
};

describe("Item 4 — the last link is remembered on this device", () => {
  it("a connect the server accepted saves the link under THIS seller; the next app open shows it + the note", async () => {
    await mount();
    await connectOk();
    expect(localStorage.getItem(KEY("u1"))).toBe(LINK);
    app!.unmount();
    await mount();                                              // the app opened again (gray, like after a restart)
    await openBox();
    expect(inputValue()).toBe(LINK);
    expect(lastNote()?.textContent).toBe(t.rd_sh_last_link_note);
    expect(btn().textContent).toBe(t.rd_shp_connect);
    expect(btn().disabled).toBe(false);                         // one tap reconnects
    typeLink("https://ph.shp.ee/NewLive99");
    expect(lastNote()).toBeNull();                              // a new link → no "last link" note
  });
  it("a refused connect saves nothing", async () => {
    H.linkConnect.fn = vi.fn(async () => ({ ok: false, error: "not_own" }));
    await mount();
    await connectOk();
    expect(localStorage.getItem(KEY("u1"))).toBeNull();
  });
  it("the server says the live ended (session_end) → the saved link is cleared and the box is empty", async () => {
    localStorage.setItem(KEY("u1"), LINK);
    H.shopeeConnected.v = true;
    await mount();
    await serverStop("session_end");
    expect(localStorage.getItem(KEY("u1"))).toBeNull();
    await openBox();
    expect(inputValue()).toBe("");
    expect(notice()?.textContent).toBe(t.rd_sh_stop_ended);
    expect(lastNote()).toBeNull();
  });
  it("a connect that answers 'ended' → the saved link is cleared and the box is empty", async () => {
    localStorage.setItem(KEY("u1"), LINK);
    H.linkConnect.fn = vi.fn(async () => ({ ok: false, error: "ended" }));
    await mount();
    await openBox();
    expect(inputValue()).toBe(LINK);
    fireEvent.click(btn());
    await flush();
    expect(localStorage.getItem(KEY("u1"))).toBeNull();
    expect(inputValue()).toBe("");
    expect(screen.getByTestId("sh-link-error").textContent).toBe(t.rd_sh_err_ended);
  });
  it.each(["unreachable", "restart", "shutdown", "max_session"])("every other stop (%s) keeps the link", async (reason) => {
    localStorage.setItem(KEY("u1"), LINK);
    H.shopeeConnected.v = true;
    await mount();
    await serverStop(reason);
    expect(localStorage.getItem(KEY("u1"))).toBe(LINK);
    await openBox();
    expect(inputValue()).toBe(LINK);
  });
  it("signing out clears it", async () => {
    localStorage.setItem(KEY("u1"), LINK);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: t.rd_nav_settings }));
    await flush();
    fireEvent.click(screen.getByText(t.rd_sh_logout));
    await flush();
    expect(H.signOut.fn).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY("u1"))).toBeNull();
  });
  it("another seller signed in on the same device sees no saved link", async () => {
    localStorage.setItem(KEY("u1"), LINK);
    H.uid.v = "u2";
    await mount();
    await openBox();
    expect(inputValue()).toBe("");
    expect(lastNote()).toBeNull();
    expect(localStorage.getItem(KEY("u1"))).toBe(LINK);        // the first seller's link is untouched
  });
});
