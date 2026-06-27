// Manage [Platform] channels (surface C). Verifies: plan-capped rows, saved row
// locked, Save passes the edited platform list + the OTHER platform's saved value
// through unchanged (so composeChannelSave's combined-cap/locked guards still apply),
// and the "Add — Multi Account" Telegram popup.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ManageChannels from "../ManageChannels";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";

const acct: AccountUser = {
  authUserId: "u", email: "g@x.com",
  profile: { fullName: "O", storeName: "S", phone: "", tiktok: "saved_tt", facebook: "fbpage", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};

describe("ManageChannels (surface C)", () => {
  it("pro shows the saved account locked + Save passes edited tiktok and unchanged facebook", async () => {
    const onSaveChannels = vi.fn().mockResolvedValue({ ok: true });
    render(<TProvider lang="en"><ManageChannels platform="tiktok" account={acct} onBack={() => {}} onSaveChannels={onSaveChannels} /></TProvider>);
    // saved account → locked (disabled input + LOCKED badge)
    expect(screen.getByText("LOCKED")).toBeTruthy();
    const savedInput = screen.getByDisplayValue("saved_tt") as HTMLInputElement;
    expect(savedInput.disabled).toBe(true);
    // type into an empty editable row, then Save
    const editable = (screen.getAllByPlaceholderText("yourusername") as HTMLInputElement[]).filter((el) => !el.disabled);
    expect(editable.length).toBeGreaterThan(0);
    fireEvent.change(editable[0], { target: { value: "newone" } });
    fireEvent.click(screen.getByText("Save profile"));
    await waitFor(() => expect(onSaveChannels).toHaveBeenCalledTimes(1));
    const arg = onSaveChannels.mock.calls[0][0];
    expect(arg.facebook).toBe("fbpage");        // other platform passed through unchanged
    expect(arg.tiktok).toContain("saved_tt");   // locked account preserved
    expect(arg.tiktok).toContain("newone");     // new typed account included
  });

  it("Add — Multi Account opens the Telegram popup (@sellerflowlive1995 + OK link)", () => {
    render(<TProvider lang="en"><ManageChannels platform="tiktok" account={acct} onBack={() => {}} onSaveChannels={async () => ({ ok: true })} /></TProvider>);
    fireEvent.click(screen.getByText("Add TikTok — Multi Account"));
    expect(screen.getByText("@sellerflowlive1995")).toBeTruthy();
    const ok = screen.getByText("OK").closest("a") as HTMLAnchorElement;
    expect(ok.getAttribute("href")).toBe("https://t.me/sellerflowlive1995");
  });
});
