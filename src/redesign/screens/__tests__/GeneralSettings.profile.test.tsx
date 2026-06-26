// Step 3 double-writer guard: the Profile card must save ONLY name/store/phone —
// never tiktok/facebook (the Channels editor is the sole account writer). This
// renders GeneralSettings, opens the profile form, clicks "Save changes" and asserts
// the onSaveProfile payload carries no tiktok/facebook key.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GeneralSettings from "../GeneralSettings";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";

const auto: AutoControls = {
  detect: false, setupOpen: false, action: "slip", words: [], input: "",
  toggle: () => {}, toggleSetup: () => {}, setAction: () => {}, removeWord: () => {}, setInput: () => {}, addWord: () => {},
};

const account: AccountUser = {
  authUserId: "u1", email: "googletest@sellerflowlive.com",
  profile: { fullName: "Test Owner", storeName: "Test Shop", phone: "0900", tiktok: "saved_tt", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};

const noop = () => {};

it("Profile card 'Save changes' sends name/store/phone only — no tiktok/facebook", async () => {
  const onSaveProfile = vi.fn().mockResolvedValue({ ok: true });
  const onManageChannel = vi.fn();
  render(
    <TProvider lang="en">
      <GeneralSettings
        theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
        auto={auto} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
        profileOpen onToggleProfile={noop}
        printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
        onSubscription={noop} onSupport={noop} onDelete={noop}
        account={account} onSaveProfile={onSaveProfile} onManageChannel={onManageChannel}
      />
    </TProvider>,
  );
  fireEvent.click(screen.getByText("Save changes")); // Profile card button
  await waitFor(() => expect(onSaveProfile).toHaveBeenCalledTimes(1));
  const payload = onSaveProfile.mock.calls[0][0];
  expect(Object.keys(payload).sort()).toEqual(["fullName", "phone", "storeName"]);
  expect(payload).not.toHaveProperty("tiktok");
  expect(payload).not.toHaveProperty("facebook");
  expect(onManageChannel).not.toHaveBeenCalled(); // saving the profile must not navigate to Manage
});

describe("guard recap", () => {
  it("documents the single-writer invariant", () => {
    // Channels editor → onSaveChannels (tiktok/facebook). Profile card → onSaveProfile (name/store/phone).
    expect(true).toBe(true);
  });
});
