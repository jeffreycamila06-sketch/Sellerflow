// "Invite friends" share card — visibility + share/copy-fallback behavior.
// Verifies: card renders (all tiers), native share sheet is used when available
// (no inline "copied" then), and desktop falls back to clipboard + shows "Link
// copied". Also guards the iOS 3.1.1-safety of the share copy (no pricing words).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import InviteFriendsCard from "../InviteFriendsCard";
import { INVITE_URL } from "../inviteShare";
import { TProvider } from "../../i18n";

const renderCard = (lang = "en") =>
  render(
    <TProvider lang={lang}>
      <InviteFriendsCard />
    </TProvider>,
  );

afterEach(() => {
  // reset any share/clipboard stubs between tests
  delete (navigator as unknown as { share?: unknown }).share;
});

describe("InviteFriendsCard", () => {
  it("renders the card for every user (no gating)", () => {
    renderCard();
    expect(screen.getByText("Invite friends")).toBeTruthy();
    expect(screen.getByText(/Share SellerFlowLive with other live sellers/)).toBeTruthy();
  });

  it("uses the native share sheet when available (message + landing URL, no inline copied)", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
    renderCard();
    fireEvent.click(screen.getByText("Invite friends"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const arg = share.mock.calls[0][0];
    expect(arg.url).toBe(INVITE_URL);
    expect(arg.text).toMatch(/SellerFlowLive/);
    // the share sheet handled it → no inline "Link copied" confirmation
    expect(screen.queryByText("Link copied")).toBeNull();
  });

  it("falls back to clipboard copy on desktop (no navigator.share) and confirms", async () => {
    delete (navigator as unknown as { share?: unknown }).share;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
    renderCard();
    fireEvent.click(screen.getByText("Invite friends"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain(INVITE_URL);        // link included
    expect(copied).toMatch(/SellerFlowLive/);    // message included
    expect(await screen.findByText("Link copied")).toBeTruthy();
  });

  it("share copy stays iOS 3.1.1-safe (no pricing/subscription wording)", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
    renderCard();
    fireEvent.click(screen.getByText("Invite friends"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const { text, url } = share.mock.calls[0][0] as { text: string; url: string };
    const payload = `${text} ${url}`.toLowerCase();
    for (const bad of ["price", "subscribe", "subscription", "$", "plan", "upgrade", "free", "pay"]) {
      expect(payload.includes(bad)).toBe(false);
    }
  });
});
