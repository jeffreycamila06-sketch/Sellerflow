// Option E — the per-platform connect modal. No account → @username + Connect; accounts
// → list with the live one (● Live) + "Use" on the rest + "＋ Add another"; Facebook →
// Telegram gate; Shopee → authorize (no shops) OR shop + session id. Every action is
// handed UP (RedesignApp routes it through the session-aware path) — the modal itself
// never connects.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import LiveConnectModal from "../LiveConnectModal";
import type { AccountUser } from "../../../accountDb";

const acct = (tiktok: string, facebook = "", plan = "pro", role = "seller") =>
  ({ email: "x@y.com", plan, role, connectedAccounts: [], profile: { tiktok, facebook, fullName: "", storeName: "", phone: "", country: "" } } as unknown as AccountUser);

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

// MANAGE mode (Settings → Channels): edit/register accounts, NEVER connect. No supabase
// in the test env → fetchSlotCooldowns returns null → saved slots FAIL CLOSED (locked),
// which is exactly the pre-cooldown behavior we assert against.
describe("LiveConnectModal — manage mode", () => {
  it("TikTok → renders ALL registered accounts (stale-fix reflects the profile), no Connect UI, header = Manage", () => {
    const { getAllByTestId, queryByTestId, getByTestId, baseElement } = render(
      <TProvider><LiveConnectModal platform="TikTok" {...base} mode="manage" account={acct("a\nb\nc")} onSaveChannels={vi.fn()} /></TProvider>);
    expect(getByTestId("cm-body")).toBeTruthy();
    expect(getAllByTestId("cm-row")).toHaveLength(3);          // all 3 accounts shown
    expect(queryByTestId("lc-tt-connect")).toBeNull();          // connect flow NOT rendered
    expect(queryByTestId("lc-tt-input")).toBeNull();
    expect(baseElement.textContent).toContain("Manage");        // header prefix, not "Connect" (modal is portaled)
  });

  it("Bug 1 / locked-agad — saved slots are LOCKED (non-editable, 🔒) when cooldowns are unknown (fail-closed); no Change; ● Live still shows", () => {
    const { getByTestId, getAllByTestId, queryByTestId } = render(
      <TProvider><LiveConnectModal platform="TikTok" {...base} mode="manage" ttLiveName="a" account={acct("a\nb")} onSaveChannels={vi.fn()} /></TProvider>);
    expect(getByTestId("cm-live")).toBeTruthy();                 // "a" is live
    expect(getAllByTestId("cm-locked").length).toBeGreaterThan(0); // fail-closed 🔒 lock badge
    expect(queryByTestId("cm-edit")).toBeNull();                 // NOT freely editable when locked
    expect(queryByTestId("cm-change")).toBeNull();               // fail-closed → NO self-service Change (can't verify cooldown)
  });

  it("Bug 2 — at the plan cap the Add row stays VISIBLE as a disabled upgrade hook (not hidden)", () => {
    const { getByTestId, queryByTestId } = render(
      <TProvider><LiveConnectModal platform="TikTok" {...base} mode="manage" account={acct("a\nb", "", "plus")} onSaveChannels={vi.fn()} /></TProvider>);
    // plus cap 2, 2 saved → at cap: the cap hint shows, the add flow does NOT.
    expect(getByTestId("cm-cap")).toBeTruthy();
    expect(queryByTestId("cm-add")).toBeNull();
    expect(queryByTestId("cm-add-input")).toBeNull();
  });

  it("TikTok with room under the cap → an Add-another input to register a new account", () => {
    const { getByTestId } = render(
      <TProvider><LiveConnectModal platform="TikTok" {...base} mode="manage" account={acct("a", "", "master")} onSaveChannels={vi.fn()} /></TProvider>);
    // master cap 5, 1 saved → the add flow is available.
    expect(getByTestId("cm-add")).toBeTruthy();
    fireEvent.click(getByTestId("cm-add"));
    expect(getByTestId("cm-add-input")).toBeTruthy();
  });

  it("Bug 3 — a SUCCESSFUL save closes the modal (calls onSaved)", async () => {
    const onSaveChannels = vi.fn().mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    // Render ChannelManageBody through the modal; onSaved is wired to onClose in prod.
    const { getByTestId } = render(
      <TProvider><LiveConnectModal platform="TikTok" {...base} mode="manage" account={acct("a", "", "master")} onSaveChannels={onSaveChannels} onClose={onSaved} /></TProvider>);
    fireEvent.click(getByTestId("cm-add"));
    fireEvent.change(getByTestId("cm-add-input"), { target: { value: "newacct" } });
    fireEvent.click(getByTestId("cm-save"));
    await waitFor(() => expect(onSaveChannels).toHaveBeenCalled());
    await waitFor(() => expect(onSaved).toHaveBeenCalled()); // success → modal closes
  });

  it("Shopee → shop list + Authorize another (no session/connect UI)", () => {
    const onAuthorizeShopee = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <TProvider><LiveConnectModal platform="Shopee" {...base} mode="manage" shopeeShops={[{ shopId: 5, shopName: "MyShop" }]} shopeeLiveId={5} onAuthorizeShopee={onAuthorizeShopee} /></TProvider>);
    expect(getByTestId("cm-shopee-row")).toBeTruthy();
    expect(getByTestId("cm-shopee-live")).toBeTruthy();
    expect(queryByTestId("lc-shopee-session")).toBeNull();      // no connect in manage mode
    fireEvent.click(getByTestId("cm-shopee-authorize"));
    expect(onAuthorizeShopee).toHaveBeenCalled();
  });

  it("Instagram → coming soon", () => {
    const { getByTestId } = render(<TProvider><LiveConnectModal platform="Instagram" {...base} mode="manage" /></TProvider>);
    expect(getByTestId("cm-soon")).toBeTruthy();
  });
});
