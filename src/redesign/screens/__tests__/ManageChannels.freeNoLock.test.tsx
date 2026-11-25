// Free plan: no 4-hour lock on the TikTok username (sql/216, Jeff 2026-11-25) — the Manage TikTok channels screen.
// The SERVER decides (tiktok_slot_cooldowns answers no wait for a free seller, touch_tiktok_slot refuses nothing —
// proven on a real Postgres by scripts/sql216-behaviour.mjs). Here: what the screen shows and sends.
// Only the two server calls are replaced; the lock helpers and the editor are the real ones.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import ManageChannels from "../ManageChannels";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";

const fetchMock = vi.fn();
const touchMock = vi.fn();
vi.mock("../../adapters/tiktokCooldown", async (importActual) => {
  const actual = await importActual<typeof import("../../adapters/tiktokCooldown")>();
  return { ...actual, fetchSlotCooldowns: (...a: unknown[]) => fetchMock(...a), touchSlot: (...a: unknown[]) => touchMock(...a) };
});

const acct = (plan: string, tiktok = "saved_tt"): AccountUser => ({
  authUserId: "u", email: "g@x.com",
  profile: { fullName: "O", storeName: "S", phone: "", tiktok, facebook: "", adminContactNote: "" },
  plan, planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
} as AccountUser);
const H = 60 * 60 * 1000;
const NO_WAIT = { offsetMs: 0, byKey: new Map<string, number>() };
const page = () => document.body.textContent || "";
const lockWords = () => /LOCKED|Locked\.|Unlock in|Wait a little|4 hours/.test(page());
const show = (a: AccountUser, onSave: (...x: unknown[]) => Promise<{ ok: boolean }>) =>
  <TProvider lang="en"><ManageChannels platform="tiktok" account={a} onBack={() => {}} onSaveChannels={onSave as never} /></TProvider>;

beforeEach(() => { fetchMock.mockReset(); touchMock.mockReset(); touchMock.mockResolvedValue({ ok: true }); });
afterEach(() => cleanup());

describe("Free plan — Manage TikTok channels", () => {
  it("three username changes in a row: Change → type → Save each time; never a lock word", async () => {
    fetchMock.mockResolvedValue(NO_WAIT);                    // what the database answers for a free seller
    let account = acct("free");
    const saved: string[] = [];
    const onSave = vi.fn(async (lists: { tiktok: string }) => { saved.push(lists.tiktok); return { ok: true }; });
    const view = render(show(account, onSave as never));
    let was = "saved_tt";
    for (const name of ["second_tt", "third_tt", "fourth_tt"]) {
      const change = await waitFor(() => screen.getByTestId("mc-change"));
      expect(lockWords()).toBe(false);
      fireEvent.click(change);
      const input = screen.getByDisplayValue(was) as HTMLInputElement;
      expect(input.disabled).toBe(false);
      fireEvent.change(input, { target: { value: name } });
      fireEvent.click(screen.getByText("Save profile"));
      await waitFor(() => expect(saved[saved.length - 1]).toBe(name));
      account = acct("free", name);                          // the profile is read again after a save
      view.rerender(show(account, onSave as never));
      was = name;
    }
    await waitFor(() => screen.getByTestId("mc-change"));
    expect(saved).toEqual(["second_tt", "third_tt", "fourth_tt"]);
    expect(touchMock).toHaveBeenCalledTimes(3);              // the server is asked each time — it is the one that decides
    expect(lockWords()).toBe(false);
  });

  it("removing the username: Change → empty → Save sends the empty name", async () => {
    fetchMock.mockResolvedValue(NO_WAIT);
    const onSave = vi.fn(async () => ({ ok: true }));
    render(show(acct("free"), onSave));
    fireEvent.click(await waitFor(() => screen.getByTestId("mc-change")));
    fireEvent.change(screen.getByDisplayValue("saved_tt"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save profile"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0] as unknown[])[0]).toEqual({ tiktok: "", facebook: "" });
    expect((onSave.mock.calls[0] as unknown[])[1]).toEqual({ unlocked: { tiktok: [0] } });
  });

  it("while the lock answer is still on its way: Change is there, no LOCKED", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));        // never answers
    render(show(acct("free"), vi.fn()));
    expect(screen.getByTestId("mc-change")).toBeTruthy();
    expect(lockWords()).toBe(false);
    fireEvent.click(screen.getByTestId("mc-change"));
    expect((screen.getByDisplayValue("saved_tt") as HTMLInputElement).disabled).toBe(false);
  });

  it("the lock answer could not be read: Change is there, no 'Locked. Admin can change this account.'", async () => {
    fetchMock.mockResolvedValue(null);
    render(show(acct("free"), vi.fn()));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId("mc-change")).toBeTruthy();
    expect(lockWords()).toBe(false);
  });

  it("a wait the server DOES answer is still shown (the app never overrules the server — e.g. the web is live before sql/216)", async () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map([["tiktok:0", Date.now() - 1 * H]]) });
    render(show(acct("free"), vi.fn()));
    await waitFor(() => expect(screen.getByText(/Unlock in/i)).toBeTruthy());
    expect(screen.queryByTestId("mc-change")).toBeNull();
  });

  it("the server refuses a change → its message, nothing saved (a free label on the phone unlocks nothing)", async () => {
    fetchMock.mockResolvedValue(NO_WAIT);
    touchMock.mockResolvedValue({ ok: false, cooldown: true });
    const onSave = vi.fn(async () => ({ ok: true }));
    render(show(acct("free"), onSave));
    fireEvent.click(await waitFor(() => screen.getByTestId("mc-change")));
    fireEvent.change(screen.getByDisplayValue("saved_tt"), { target: { value: "other" } });
    fireEvent.click(screen.getByText("Save profile"));
    await waitFor(() => expect(page()).toContain("This username was changed recently."));
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("Paid plans — unchanged", () => {
  for (const plan of ["basic", "plus", "pro", "master"]) {
    it(`${plan}: no Change while the lock answer is on its way; LOCKED when it could not be read`, async () => {
      fetchMock.mockReturnValue(new Promise(() => {}));
      render(show(acct(plan), vi.fn()));
      expect(screen.queryByTestId("mc-change")).toBeNull();
      expect(page()).toContain("LOCKED");
      cleanup();
      fetchMock.mockResolvedValue(null);
      render(show(acct(plan), vi.fn()));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.queryByTestId("mc-change")).toBeNull();
      expect(page()).toContain("Locked. Admin can change this account.");
    });
  }
  it("basic: a change less than 4 hours ago → 'Unlock in', no Change", async () => {
    fetchMock.mockResolvedValue({ offsetMs: 0, byKey: new Map([["tiktok:0", Date.now() - 1 * H]]) });
    render(show(acct("basic"), vi.fn()));
    await waitFor(() => expect(screen.getByText(/Unlock in 3h/i)).toBeTruthy());
    expect(screen.queryByTestId("mc-change")).toBeNull();
  });
});
