// Option E — the per-platform connect modal. No account → @username + Connect; accounts
// → list with the live one (● Live) + "Use" on the rest + "＋ Add another"; Facebook →
// Telegram gate; Shopee → authorize (no shops) OR shop + session id. Every action is
// handed UP (RedesignApp routes it through the session-aware path) — the modal itself
// never connects.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import LiveConnectModal from "../LiveConnectModal";

const base = {
  onClose: vi.fn(),
  ttAccounts: [] as string[], ttLiveName: null as string | null,
  onUseTikTok: vi.fn(), onConnectTikTokNew: vi.fn(),
  shopeeShops: [] as { shopId: number; shopName: string }[], shopeeLiveId: null as number | null,
  shopeeEligible: true, onAuthorizeShopee: vi.fn(), onConnectShopee: vi.fn(), onUpsell: vi.fn(),
};
const view = (over: Partial<Parameters<typeof LiveConnectModal>[0]>) =>
  render(<TProvider><LiveConnectModal platform="TikTok" {...base} {...over} /></TProvider>);

describe("LiveConnectModal — TikTok", () => {
  it("no account → the @username Connect flow; Connect fires onConnectTikTokNew(username)", () => {
    const onConnectTikTokNew = vi.fn();
    const { getByTestId } = view({ ttAccounts: [], onConnectTikTokNew });
    fireEvent.change(getByTestId("lc-tt-input"), { target: { value: "@newshop" } }); // @ stripped
    fireEvent.click(getByTestId("lc-tt-connect"));
    expect(onConnectTikTokNew).toHaveBeenCalledWith("newshop");
  });

  it("accounts → list; the live one shows ● Live (no Use), others show Use → onUseTikTok", () => {
    const onUseTikTok = vi.fn();
    const { getAllByTestId, getByTestId, queryAllByTestId } = view({ ttAccounts: ["shop_a", "shop_b"], ttLiveName: "shop_a", onUseTikTok });
    expect(getAllByTestId("lc-tt-row")).toHaveLength(2);
    expect(getByTestId("lc-tt-live")).toBeTruthy();          // shop_a live
    const uses = queryAllByTestId("lc-tt-use");
    expect(uses).toHaveLength(1);                             // only shop_b has Use
    fireEvent.click(uses[0]);
    expect(onUseTikTok).toHaveBeenCalledWith("shop_b");
  });

  it("＋ Add another reveals the input (existing accounts present)", () => {
    const { getByTestId, queryByTestId } = view({ ttAccounts: ["shop_a"] });
    expect(queryByTestId("lc-tt-input")).toBeNull();
    fireEvent.click(getByTestId("lc-tt-add"));
    expect(getByTestId("lc-tt-input")).toBeTruthy();
  });
});

describe("LiveConnectModal — Facebook & Shopee", () => {
  it("Facebook → Telegram gate, never a connect", () => {
    const { getByTestId } = render(<TProvider><LiveConnectModal platform="Facebook" {...base} /></TProvider>);
    const a = getByTestId("lc-fb-telegram") as HTMLAnchorElement;
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toContain("t.me");
  });

  it("Shopee, no shops → Authorize; not eligible → upsell", () => {
    const onAuthorizeShopee = vi.fn(), onUpsell = vi.fn();
    const a = render(<TProvider><LiveConnectModal platform="Shopee" {...base} shopeeShops={[]} onAuthorizeShopee={onAuthorizeShopee} /></TProvider>);
    fireEvent.click(a.getByTestId("lc-shopee-authorize")); expect(onAuthorizeShopee).toHaveBeenCalled();
    const b = render(<TProvider><LiveConnectModal platform="Shopee" {...base} shopeeEligible={false} onUpsell={onUpsell} /></TProvider>);
    fireEvent.click(b.getByTestId("lc-shopee-upsell")); expect(onUpsell).toHaveBeenCalled();
  });

  it("Shopee, has shop → session id + Connect fires onConnectShopee(shopId, session)", () => {
    const onConnectShopee = vi.fn();
    const { getByTestId } = render(<TProvider><LiveConnectModal platform="Shopee" {...base} shopeeShops={[{ shopId: 77, shopName: "Shop A" }]} onConnectShopee={onConnectShopee} /></TProvider>);
    fireEvent.change(getByTestId("lc-shopee-session"), { target: { value: "sess-1" } });
    fireEvent.click(getByTestId("lc-shopee-connect"));
    expect(onConnectShopee).toHaveBeenCalledWith(77, "sess-1");
  });
});
