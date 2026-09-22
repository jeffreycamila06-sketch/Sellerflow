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
  onUseTikTok: vi.fn(), onManage: vi.fn(), onSelectTikTok: vi.fn(), onDisconnect: vi.fn(), onRefresh: vi.fn(),
  shopeeShops: [] as { shopId: number; shopName: string }[], shopeeLiveId: null as number | null,
  shopeeEligible: true, onAuthorizeShopee: vi.fn(), onConnectShopee: vi.fn(), onUpsell: vi.fn(),
};
const view = (over: Partial<Parameters<typeof LiveConnectModal>[0]>) =>
  render(<TProvider><LiveConnectModal platform="TikTok" {...base} {...over} /></TProvider>);

describe("LiveConnectModal — TikTok (connect mode)", () => {
  it("no inline add field — the add path is a 'Manage / add accounts' link (one place to add/edit)", () => {
    const { getByTestId, queryByTestId } = view({ ttAccounts: [] });
    expect(queryByTestId("lc-tt-input")).toBeNull();   // NO inline @username field
    expect(queryByTestId("lc-tt-add")).toBeNull();     // NO inline "add another" reveal
    expect(getByTestId("lc-tt-manage")).toBeTruthy();  // the Manage / add accounts link
  });

  it("accounts → list; the live one shows ● Live (no Use), others show Use → onUseTikTok (session-safe)", () => {
    const onUseTikTok = vi.fn();
    const { getAllByTestId, getByTestId, queryAllByTestId } = view({ ttAccounts: ["shop_a", "shop_b"], ttLiveName: "shop_a", onUseTikTok });
    expect(getAllByTestId("lc-tt-row")).toHaveLength(2);
    expect(getByTestId("lc-tt-live")).toBeTruthy();          // shop_a live
    const uses = queryAllByTestId("lc-tt-use");
    expect(uses).toHaveLength(1);                             // only shop_b has Use
    fireEvent.click(uses[0]);
    expect(onUseTikTok).toHaveBeenCalledWith("shop_b");       // Use routes through the session-aware path (RedesignApp)
  });

  it("tapping 'Manage / add accounts' calls onManage (navigate to manage) and does NOT connect", () => {
    const onManage = vi.fn(); const onUseTikTok = vi.fn();
    const { getByTestId } = view({ ttAccounts: ["shop_a"], onManage, onUseTikTok });
    fireEvent.click(getByTestId("lc-tt-manage"));
    expect(onManage).toHaveBeenCalledTimes(1);
    expect(onUseTikTok).not.toHaveBeenCalled();               // pure navigation — never a connect/go-live
  });

  it("REGRESSION — the LIVE account shows Disconnect → onDisconnect (client-local), no connect", () => {
    const onDisconnect = vi.fn(); const onUseTikTok = vi.fn();
    const { getByTestId, queryAllByTestId } = view({ ttAccounts: ["shop_a", "shop_b"], ttLiveName: "shop_a", onDisconnect, onUseTikTok });
    expect(getByTestId("lc-tt-disconnect")).toBeTruthy();     // was MISSING before
    fireEvent.click(getByTestId("lc-tt-disconnect"));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    // the live account has no Use; only the other one does
    expect(queryAllByTestId("lc-tt-use")).toHaveLength(1);
    expect(onUseTikTok).not.toHaveBeenCalled();
  });

  it("REGRESSION — tapping a row SELECTS (onSelectTikTok) without connecting; ✓ marks the selected", () => {
    const onSelectTikTok = vi.fn(); const onUseTikTok = vi.fn();
    const { getAllByTestId, getByTestId } = view({ ttAccounts: ["shop_a", "shop_b"], ttSelected: "shop_a", onSelectTikTok, onUseTikTok });
    const selects = getAllByTestId("lc-tt-select");
    fireEvent.click(selects[1]);                              // tap shop_b's row
    expect(onSelectTikTok).toHaveBeenCalledWith("shop_b");
    expect(onUseTikTok).not.toHaveBeenCalled();               // select-only, no connect
    expect(getByTestId("lc-tt-selected")).toBeTruthy();       // ✓ on the selected (shop_a)
  });

  it("REGRESSION — Refresh button → onRefresh", () => {
    const onRefresh = vi.fn();
    const { getByTestId } = view({ ttAccounts: ["shop_a"], onRefresh });
    fireEvent.click(getByTestId("lc-tt-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
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

  it("Option B — at the plan cap: exactly N slots (all filled, no empty inputs) + the Multi-Account button opens the Telegram popup", () => {
    const { getAllByTestId, queryAllByTestId, getByTestId } = render(
      <TProvider><LiveConnectModal platform="TikTok" {...base} mode="manage" account={acct("a\nb", "", "plus")} onSaveChannels={vi.fn()} /></TProvider>);
    expect(getAllByTestId("cm-row")).toHaveLength(2);        // Plus = exactly 2 slots (no teaser)
    expect(queryAllByTestId("cm-empty")).toHaveLength(0);    // both filled → no empty input
    fireEvent.click(getByTestId("cm-multi"));                // "Add — Multi Account" (all plans)
    const ok = getByTestId("cm-multi-ok") as HTMLAnchorElement;
    expect(ok.tagName).toBe("A");
    expect(ok.getAttribute("href")).toContain("t.me");       // popup OK → Telegram
  });

  it("Option B — under cap: empty slots are directly-typeable (no reveal button)", () => {
    const { getAllByTestId, queryByTestId } = render(
      <TProvider><LiveConnectModal platform="TikTok" {...base} mode="manage" account={acct("a", "", "master")} onSaveChannels={vi.fn()} /></TProvider>);
    expect(getAllByTestId("cm-row")).toHaveLength(5);        // Master = 5 slots
    expect(getAllByTestId("cm-empty")).toHaveLength(4);      // 1 saved + 4 directly-typeable empties
    expect(queryByTestId("cm-add")).toBeNull();              // no progressive-reveal button
  });

  it("Option B — type in an empty slot → Save → adds it + closes (onSaved)", async () => {
    const onSaveChannels = vi.fn().mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    const { getAllByTestId, getByTestId } = render(
      <TProvider><LiveConnectModal platform="TikTok" {...base} mode="manage" account={acct("a", "", "master")} onSaveChannels={onSaveChannels} onClose={onSaved} /></TProvider>);
    fireEvent.change(getAllByTestId("cm-empty")[0], { target: { value: "newacct" } });
    fireEvent.click(getByTestId("cm-save"));
    await waitFor(() => expect(onSaveChannels).toHaveBeenCalled());
    expect(onSaveChannels.mock.calls[0][0].tiktok).toContain("newacct"); // the added handle
    await waitFor(() => expect(onSaved).toHaveBeenCalled());             // success → modal closes
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
