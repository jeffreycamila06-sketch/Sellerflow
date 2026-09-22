// Locked-agad manage body (the compact modal editor). Pure lock helpers stay REAL;
// only the two server RPCs (fetchSlotCooldowns / touchSlot) are mocked so we drive
// locked-on-open → Change → save-closes / cooldown-not-bypassable / admin-bypass.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ChannelManageBody from "../ChannelManageBody";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";

const fetchMock = vi.fn();
const touchMock = vi.fn();
vi.mock("../../adapters/tiktokCooldown", async (importActual) => {
  const actual = await importActual<typeof import("../../adapters/tiktokCooldown")>();
  return { ...actual, fetchSlotCooldowns: (...a: unknown[]) => fetchMock(...a), touchSlot: (...a: unknown[]) => touchMock(...a) };
});

const acct = (tiktok: string, role = "seller", plan = "pro"): AccountUser => ({
  authUserId: "u", email: "g@x.com",
  profile: { fullName: "O", storeName: "S", phone: "", tiktok, facebook: "", adminContactNote: "" },
  plan, planStatus: "active", planExpiry: "", connectedAccounts: [], role,
} as unknown as AccountUser);

beforeEach(() => { fetchMock.mockReset(); touchMock.mockReset(); touchMock.mockResolvedValue({ ok: true }); });

describe("ChannelManageBody — locked-agad", () => {
  it("saved handle is LOCKED on open (🔒 + Change, input not shown); tap Change → editable input", async () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map() }); // changeable (no cooldown row)
    render(<TProvider lang="en"><ChannelManageBody platform="tiktok" account={acct("saved_tt")} onSaveChannels={vi.fn().mockResolvedValue({ ok: true })} onSaved={vi.fn()} /></TProvider>);
    const change = await waitFor(() => screen.getByTestId("cm-change"));
    expect(screen.queryByTestId("cm-edit")).toBeNull();   // locked → no input yet
    fireEvent.click(change);
    expect(screen.getByTestId("cm-edit")).toBeTruthy();   // unlocked → editable input
  });

  it("Change → edit → Save success → touches the slot (4h lock) AND closes (onSaved)", async () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map() });
    const onSaveChannels = vi.fn().mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    render(<TProvider lang="en"><ChannelManageBody platform="tiktok" account={acct("saved_tt")} onSaveChannels={onSaveChannels} onSaved={onSaved} /></TProvider>);
    fireEvent.click(await waitFor(() => screen.getByTestId("cm-change")));
    fireEvent.change(screen.getByTestId("cm-edit"), { target: { value: "newname" } });
    fireEvent.click(screen.getByTestId("cm-save"));
    await waitFor(() => expect(onSaveChannels).toHaveBeenCalled());
    expect(touchMock).toHaveBeenCalledWith("tiktok", 0);   // server 4h lock recorded
    await waitFor(() => expect(onSaved).toHaveBeenCalled()); // success → modal closes
  });

  it("ANTI-ABUSE: server 'cooldown_active' on save → error shown, modal STAYS open (no bypass, no persist)", async () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map() });
    touchMock.mockResolvedValue({ ok: false, cooldown: true });
    const onSaveChannels = vi.fn().mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    render(<TProvider lang="en"><ChannelManageBody platform="tiktok" account={acct("saved_tt")} onSaveChannels={onSaveChannels} onSaved={onSaved} /></TProvider>);
    fireEvent.click(await waitFor(() => screen.getByTestId("cm-change")));
    fireEvent.change(screen.getByTestId("cm-edit"), { target: { value: "newname" } });
    fireEvent.click(screen.getByTestId("cm-save"));
    await waitFor(() => expect(screen.getByTestId("cm-error")).toBeTruthy());
    expect(onSaveChannels).not.toHaveBeenCalled(); // aborted before persist
    expect(onSaved).not.toHaveBeenCalled();        // NOT closed on failure
  });

  it("cooling (<4h) → LOCKED 🔒 + 'Unlock in', NO Change button", async () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map([["tiktok:0", Date.now() - 60 * 60 * 1000]]) }); // 1h ago
    render(<TProvider lang="en"><ChannelManageBody platform="tiktok" account={acct("saved_tt")} onSaveChannels={vi.fn()} onSaved={vi.fn()} /></TProvider>);
    await waitFor(() => expect(screen.getByTestId("cm-cooling")).toBeTruthy());
    expect(screen.queryByTestId("cm-change")).toBeNull();  // cooling → cannot Change
    expect(screen.getByTestId("cm-locked")).toBeTruthy();
  });

  it("ADMIN → editable directly (no Change, no cooldown fetch)", async () => {
    render(<TProvider lang="en"><ChannelManageBody platform="tiktok" account={acct("saved_tt", "admin")} onSaveChannels={vi.fn().mockResolvedValue({ ok: true })} onSaved={vi.fn()} /></TProvider>);
    expect(screen.getByTestId("cm-edit")).toBeTruthy();    // admin edits directly
    expect(screen.queryByTestId("cm-change")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();              // admin skips the cooldown read
  });
});
