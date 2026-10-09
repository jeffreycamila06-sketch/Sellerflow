// Build 16 — Shipping is "Coming soon" for sellers (display / gating only).
// Every entry point to the Shipping screen:
//   1. Settings → the Shipping tile          (SettingsHub onShipping)
//   2. Orders  → the 🚚 Shipping header button (Orders onGoShipping)
// For a NON-admin seller both show "Coming soon" (the Live picker's look: dimmed + the words) and
// never open the screen; the screen itself also only renders for "open". Admins open it as before.
// A market without 7-11 shipping hides both (unchanged). Shipping data / export / build11 untouched.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, act, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { buildT, TProvider } from "../i18n";
import { shippingAccess } from "../adapters/shippingGate";
import SettingsHub from "../screens/SettingsHub";
import Orders from "../screens/Orders";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({ role: "seller" }));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "seller@x.com", plan: "pro", planStatus: "active", planExpiry: "", role: H.role, connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "", country: "TW" },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));
vi.mock("../adapters/useLiveFeed", async (orig) => ({
  ...(await orig() as object),
  useLiveFeed: () => ({
    comments: [], connected: false, canInject: false, injectSynthetic: () => {}, getComment: () => undefined,
    activeAccounts: { TikTok: "", Facebook: "" }, ttConnected: false, fbConnected: false, shopeeConnected: false, igConnected: false,
    connect: vi.fn(async () => ({ ok: true, account: "shop1" })),
  }),
}));
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: "2026-10-09",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {},
  }),
}));

import RedesignApp from "../RedesignApp";

const t = buildT("en");
const noop = () => {};
const nav = (label: string) => { fireEvent.click(screen.getAllByText(label).find((el) => el.closest("button"))!.closest("button")!); };
// The Shipping screen always shows its fee line (shp-global-fee); nothing else does.
const shippingScreenOpen = () => !!screen.queryByTestId("shp-global-fee");

beforeEach(() => { localStorage.clear(); H.role = "seller"; });

describe("the rule", () => {
  it("admin → open; other seller → soon; market without shipping → hidden (for everyone)", () => {
    expect(shippingAccess(true, false)).toBe("open");
    expect(shippingAccess(false, false)).toBe("soon");
    expect(shippingAccess(false, true)).toBe("hidden");
    expect(shippingAccess(true, true)).toBe("hidden");
  });
});

describe("entry point 1 — Settings → Shipping tile", () => {
  const hub = (over: Record<string, unknown>) => render(
    <TProvider lang="en">
      <SettingsHub onGeneral={noop} onCustomers={noop} onAdmin={noop} onCustomerData={noop} onLegal={noop} onDelete={noop} onLogout={noop} {...over} />
    </TProvider>,
  );

  it("seller: \"Coming soon\", dimmed, not tappable", () => {
    hub({ shippingSoon: true });
    const tile = screen.getByTestId("tile-shipping-soon") as HTMLButtonElement;
    expect(within(tile).getByText(t.rd_sh_shipping)).toBeTruthy();
    expect(within(tile).getByText(t.rd_ls_soon)).toBeTruthy();
    expect(t.rd_ls_soon).toBe("Coming soon");
    expect(tile.disabled).toBe(true);
    expect(tile.style.opacity).toBe("0.5");
    expect(screen.queryByTestId("tile-shipping")).toBeNull();
  });

  it("admin: the normal tile, tap opens Shipping", () => {
    const onShipping = vi.fn();
    hub({ onShipping });
    fireEvent.click(screen.getByTestId("tile-shipping"));
    expect(onShipping).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("tile-shipping-soon")).toBeNull();
  });

  it("market without shipping: no tile at all (unchanged)", () => {
    hub({});
    expect(screen.queryByTestId("tile-shipping")).toBeNull();
    expect(screen.queryByTestId("tile-shipping-soon")).toBeNull();
  });

  it("the other tiles are unchanged (Parcel Scan still opens)", () => {
    const onParcelScan = vi.fn(), onGeneral = vi.fn();
    hub({ shippingSoon: true, onParcelScan, onGeneral });
    fireEvent.click(screen.getByTestId("tile-parcelscan"));
    fireEvent.click(screen.getByText(t.rd_sh_general).closest("button")!);
    expect(onParcelScan).toHaveBeenCalledTimes(1);
    expect(onGeneral).toHaveBeenCalledTimes(1);
  });
});

describe("entry point 2 — Orders → 🚚 Shipping button", () => {
  const orders = (over: Record<string, unknown>) => render(<TProvider lang="en"><Orders onGoPrint={noop} cur="NT$" orders={[]} state="live" {...over} /></TProvider>);

  it("seller: \"Coming soon\", dimmed, not tappable", () => {
    orders({ shippingSoon: true });
    const b = screen.getByTestId("ord-shipping-soon") as HTMLButtonElement;
    expect(b.textContent).toContain(t.rd_sh_shipping);
    expect(b.textContent).toContain(t.rd_ls_soon);
    expect(b.disabled).toBe(true);
    expect(b.style.opacity).toBe("0.5");
    expect(screen.queryByTestId("ord-shipping")).toBeNull();
  });

  it("admin: the normal button, tap opens Shipping", () => {
    const onGoShipping = vi.fn();
    orders({ onGoShipping });
    fireEvent.click(screen.getByTestId("ord-shipping"));
    expect(onGoShipping).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("ord-shipping-soon")).toBeNull();
  });
});

describe("the real app (Taiwan seller)", () => {
  it("seller: Settings tile and Orders button both say \"Coming soon\"; tapping them never opens Shipping", async () => {
    render(<RedesignApp />);
    await flush();
    nav(t.rd_nav_settings);
    await flush();
    const tile = screen.getByTestId("tile-shipping-soon");
    fireEvent.click(tile);
    await flush();
    expect(screen.getByTestId("tile-shipping-soon")).toBeTruthy();       // still on Settings
    expect(shippingScreenOpen()).toBe(false);
    nav(t.rd_nav_orders);
    await flush();
    fireEvent.click(screen.getByTestId("ord-shipping-soon"));
    await flush();
    expect(screen.getByTestId("ord-shipping-soon")).toBeTruthy();         // still on Orders
    expect(shippingScreenOpen()).toBe(false);
  });

  it("admin: the Settings tile opens Shipping, and so does the Orders button", async () => {
    H.role = "admin";
    render(<RedesignApp />);
    await flush();
    nav(t.rd_nav_settings);
    await flush();
    fireEvent.click(screen.getByTestId("tile-shipping"));
    await flush();
    expect(screen.queryByTestId("tile-shipping")).toBeNull();             // left Settings
    expect(shippingScreenOpen()).toBe(true);
    nav(t.rd_nav_orders);
    await flush();
    fireEvent.click(screen.getByTestId("ord-shipping"));
    await flush();
    expect(shippingScreenOpen()).toBe(true);
  });

  it("the Shipping screen itself only renders for \"open\" (and both entry points use the same rule)", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("const shippingGate = shippingAccess(isAdmin, hideShipping);");
    expect(src).toContain('{screen === "shipping" && shippingGate === "open" && <Shipping ');
    expect(src).toContain('onGoShipping={shippingGate === "open" ? () => setScreen("shipping") : undefined} shippingSoon={shippingGate === "soon"}');
    expect(src).toContain('onShipping={shippingGate === "open" ? () => setScreen("shipping") : undefined}');
    expect(src.match(/setScreen\("shipping"\)/g)).toHaveLength(2);       // no other way in
  });
});
