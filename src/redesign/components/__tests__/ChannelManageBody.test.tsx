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

describe("ChannelManageBody — Option B exact plan slots", () => {
  it.each([["basic", 1], ["plus", 2], ["pro", 3], ["master", 5]] as const)(
    "%s plan → EXACTLY %i slots (no teaser/+1)", (plan, n) => {
      fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map() });
      const { getAllByTestId } = render(<TProvider lang="en"><ChannelManageBody platform="tiktok" account={acct("saved_tt", "seller", plan)} onSaveChannels={vi.fn()} onSaved={vi.fn()} /></TProvider>);
      expect(getAllByTestId("cm-row")).toHaveLength(n);
    });

  it("no plan/upgrade badge (PLUS/PRO/MASTER) anywhere", () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map() });
    const { container } = render(<TProvider lang="en"><ChannelManageBody platform="tiktok" account={acct("saved_tt", "seller", "pro")} onSaveChannels={vi.fn()} onSaved={vi.fn()} /></TProvider>);
    expect(container.textContent).not.toMatch(/PLUS|PRO|MASTER/);
  });

  it("'Add — Multi Account' button opens the shared Telegram popup (title + @handle + OK→t.me)", () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map() });
    const { getByTestId, queryByTestId } = render(<TProvider lang="en"><ChannelManageBody platform="tiktok" account={acct("saved_tt", "seller", "master")} onSaveChannels={vi.fn()} onSaved={vi.fn()} /></TProvider>);
    expect(queryByTestId("cm-multi-popup")).toBeNull();   // closed initially
    fireEvent.click(getByTestId("cm-multi"));              // the bottom button (all plans)
    const popup = getByTestId("cm-multi-popup");           // exact shared popup opens
    expect(popup.textContent).toContain("Add TikTok — Multi Account");           // title
    expect(popup.textContent).toContain("message our admin on Telegram");        // body
    expect(popup.textContent).toContain("@SellerFlowLive");                       // Telegram box
    const ok = getByTestId("cm-multi-ok") as HTMLAnchorElement;
    expect(ok.tagName).toBe("A");
    expect(ok.getAttribute("href")).toContain("t.me");    // OK → Telegram (iOS-safe anchor)
  });

  it("empty slot within cap adds directly → Save sends the new handle", async () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map() });
    const onSaveChannels = vi.fn().mockResolvedValue({ ok: true });
    const { getAllByTestId, getByTestId } = render(<TProvider lang="en"><ChannelManageBody platform="tiktok" account={acct("saved_tt", "seller", "master")} onSaveChannels={onSaveChannels} onSaved={vi.fn()} /></TProvider>);
    fireEvent.change(getAllByTestId("cm-empty")[0], { target: { value: "brandnew" } });
    fireEvent.click(getByTestId("cm-save"));
    await waitFor(() => expect(onSaveChannels).toHaveBeenCalled());
    expect(onSaveChannels.mock.calls[0][0].tiktok).toContain("brandnew");
    expect(touchMock).not.toHaveBeenCalled(); // a fresh add is NOT rotation-gated (typo-fixable)
  });
});

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
