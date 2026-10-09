// Build 13 Fix 3 — the real RedesignApp after a session ended (End Session, or its length ran
// out). Jeff's decision: with nothing live, the Live screen shows ONLY the 4-platform picker —
// no "TODAY" card, no "Session ended" card, no old comments — right away (no reload) and the
// same after a reload. A new session brings the normal live view back. Display only: how and
// when the session ends is not touched (the session adapter is mocked here; its own reading of
// the end stamp is pinned in useSessionInstance.closed.test.tsx).
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, act, screen, fireEvent, within } from "@testing-library/react";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

type St = { id: string | null; ended: boolean; closed: boolean };
const H = vi.hoisted(() => ({
  init: { id: "S1", ended: false, closed: false } as { id: string | null; ended: boolean; closed: boolean },
  set: null as ((s: { id: string | null; ended: boolean; closed: boolean }) => void) | null,
  platform: "TikTok" as string,
  fbConnected: false,
  endCalls: 0,
}));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "owner@x.com", plan: "master", planStatus: "active", planExpiry: "", role: "admin", connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "" },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));
// session_v2 on (the End Session button); every other database feature switch off.
vi.mock("../adapters/featureAccess", async (orig) => ({
  ...(await orig() as object),
  hasFeature: (k: string) => k === "session_v2",
  useFeatureAccess: () => ({}),
}));
vi.mock("../adapters/useLiveFeed", async (orig) => ({
  ...(await orig() as object),
  useLiveFeed: () => ({
    comments: [{ id: "c1", name: "Ann", handle: "@ann", text: "old comment from the ended live", time: "1:00", platform: "TikTok", mine: false }],
    connected: false, canInject: false, injectSynthetic: () => {}, getComment: () => undefined,
    activeAccounts: { TikTok: "", Facebook: H.fbConnected ? "555" : "" },
    ttConnected: false, fbConnected: H.fbConnected, shopeeConnected: false, igConnected: false,
    connect: async () => ({ ok: true, account: "shop1" }),
  }),
}));
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: {
      buyers: [{ handle: "a", name: "A", platform: "TikTok", num: 1, orders: [], totalSpent: 700, totalOrders: 2 }],
      orders: [
        { orderNum: 1, item: "A", qty: 1, price: 350, total: 350, time: "14:05", handle: "a", name: "A", bNum: 1, platform: "TikTok", status: "New", date: "2026-10-09" },
        { orderNum: 2, item: "A", qty: 1, price: 350, total: 350, time: "14:06", handle: "a", name: "A", bNum: 1, platform: "TikTok", status: "New", date: "2026-10-09" },
      ],
    },
    state: "live", loadError: false, dayId: "2026-10-09",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {},
  }),
}));
vi.mock("../adapters/useSessionInstance", async (orig) => {
  const React = await import("react");
  return {
    ...(await orig() as object),
    useSessionInstance: () => {
      const [st, setSt] = React.useState<St>(H.init);
      H.set = setSt;
      return {
        currentSessionId: st.id, sessionStartedAt: st.id ? "2026-10-09T01:00:00Z" : null, sessionWindowDays: st.id ? 1 : null,
        ended: st.ended, closed: st.closed, loaded: true, known: true, retry: () => {},
        ensureLoaded: async () => {}, checkStatus: async () => ({ running: !!st.id && !st.ended, sessionId: st.id && !st.ended ? st.id : null, platform: H.platform }),
        startSession: async () => { setSt({ id: "S2", ended: false, closed: false }); return "S2"; },
        endSession: async () => { H.endCalls++; setSt({ id: null, ended: false, closed: true }); return true; },
      };
    },
  };
});

import RedesignApp from "../RedesignApp";

const t = buildT("en");
async function mount(init: St) {
  H.init = init;
  render(<RedesignApp />);
  await flush();
}
const pickerShown = () => !!screen.queryByTestId("lpk-picker");
const todayCard = () => screen.queryByText(t.rd_dash_today_badge);
const endedCard = () => screen.queryByTestId("session-ended-empty");
const oldComment = () => screen.queryByText("old comment from the ended live");
const expectEndedScreen = () => {
  expect(pickerShown()).toBe(true);                // the 4-platform picker
  expect(todayCard()).toBeNull();                  // no "TODAY · 1 buyers · 2 orders"
  expect(endedCard()).toBeNull();                  // no gray "Session ended" card either
  expect(oldComment()).toBeNull();                 // the ended live's comments are not on the board
};

beforeEach(() => {
  localStorage.clear();
  H.platform = "TikTok";
  H.fbConnected = false;
  H.endCalls = 0;
});

describe.each(["TikTok", "Facebook"])("%s session", (platform) => {
  beforeEach(() => { H.platform = platform; });

  it("running → End Session → the picker at once (no reload), no summary card, no old comments", async () => {
    await mount({ id: "S1", ended: false, closed: false });
    expect(todayCard()).not.toBeNull();            // running session: the normal live view
    expect(oldComment()).not.toBeNull();
    expect(pickerShown()).toBe(false);
    fireEvent.click(screen.getByTestId("session-end-btn"));
    fireEvent.click(screen.getByTestId("end-session-go"));
    await flush();
    expect(H.endCalls).toBe(1);
    expectEndedScreen();
  });

  it("after a reload (the session row is ended) → the same picker screen", async () => {
    await mount({ id: null, ended: false, closed: true });
    expectEndedScreen();
  });

  it("its length ran out while the app is open → the picker, no summary card (no reload)", async () => {
    await mount({ id: "S1", ended: false, closed: false });
    expect(todayCard()).not.toBeNull();
    await act(async () => { H.set!({ id: "S1", ended: true, closed: false }); }); // what the Taipei-midnight re-check does
    await flush();
    expectEndedScreen();
  });

  it("its length ran out while the app was closed → it opens straight on the picker", async () => {
    await mount({ id: "S1", ended: true, closed: false });
    expectEndedScreen();
  });
});

describe("a new session brings the normal view back", () => {
  it("ended → tap Connect → owner Start → the live view with its summary returns", async () => {
    await mount({ id: null, ended: false, closed: true });
    expectEndedScreen();
    fireEvent.click(screen.getByTestId("lpk-tile-tt"));
    const panel = screen.getByTestId("lpk-panel-tt");
    fireEvent.click(within(panel).getByRole("button", { name: "Connect" }));
    await flush();
    expect(pickerShown()).toBe(true);              // while the Start dialog is open: still ended
    expect(todayCard()).toBeNull();
    fireEvent.click(screen.getByTestId("owner-session-start"));
    await flush();
    expect(todayCard()).not.toBeNull();            // new session: summary card back
    expect(oldComment()).not.toBeNull();
  });
});

describe("still live when the session ends → unchanged (no picker over a live)", () => {
  it("Facebook still connected → the board stays", async () => {
    H.fbConnected = true;
    await mount({ id: "S1", ended: true, closed: false });
    expect(pickerShown()).toBe(false);
    expect(oldComment()).not.toBeNull();
  });
});
