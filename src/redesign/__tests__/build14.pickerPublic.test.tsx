// Build 14 — the 4-platform Live picker for EVERY seller (it was admin-only). Look only: every
// tile / row / button calls the same callbacks as before. The real RedesignApp as a normal seller:
//   • the picker with 4 tiles (no classic chip row), the same tiles an admin sees;
//   • TikTok tile → the same account panel an admin gets; its rows / Connect run today's connect;
//   • Facebook tile WITHOUT Facebook access → today's "activation required" notice + Telegram
//     link (the classic Facebook dropdown's content, byte for byte); WITH access → unchanged;
//   • Instagram / Shopee → "Coming soon", not tappable;
//   • connected → one header button for the live source (today's dropdown, Disconnect inside).
// And the Dashboard itself: hidden platform chips (platform worlds) never empty the picker.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, act, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { buildT, TProvider } from "../i18n";
import { TELEGRAM_URL } from "../../lib/telegram";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({
  role: "seller",
  fbAccess: false,
  ttConnected: false,
  picker: true,
  status: { running: false, platform: null as string | null },
  connect: null as null | ((...a: unknown[]) => Promise<unknown>),
}));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "seller@x.com", plan: "pro", planStatus: "active", planExpiry: "", role: H.role, connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1, shop2", facebook: "", adminContactNote: "" },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));
vi.mock("../adapters/useLiveFeed", async (orig) => ({
  ...(await orig() as object),
  useLiveFeed: () => ({
    comments: [], connected: H.ttConnected, canInject: false, injectSynthetic: () => {}, getComment: () => undefined,
    activeAccounts: { TikTok: H.ttConnected ? "shop1" : "", Facebook: "" },
    ttConnected: H.ttConnected, fbConnected: false, shopeeConnected: false, igConnected: false,
    connect: (...a: unknown[]) => H.connect!(...a),
  }),
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
    currentSessionId: "S1", sessionStartedAt: null, sessionWindowDays: 1, ended: false, closed: false, loaded: true, known: true, retry: () => {},
    ensureLoaded: async () => {}, checkStatus: async () => H.status,
    startSession: async () => "S2", endSession: async () => true,
  }),
}));
vi.mock("../adapters/fbAccess", async (orig) => ({ ...(await orig() as object), useFbAccess: () => ({ facebook: H.fbAccess, receipt: false }) }));
vi.mock("../adapters/fb", async (orig) => ({
  ...(await orig() as object),
  listFbPages: async () => (H.fbAccess ? [{ id: "r1", pageId: "555", name: "Shop Page", username: "", active: true }] : []),
}));
// Only to show the classic Facebook dropdown next to the picker (the "today's behaviour" check).
vi.mock("../adapters/livePicker", async (orig) => {
  const a = await orig() as { livePickerEnabled: (isAdmin: boolean) => boolean };
  return { ...a, livePickerEnabled: (isAdmin: boolean) => H.picker && a.livePickerEnabled(isAdmin) };
});

import RedesignApp from "../RedesignApp";
import Dashboard from "../screens/Dashboard";

const t = buildT("en");
async function mount() { render(<RedesignApp />); await flush(); }
const tile = (slug: string) => screen.getByTestId(`lpk-tile-${slug}`) as HTMLButtonElement;
const panel = (slug: string) => screen.getByTestId(`lpk-panel-${slug}`);
const openTile = async (slug: string) => { fireEvent.click(tile(slug)); await flush(); return panel(slug); };
// Everything a seller can see and tap in a panel / dropdown: its text and its buttons + links.
const shape = (el: HTMLElement) => ({
  text: el.textContent,
  buttons: within(el).queryAllByRole("button").map((b) => `${b.textContent}|${(b as HTMLButtonElement).disabled}`),
  links: within(el).queryAllByRole("link").map((a) => `${a.textContent}|${a.getAttribute("href")}|${a.getAttribute("target")}`),
});

beforeEach(() => {
  localStorage.clear();
  H.role = "seller"; H.fbAccess = false; H.ttConnected = false; H.picker = true;
  H.status = { running: false, platform: null };
  H.connect = vi.fn(async () => ({ ok: true, account: "shop1" }));
});

describe("a normal seller (not admin) gets the picker", () => {
  it("4 tiles in order, no classic chip row; the same tiles an admin sees", async () => {
    await mount();
    const ids = () => screen.getAllByTestId(/^lpk-tile-/).map((b) => `${b.getAttribute("data-testid")}|${b.textContent}|${(b as HTMLButtonElement).disabled}`);
    const seller = ids();
    expect(seller.map((s) => s.split("|")[0])).toEqual(["lpk-tile-tt", "lpk-tile-fb", "lpk-tile-ig", "lpk-tile-sh"]);
    expect(screen.queryByText(t.rd_dash_connect_facebook)).toBeNull();          // the classic Facebook chip
    expect(screen.queryByText(t.rd_dash_waiting)).toBeNull();                   // the classic empty card
    expect(screen.getByText(t.rd_dash_live_comments)).toBeTruthy();
    cleanup();
    H.role = "admin";
    await mount();
    expect(ids()).toEqual(seller);
  });

  it("Instagram and Shopee: \"Coming soon\", not tappable", async () => {
    await mount();
    for (const slug of ["ig", "sh"]) {
      expect(tile(slug).disabled).toBe(true);
      expect(within(tile(slug)).getByText(t.rd_ls_soon)).toBeTruthy();
      fireEvent.click(tile(slug));
      await flush();
      expect(screen.queryByTestId(`lpk-panel-${slug}`)).toBeNull();
      expect(screen.getByTestId("lpk-picker").className).not.toContain("sfl-lpk--chosen");
    }
  });
});

describe("TikTok tile", () => {
  it("opens the same account panel an admin gets", async () => {
    await mount();
    const seller = shape(await openTile("tt"));
    expect(seller.buttons.some((b) => b.startsWith("Sshop2"))).toBe(true);
    expect(seller.buttons).toContain(`${t.rd_dash_connect}|false`);
    cleanup();
    H.role = "admin";
    await mount();
    expect(shape(await openTile("tt"))).toEqual(seller);
  });

  it("no session running → Connect opens today's session-length picker (no connect yet)", async () => {
    await mount();
    const p = await openTile("tt");
    fireEvent.click(within(p).getByRole("button", { name: t.rd_dash_connect }));
    await flush();
    expect(screen.getByText(t.rd_sp_title)).toBeTruthy();
    expect(H.connect).not.toHaveBeenCalled();
  });

  it("running TikTok session → pick the 2nd account → Connect connects that account (today's connect)", async () => {
    H.status = { running: true, platform: "TikTok" };
    await mount();
    const p = await openTile("tt");
    fireEvent.click(within(p).getAllByRole("button").find((b) => (b.textContent || "").includes("shop2"))!);
    await flush();
    expect(within(panel("tt")).getAllByRole("button").find((b) => (b.textContent || "").includes("shop2"))!.textContent).toContain("✓");
    fireEvent.click(within(panel("tt")).getByRole("button", { name: t.rd_dash_connect }));
    await flush();
    expect(H.connect).toHaveBeenCalledTimes(1);
    expect(H.connect).toHaveBeenCalledWith("TikTok", { username: "shop2" });
  });

  it("Manage / add accounts → the TikTok accounts screen (as today)", async () => {
    await mount();
    const p = await openTile("tt");
    fireEvent.click(within(p).getByRole("button", { name: new RegExp(t.rd_dash_manage_accounts) }));
    await flush();
    expect(screen.queryByTestId("lpk-picker")).toBeNull();
    expect(screen.getByText(t.rd_ch_manage_tt_title)).toBeTruthy();
  });
});

describe("Facebook tile", () => {
  it("without Facebook access → today's activation notice + Telegram link (same as the classic dropdown)", async () => {
    // Today: the classic Facebook chip's dropdown for this seller.
    H.picker = false;
    await mount();
    fireEvent.click(screen.getByText(t.rd_dash_connect_facebook).closest("button")!);
    await flush();
    const notice = screen.getByText(t.rd_dash_fb_activation);
    const classic = shape(notice.parentElement as HTMLElement);
    cleanup();
    // Now: the picker's Facebook tile.
    H.picker = true;
    await mount();
    const p = await openTile("fb");
    expect(shape(p)).toEqual(classic);
    const link = within(p).getByRole("link", { name: new RegExp(t.rd_dash_fb_contact) });
    expect(link.getAttribute("href")).toBe(TELEGRAM_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(within(p).queryByRole("button", { name: t.rd_dash_connect })).toBeNull();   // nothing to connect
    fireEvent.click(link);                                                               // closes the panel, as the dropdown does
    await flush();
    expect(screen.queryByTestId("lpk-panel-fb")).toBeNull();
    expect(screen.getAllByTestId(/^lpk-tile-/)).toHaveLength(4);
    expect(H.connect).not.toHaveBeenCalled();
  });

  it("with Facebook access (testers) → unchanged: the page list + Connect, same as an admin", async () => {
    H.fbAccess = true;
    await mount();
    const seller = shape(await openTile("fb"));
    expect(seller.text).toContain("Shop Page");
    expect(seller.buttons).toContain(`${t.rd_dash_connect}|false`);
    expect(seller.text).not.toContain(t.rd_dash_fb_activation);
    cleanup();
    H.role = "admin";
    await mount();
    expect(shape(await openTile("fb"))).toEqual(seller);
  });
});

describe("connected → one header button, as today", () => {
  it("TikTok live → the header button with the account; tap = today's dropdown with Disconnect", async () => {
    H.ttConnected = true;
    await mount();
    expect(screen.queryByTestId("lpk-picker")).toBeNull();
    const btn = screen.getByTestId("lpk-source-button");
    expect(btn.textContent).toContain("shop1");
    fireEvent.click(btn);
    await flush();
    expect(screen.getByRole("button", { name: t.rd_dash_disconnect })).toBeTruthy();
  });
});

describe("platform worlds can never empty the picker", () => {
  it("TikTok and Facebook chips hidden → still all 4 tiles", () => {
    const noop = () => {};
    render(
      <TProvider lang="en">
        <Dashboard
          comments={[]} cur="NT$" ttOpen={false} fbOpen={false} ttIdx={0} fbIdx={0}
          onToggleTT={noop} onToggleFB={noop} onPickTT={noop} onManageTT={noop}
          ttConnected={false} fbConnected={false} ttConnecting={false} fbConnecting={false}
          onConnectTT={noop} onRefreshTT={noop} ttAccounts={["shop1"]} fbAccounts={[]}
          printed={{}} entId={null} entPrice="" onOneClick={noop} onOpenEnt={noop} onEntPrice={noop} onEntKey={noop}
          livePicker hideTtChip hideFbChip
        />
      </TProvider>,
    );
    expect(screen.getAllByTestId(/^lpk-tile-/).map((b) => b.getAttribute("data-testid"))).toEqual(["lpk-tile-tt", "lpk-tile-fb", "lpk-tile-ig", "lpk-tile-sh"]);
    expect(tile("tt").disabled).toBe(false);
    expect(tile("fb").disabled).toBe(false);
  });
});
