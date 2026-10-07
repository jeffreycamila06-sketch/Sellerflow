// Facebook settings path: Settings → Facebook goes straight to the real Facebook pages
// screen when Facebook is on (settingsChannelScreen), and the "Manage Facebook pages"
// card shows only on the Facebook channels screen, never on the TikTok one.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import ManageChannels from "../ManageChannels";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import { settingsChannelScreen } from "../../adapters/channelRoute";

const acct: AccountUser = {
  authUserId: "u", email: "g@x.com",
  profile: { fullName: "O", storeName: "S", phone: "", tiktok: "saved_tt", facebook: "fbpage", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
const view = (platform: "tiktok" | "facebook", fbPagesEnabled: boolean, onFbPages = vi.fn()) =>
  render(<TProvider lang="en"><ManageChannels platform={platform} account={acct} onBack={() => {}}
    onSaveChannels={async () => ({ ok: true })} fbPagesEnabled={fbPagesEnabled} onFbPages={onFbPages} /></TProvider>);
const CARD = "Manage Facebook pages";

describe("settingsChannelScreen", () => {
  it("facebook + on → fbpages; facebook + off → fbchannels; tiktok → ttchannels either way", () => {
    expect(settingsChannelScreen("facebook", true)).toBe("fbpages");
    expect(settingsChannelScreen("facebook", false)).toBe("fbchannels");
    expect(settingsChannelScreen("tiktok", true)).toBe("ttchannels");
    expect(settingsChannelScreen("tiktok", false)).toBe("ttchannels");
  });
  it("RedesignApp routes the Settings row through it (Back returns to Settings)", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain('onManageChannel={(p) => { setChanBack("settings"); setScreen(settingsChannelScreen(p, fbEnabled)); }}');
  });
});

describe("Manage Facebook pages card", () => {
  it("TikTok screen: never shown, even with Facebook on", () => {
    view("tiktok", true);
    expect(screen.queryByText(CARD)).toBeNull();
  });
  it("Facebook screen: shown with Facebook on, opens the pages screen", () => {
    const onFbPages = vi.fn();
    view("facebook", true, onFbPages);
    fireEvent.click(screen.getByText(CARD));
    expect(onFbPages).toHaveBeenCalledTimes(1);
  });
  it("Facebook off: neither screen shows it", () => {
    view("tiktok", false);
    expect(screen.queryByText(CARD)).toBeNull();
    view("facebook", false);
    expect(screen.queryByText(CARD)).toBeNull();
  });
});
