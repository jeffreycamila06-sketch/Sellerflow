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
});

describe("Invite history", () => {
  const rows = [{ invitee_user_id: "f1", invitee_email: "friend@x.com", inviter_user_id: "a", inviter_email: "jeff@x.com", inviter_code: "JEFF",
    source: "signup", status: "rewarded", reward_days: 10, reward_month: "2026-11-01", rewarded_at: "2026-11-12T00:00:00Z", skip_reason: null, created_at: "2026-11-10T00:00:00Z", revoked_at: null }];
  it("inviter → friend, days, status; Revoke asks INSIDE the page, then subtracts", async () => {
    rpc.mockImplementation(async (name: string) => name === "admin_referrals_list" ? { data: { total: 1, rows }, error: null } : { data: { ok: true, days_removed: 10 }, error: null });
    const onToast = vi.fn();
    wrap(<InviteHistoryPanel onToast={onToast} />);
    const row = await screen.findByTestId("ih-row", {}, { timeout: 2000 });
    expect(row.textContent).toMatch(/jeff@x\.com \(JEFF\) → friend@x\.com/);
    expect(row.textContent).toMatch(/\+10 days/);
    fireEvent.click(screen.getByTestId("ih-revoke"));
    expect(screen.getByTestId("ih-confirm").textContent).toMatch(/Remove 10 days from jeff@x\.com\?/);
    expect(rpc.mock.calls.some((c) => c[0] === "admin_referral_revoke")).toBe(false);
    fireEvent.click(screen.getByTestId("ih-confirm-yes"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_referral_revoke", { p_invitee: "f1" }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Revoked — 10 days removed", "ok"));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe("Seller card", () => {
  it("green line + the code; change code with an in-page step", async () => {
    rpc.mockResolvedValue({ data: { ok: true, code: "NEWCODE" }, error: null });
    const onChanged = vi.fn();
    wrap(<SellerInviteRow userId="u1" onChanged={onChanged} preview={{ code: "OLDCODE", linked: true, status: "linked", inviterEmail: "jeff@x.com", inviterPlan: "pro", wouldReward: true, days: 10, reason: "" }} />);
    expect(screen.getByTestId("adm-invite-line").textContent).toBe("🎁 Invited by jeff@x.com (Pro). jeff@x.com gets +10 days when you save.");
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
