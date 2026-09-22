// Self-service username cooldown behavior in ManageChannels. The pure lock helpers stay
// REAL (importActual); only the two server RPCs (fetchSlotCooldowns / touchSlot) are
// mocked so we drive cooling / unlocked / race / fail-closed deterministically.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ManageChannels from "../ManageChannels";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";

const fetchMock = vi.fn();
const touchMock = vi.fn();
vi.mock("../../adapters/tiktokCooldown", async (importActual) => {
  const actual = await importActual<typeof import("../../adapters/tiktokCooldown")>();
  return { ...actual, fetchSlotCooldowns: (...a: unknown[]) => fetchMock(...a), touchSlot: (...a: unknown[]) => touchMock(...a) };
});

const acct = (role = "seller"): AccountUser => ({
  authUserId: "u", email: "g@x.com",
  profile: { fullName: "O", storeName: "S", phone: "", tiktok: "saved_tt", facebook: "fbpage", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role,
});

const H = 60 * 60 * 1000;
const renderC = (account: AccountUser, onSave = vi.fn().mockResolvedValue({ ok: true })) => {
  render(<TProvider lang="en"><ManageChannels platform="tiktok" account={account} onBack={() => {}} onSaveChannels={onSave} /></TProvider>);
  return { onSave };
};

beforeEach(() => { fetchMock.mockReset(); touchMock.mockReset(); touchMock.mockResolvedValue({ ok: true }); });

describe("ManageChannels — username cooldown", () => {
  it("saved slot <4h → LOCKED with an 'Unlock in' countdown (input disabled)", async () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map([["tiktok:0", Date.now() - 1 * H]]) }); // 1h ago → cooling
    renderC(acct());
    await waitFor(() => expect(screen.getByText(/Unlock in/i)).toBeTruthy());
    expect((screen.getByDisplayValue("saved_tt") as HTMLInputElement).disabled).toBe(true);
  });

  it("LOCKED-AGAD: saved slot with NO change-row → LOCKED with a 'Change' button; tap Change → editable; Save touches + unlocked=[0]", async () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map() }); // no row → ≥4h semantics → changeable
    const { onSave } = renderC(acct());
    // Locked on open: the input is disabled and a "Change" button is offered.
    const changeBtn = await waitFor(() => screen.getByTestId("mc-change"));
    expect((screen.getByDisplayValue("saved_tt") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(changeBtn);                              // deliberate unlock of THIS slot
    const input = screen.getByDisplayValue("saved_tt") as HTMLInputElement;
    expect(input.disabled).toBe(false);                     // now editable
    fireEvent.change(input, { target: { value: "newname" } });
    fireEvent.click(screen.getByText("Save profile"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(touchMock).toHaveBeenCalledWith("tiktok", 0);    // server change recorded (starts the 4h lock)
    const [lists, opts] = onSave.mock.calls[0];
    expect(lists.tiktok).toContain("newname");
    expect(lists.facebook).toBe("fbpage");                  // other platform passed through
    expect(opts).toEqual({ unlocked: { tiktok: [0] } });    // only the unlocked slot
  });

  it("saved slot ≥4h → LOCKED with 'Change' (editable only after tapping Change)", async () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map([["tiktok:0", Date.now() - 5 * H]]) }); // 5h ago
    renderC(acct());
    await waitFor(() => expect(screen.getByTestId("mc-change")).toBeTruthy());
    expect((screen.getByDisplayValue("saved_tt") as HTMLInputElement).disabled).toBe(true); // locked until Change
    fireEvent.click(screen.getByTestId("mc-change"));
    expect((screen.getByDisplayValue("saved_tt") as HTMLInputElement).disabled).toBe(false);
  });

  it("ANTI-ABUSE: Change + edit + Save → server 'cooldown_active' → error, NOTHING persisted (the server, not the client, is the gate)", async () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map() });
    touchMock.mockResolvedValue({ ok: false, cooldown: true }); // server refuses even though the client unlocked
    const { onSave } = renderC(acct());
    fireEvent.click(await waitFor(() => screen.getByTestId("mc-change")));
    fireEvent.change(screen.getByDisplayValue("saved_tt"), { target: { value: "newname" } });
    fireEvent.click(screen.getByText("Save profile"));
    await waitFor(() => expect(screen.getByText(/changed recently/i)).toBeTruthy());
    expect(onSave).not.toHaveBeenCalled(); // no silent partial save — "Change" cannot bypass the 4h gate
  });

  it("FAIL-CLOSED: cooldown RPC error (null) → saved slot stays LOCKED (as before the feature)", async () => {
    fetchMock.mockResolvedValue(null);
    renderC(acct());
    // give the effect a tick; the saved input must remain disabled
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((screen.getByDisplayValue("saved_tt") as HTMLInputElement).disabled).toBe(true);
  });

  it("ADMIN → saved slot editable, NO cooldown fetch, NO touch on save", async () => {
    const { onSave } = renderC(acct("admin"));
    const input = screen.getByDisplayValue("saved_tt") as HTMLInputElement;
    expect(input.disabled).toBe(false);          // admin edits saved slots
    expect(fetchMock).not.toHaveBeenCalled();     // admin skips the cooldown read
    fireEvent.change(input, { target: { value: "adminchange" } });
    fireEvent.click(screen.getByText("Save profile"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(touchMock).not.toHaveBeenCalled();     // server bypasses admin; client doesn't touch
  });
});
