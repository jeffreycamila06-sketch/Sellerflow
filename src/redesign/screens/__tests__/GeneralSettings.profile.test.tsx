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

const auto: AutoControls = { detect: false, setupOpen: false, toggle: () => {}, toggleSetup: () => {} }; // F-batch: trimmed shape

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

// ── Profile-edit phone validation — the THIRD path (Jeff saw invalid accepted in
// Settings). SAME single-source validateTaiwanPhone as signup, but GRANDFATHER:
// validate only when the phone is CHANGED. BEHAVIORAL — drives the real Save button.
function renderSettings(over: { phone?: string } = {}) {
  const onSaveProfile = vi.fn().mockResolvedValue({ ok: true });
  const acct: AccountUser = { ...account, profile: { ...account.profile, phone: over.phone ?? account.profile.phone } };
  render(
    <TProvider lang="en">
      <GeneralSettings
        theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
        auto={auto} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
        profileOpen onToggleProfile={noop}
        printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
        onSubscription={noop} onSupport={noop} onDelete={noop}
        account={acct} onSaveProfile={onSaveProfile} onManageChannel={noop}
      />
    </TProvider>,
  );
  const phoneInput = () => screen.getByDisplayValue(acct.profile.phone) as HTMLInputElement;
  const save = () => fireEvent.click(screen.getByText("Save changes"));
  return { onSaveProfile, phoneInput, save };
}

describe("Profile edit — phone validation (single-source, grandfathered)", () => {
  it("changing the phone to an INVALID value blocks the save (onSaveProfile NOT called)", async () => {
    const s = renderSettings({ phone: "0912345678" });        // starts valid
    fireEvent.change(s.phoneInput(), { target: { value: "1234567890" } }); // Jeff's exact input
    s.save();
    await waitFor(() => expect(screen.getByText(/valid Taiwan mobile/i)).toBeTruthy());
    expect(s.onSaveProfile).not.toHaveBeenCalled();           // no write
  });

  it("changing the phone to a VALID value saves it NORMALIZED", async () => {
    const s = renderSettings({ phone: "0912345678" });
    fireEvent.change(s.phoneInput(), { target: { value: "0955 123 456" } });
    s.save();
    await waitFor(() => expect(s.onSaveProfile).toHaveBeenCalledTimes(1));
    expect(s.onSaveProfile.mock.calls[0][0].phone).toBe("0955123456"); // clean digits
  });

  it("GRANDFATHER: an UNCHANGED malformed stored phone still saves (edit other fields freely)", async () => {
    const s = renderSettings({ phone: "0900" });              // grandfathered bad data
    s.save();                                                  // phone untouched
    await waitFor(() => expect(s.onSaveProfile).toHaveBeenCalledTimes(1));
    expect(s.onSaveProfile.mock.calls[0][0].phone).toBe("0900"); // kept as-is, not blocked
  });
});

describe("guard recap", () => {
  it("documents the single-writer invariant", () => {
    // Channels editor → onSaveChannels (tiktok/facebook). Profile card → onSaveProfile (name/store/phone).
    expect(true).toBe(true);
  });
});
