// Admin parts of Invite friends (sql/164): Invite rewards months, Invite history + Revoke, and the
// seller-card code change. Every confirm is a step INSIDE the page — never window.confirm.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { InviteRewardsPanel, InviteHistoryPanel, SellerInviteRow } from "../AdminInvite";
import { TProvider } from "../../i18n";

const wrap = (el: React.ReactNode) => render(<TProvider lang="en">{el}</TProvider>);
const confirmSpy = vi.spyOn(window, "confirm");
beforeEach(() => { rpc.mockReset(); confirmSpy.mockClear(); });

describe("Invite rewards", () => {
  it("current month (Now) + next 5, empty = Off, save one month", async () => {
    const months = [
      { month: "2026-11-01", days: 10, is_now: true }, { month: "2026-12-01", days: null, is_now: false },
      { month: "2027-01-01", days: 0, is_now: false }, { month: "2027-02-01", days: null, is_now: false },
      { month: "2027-03-01", days: null, is_now: false }, { month: "2027-04-01", days: null, is_now: false },
    ];
    rpc.mockImplementation(async (name: string) => name === "admin_invite_reward_months_get" ? { data: months, error: null } : { data: { ok: true }, error: null });
    wrap(<InviteRewardsPanel />);
    const rows = await screen.findAllByTestId("ir-row");
    expect(rows).toHaveLength(6);
    expect(rows[0].textContent).toMatch(/Now/);
    expect(rows[0].textContent).toMatch(/\+10 days/);
    expect(rows[1].textContent).toMatch(/Off/);
    expect(rows[2].textContent).toMatch(/Off/);
    const boxes = screen.getAllByTestId("ir-days");
    fireEvent.change(boxes[1], { target: { value: "7x" } });
    expect((boxes[1] as HTMLInputElement).value).toBe("7");
    fireEvent.click(screen.getAllByTestId("ir-save")[1]);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_invite_reward_months_set", { p_month: "2026-12-01", p_days: 7 }));
  });
  it("over 365 → clear message, Save off, nothing sent", async () => {
    const months = [{ month: "2026-11-01", days: 10, is_now: true }];
    rpc.mockImplementation(async (name: string) => name === "admin_invite_reward_months_get" ? { data: months, error: null } : { data: { ok: true }, error: null });
    wrap(<InviteRewardsPanel />);
    const box = (await screen.findAllByTestId("ir-days"))[0];
    fireEvent.change(box, { target: { value: "400" } });
    expect(screen.getByTestId("ir-max").textContent).toBe("Max 365 days");
    expect((screen.getByTestId("ir-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("ir-save"));
    expect(rpc.mock.calls.some((c) => c[0] === "admin_invite_reward_months_set")).toBe(false);
    fireEvent.change(box, { target: { value: "365" } });
    expect(screen.queryByTestId("ir-max")).toBeNull();
    expect((screen.getByTestId("ir-save") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Invite history", () => {
  const base = { inviter_user_id: "a", inviter_email: "jeff@x.com", inviter_code: "JEFF", inviter_expiry: "2026-12-31T04:00:00Z", source: "signup", reward_month: "2026-11-01", skip_reason: null, revoked_at: null };
  const rows = [
    { ...base, id: "r1", invitee_user_id: "f1", invitee_email: "friend@x.com", status: "rewarded", reward_days: 10, rewarded_at: "2026-11-12T00:00:00Z", created_at: "2026-11-10T00:00:00Z" },
    { ...base, id: "r2", invitee_user_id: null, invitee_email: "gone@x.com", status: "rewarded", reward_days: 7, rewarded_at: "2026-11-11T00:00:00Z", created_at: "2026-11-09T00:00:00Z" },
    { ...base, id: "r3", invitee_user_id: "f3", invitee_email: "linked@x.com", status: "linked", reward_days: 0, rewarded_at: null, created_at: "2026-11-08T00:00:00Z" },
    { ...base, id: "r4", invitee_user_id: "f4", invitee_email: "nope@x.com", status: "no_reward", reward_days: 0, rewarded_at: "2026-11-07T00:00:00Z", created_at: "2026-11-07T00:00:00Z" },
    { ...base, id: "r5", invitee_user_id: "f5", invitee_email: "back@x.com", status: "revoked", reward_days: 10, rewarded_at: "2026-11-06T00:00:00Z", created_at: "2026-11-06T00:00:00Z", revoked_at: "2026-11-07T00:00:00Z" },
  ];
  it("inviter → friend, days, status; Revoke asks INSIDE the page, then subtracts", async () => {
    rpc.mockImplementation(async (name: string) => name === "admin_referrals_list" ? { data: { total: rows.length, rows }, error: null } : { data: { ok: true, days_removed: 10 }, error: null });
    const onToast = vi.fn();
    wrap(<InviteHistoryPanel onToast={onToast} />);
    const all = await screen.findAllByTestId("ih-row", {}, { timeout: 2000 });
    expect(all[0].textContent).toMatch(/jeff@x\.com \(JEFF\) → friend@x\.com/);
    expect(all[0].textContent).toMatch(/\+10 days/);
    expect(all[1].textContent).toMatch(/gone@x\.com/);              // deleted friend: the saved email
    // Revoke only on the two rows that gave days (not linked / no reward / revoked)
    expect(screen.getAllByTestId("ih-revoke")).toHaveLength(2);
    for (const i of [2, 3, 4]) expect(all[i].querySelector('[data-testid="ih-revoke"]')).toBeNull();
    fireEvent.click(screen.getAllByTestId("ih-revoke")[0]);
    expect(screen.getByTestId("ih-confirm").textContent).toMatch(/Remove 10 days from jeff@x\.com\?/);
    expect(screen.getByTestId("ih-expiry").textContent).toMatch(/^Plan ends .+ → .+$/);
    expect(screen.getByTestId("ih-expiry").textContent).toContain("Dec 31, 2026");
    expect(screen.getByTestId("ih-expiry").textContent).toContain("Dec 21, 2026");
    expect(rpc.mock.calls.some((c) => c[0] === "admin_referral_revoke")).toBe(false);
    fireEvent.click(screen.getByTestId("ih-confirm-yes"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_referral_revoke", { p_referral: "r1" }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Revoked — 10 days removed", "ok"));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe("Seller card", () => {
  it("green line + the code; change code with an in-page step", async () => {
    rpc.mockResolvedValue({ data: { ok: true, code: "NEWCODE" }, error: null });
    const onChanged = vi.fn();
    wrap(<SellerInviteRow userId="u1" onChanged={onChanged} preview={{ code: "OLDCODE", linked: true, status: "linked", inviterEmail: "jeff@x.com", inviterPlan: "pro", wouldReward: true, days: 10, reason: "" }} />);
    expect(screen.getByTestId("adm-invite-line").textContent).toBe("🎁 Invited by jeff@x.com (Pro). jeff@x.com gets +10 days when you give a paid plan.");
    expect(screen.getByTestId("adm-invite-code").textContent).toBe("OLDCODE");
    fireEvent.click(screen.getByTestId("adm-invite-change"));
    fireEvent.change(screen.getByTestId("adm-invite-input"), { target: { value: "new code" } });
    expect(screen.getByText(/old code stops working/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId("adm-invite-save"));
    expect(screen.getByTestId("adm-invite-confirm").textContent).toMatch(/OLDCODE → NEWCODE/);
    fireEvent.click(screen.getByTestId("adm-invite-confirm-yes"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_set_invite_code", { p_user: "u1", p_code: "NEWCODE" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(confirmSpy).not.toHaveBeenCalled();
  });
  it("no inviter → no line; no code → 'not chosen yet'", () => {
    wrap(<SellerInviteRow userId="u1" onChanged={() => {}} preview={undefined} />);
    expect(screen.queryByTestId("adm-invite-line")).toBeNull();
    expect(screen.getByTestId("adm-invite-code").textContent).toBe("not chosen yet");
  });
});
