// SHOPEE LIVE — Phase 3 UI gate + surface tests. When the flag is OFF (or no
// authorized shop) there is ZERO Shopee UI: no Dashboard chip, no ConnectModal tab,
// no ManageChannels section. When ON: the chip/tab/section render and wire their
// handlers, and ShopeeChannels enforces the plan cap + active-paid eligibility.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Dashboard from "../Dashboard";
import ConnectModal from "../ConnectModal";
import ManageChannels from "../ManageChannels";
import ShopeeChannels from "../ShopeeChannels";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";

// ShopeeChannels hits the network on mount (auth URL) + on remove → stub those two,
// keep the real isShopeeEligible (a pure active-paid gate).
vi.mock("../../adapters/shopee", async (orig) => ({
  ...(await orig<typeof import("../../adapters/shopee")>()),
  startShopeeAuth: vi.fn(async () => ({ ok: true, url: "https://partner.shopee/auth?x=1" })),
  removeShopeeShop: vi.fn(async () => ({ ok: true })),
}));

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const noop = () => {};
const dashBase = {
  comments: [], cur: "NT$",
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onRefreshTT: noop,
  ttAccounts: ["maria_shops"], fbAccounts: [] as string[],
  printed: {}, entId: null, entPrice: "", onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
const renderDash = (over: Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><Dashboard {...dashBase} {...over} /></TProvider>);

const account: AccountUser = {
  email: "seller@example.com",
  profile: { fullName: "S", storeName: "Shop", phone: "0912345678", tiktok: "my_tt", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "2027-01-01", connectedAccounts: [],
};

describe("Shopee UI gate — Dashboard source chip", () => {
  it("flag OFF → NO Shopee chip", () => {
    renderDash({ shopeeEnabled: false, shopeeShops: [{ shopId: 555, shopName: "My Shop" }], shopeeOpen: true });
    expect(screen.queryByText("My Shop")).toBeNull();
  });
  it("flag ON but zero shops → NO Shopee chip", () => {
    renderDash({ shopeeEnabled: true, shopeeShops: [], shopeeOpen: true });
    expect(screen.queryByText("Shopee shops")).toBeNull();
  });
  it("flag ON + ≥1 shop → chip + dropdown (shop row, Connect, Manage)", () => {
    const onConnectShopee = vi.fn(), onManageShopee = vi.fn(), onPickShopee = vi.fn();
    renderDash({ shopeeEnabled: true, shopeeShops: [{ shopId: 555, shopName: "My Shop" }], shopeeOpen: true, onConnectShopee, onManageShopee, onPickShopee });
    expect(screen.getAllByText("My Shop").length).toBeGreaterThan(0); // chip label + dropdown row
    fireEvent.click(screen.getByText("Connect"));   // only Shopee dropdown is open → unambiguous
    expect(onConnectShopee).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Manage Shopee shops"));
    expect(onManageShopee).toHaveBeenCalled();
  });
  it("connected → chip footer shows Disconnect", () => {
    renderDash({ shopeeEnabled: true, shopeeShops: [{ shopId: 555, shopName: "My Shop" }], shopeeOpen: true, shopeeConnected: true });
    expect(screen.getByText("Disconnect")).toBeTruthy();
  });
});

describe("Shopee UI gate — ConnectModal tab", () => {
  const renderModal = (over: Record<string, unknown> = {}) =>
    render(<TProvider lang="en"><ConnectModal profile={account} onClose={noop} onConnect={vi.fn(async () => ({ ok: true, account: "" }))} {...over} /></TProvider>);

  it("shopeeEnabled=false → NO Shopee tab", () => {
    renderModal({ shopeeEnabled: false });
    expect(screen.queryByRole("button", { name: "Shopee" })).toBeNull();
  });
  it("shopeeEnabled=true → Shopee tab present; selecting it shows the session-ID input + Connect calls onShopeeConnect", async () => {
    const onShopeeConnect = vi.fn(async () => ({ ok: true }));
    renderModal({ shopeeEnabled: true, shopeeShops: [{ shopId: 555, shopName: "My Shop" }], initialTab: "Shopee", onShopeeConnect });
    const input = screen.getByPlaceholderText("Paste your Shopee Live session ID") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "S9" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onShopeeConnect).toHaveBeenCalledWith(555, "S9");
  });
  it("not_live result → shows the not-live error inline", async () => {
    const onShopeeConnect = vi.fn(async () => ({ ok: false, reason: "not_live" }));
    renderModal({ shopeeEnabled: true, shopeeShops: [{ shopId: 555, shopName: "My Shop" }], initialTab: "Shopee", onShopeeConnect });
    fireEvent.change(screen.getByPlaceholderText("Paste your Shopee Live session ID"), { target: { value: "S9" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText(/Couldn't start/)).toBeTruthy();
  });
});

describe("Shopee UI gate — ManageChannels section", () => {
  it("flag OFF → NO Shopee section", () => {
    render(<TProvider lang="en"><ManageChannels platform="tiktok" account={account} onBack={noop} shopeeEnabled={false} onShopee={vi.fn()} /></TProvider>);
    expect(screen.queryByText("Shopee shops")).toBeNull();
  });
  it("flag ON → Shopee section renders + navigates", () => {
    const onShopee = vi.fn();
    render(<TProvider lang="en"><ManageChannels platform="tiktok" account={account} onBack={noop} shopeeEnabled={true} onShopee={onShopee} /></TProvider>);
    fireEvent.click(screen.getByText("Shopee shops"));
    expect(onShopee).toHaveBeenCalled();
  });
});

describe("ShopeeChannels — cap + eligibility", () => {
  const renderSC = (over: Record<string, unknown> = {}) =>
    render(<TProvider lang="en"><ShopeeChannels account={account} shops={[]} onReload={vi.fn()} onBack={noop} onUpsell={noop} {...over} /></TProvider>);

  it("lists shops + a Remove per shop", () => {
    renderSC({ shops: [{ id: "r1", shopId: 555, shopName: "My Shop", active: true }] });
    expect(screen.getByText("My Shop")).toBeTruthy();
    expect(screen.getByText("Remove")).toBeTruthy();
  });
  it("at plan cap (pro=3) → cap message shown", () => {
    renderSC({ shops: [1, 2, 3].map((n) => ({ id: `r${n}`, shopId: n, shopName: `S${n}`, active: true })) });
    expect(screen.getByText(/account limit/)).toBeTruthy();
  });
  it("under cap + eligible → Authorize is a real anchor to the signed URL", async () => {
    renderSC({ shops: [] });
    const a = await screen.findByText("Authorize Shopee shop");
    expect((a as HTMLAnchorElement).getAttribute("href")).toBe("https://partner.shopee/auth?x=1");
  });
  it("not eligible (free plan) → Authorize is a button that routes to the upsell (no anchor)", () => {
    const onUpsell = vi.fn();
    const freeAcct = { ...account, plan: "free", planStatus: "active" };
    renderSC({ account: freeAcct, shops: [], onUpsell });
    const btn = screen.getByText("Authorize Shopee shop");
    expect(btn.tagName).toBe("BUTTON");
    fireEvent.click(btn);
    expect(onUpsell).toHaveBeenCalled();
  });
});
