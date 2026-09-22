// Compact Settings → Channels list (owner-gated). One row per platform with the right
// subtitle/status; Shopee only when showShopee (TW market); Instagram disabled; tapping
// TikTok/Facebook/Shopee opens the manage modal via onOpen(platform).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import ChannelsList from "../ChannelsList";
import type { AccountUser } from "../../../accountDb";

const acct = (tiktok: string, facebook = "") =>
  ({ email: "x@y.com", plan: "pro", role: "seller", connectedAccounts: [], profile: { tiktok, facebook, fullName: "", storeName: "", phone: "", country: "" } } as unknown as AccountUser);

const view = (over: Partial<Parameters<typeof ChannelsList>[0]> = {}) =>
  render(<TProvider><ChannelsList account={acct("a\nb")} ttLive={null} showShopee onOpen={vi.fn()} {...over} /></TProvider>);

describe("ChannelsList", () => {
  it("renders all four platform rows (TikTok, Facebook, Shopee, Instagram) when TW/showShopee", () => {
    const { getByTestId } = view();
    expect(getByTestId("cl-tiktok")).toBeTruthy();
    expect(getByTestId("cl-facebook")).toBeTruthy();
    expect(getByTestId("cl-shopee")).toBeTruthy();
    expect(getByTestId("cl-instagram")).toBeTruthy();
  });

  it("hides Shopee for a non-TW/non-owner market (showShopee=false)", () => {
    const { queryByTestId } = view({ showShopee: false });
    expect(queryByTestId("cl-shopee")).toBeNull();
    expect(queryByTestId("cl-tiktok")).toBeTruthy(); // others still there
  });

  it("TikTok subtitle shows the active/first handle", () => {
    expect(view({ account: acct("a\nb"), ttLive: "b" }).getByTestId("cl-tiktok").textContent).toContain("@b");
  });

  it("TikTok empty → 'add your first account'", () => {
    expect(view({ account: acct("") }).getByTestId("cl-tiktok").textContent).toContain("Add your first account");
  });

  it("Instagram row is disabled (coming soon) and never opens", () => {
    const onOpen = vi.fn();
    const { getByTestId } = view({ onOpen });
    const ig = getByTestId("cl-instagram") as HTMLButtonElement;
    expect(ig.disabled).toBe(true);
    expect(ig.textContent).toContain("Coming soon");
    fireEvent.click(ig);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("tapping TikTok / Facebook / Shopee calls onOpen with the platform", () => {
    const onOpen = vi.fn();
    const { getByTestId } = view({ onOpen });
    fireEvent.click(getByTestId("cl-tiktok")); expect(onOpen).toHaveBeenLastCalledWith("tiktok");
    fireEvent.click(getByTestId("cl-facebook")); expect(onOpen).toHaveBeenLastCalledWith("facebook");
    fireEvent.click(getByTestId("cl-shopee")); expect(onOpen).toHaveBeenLastCalledWith("shopee");
  });
});
