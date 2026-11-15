// Invite codes (sql/164) — the client half. Pure helpers + every call answers instead of throwing,
// so a sign-up or a screen never breaks because of an invite call.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import {
  normInviteCode, inviteCodeFormatOk, typedInviteCode, randomInviteCode, RANDOM_ALPHABET, shareTextFor,
  checkInviteCode, claimSignupCode, takePendingInvite, savePendingInvite, PENDING_INVITE_KEY, parseSummary, referralLine,
  setMyInviteCode, claimReferral,
} from "../invite";
import { buildT } from "../../i18n";

beforeEach(() => { rpc.mockReset(); sessionStorage.clear(); });

describe("code format", () => {
  it("stores uppercase, case-insensitive", () => {
    expect(normInviteCode("  budgetukay ")).toBe("BUDGETUKAY");
    expect(inviteCodeFormatOk("budgetukay")).toBe(true);
  });
  it("4–12 letters/numbers only", () => {
    for (const bad of ["abc", "abcdefghijklm", "ab cd", "ab-cd", "ñandu", ""]) expect(inviteCodeFormatOk(bad), bad).toBe(false);
    for (const good of ["ABCD", "abcdefghijkl", "shop2026"]) expect(inviteCodeFormatOk(good), good).toBe(true);
  });
  it("typing filter drops spaces/symbols, uppercases, max 12", () => {
    expect(typedInviteCode("my shop-1!")).toBe("MYSHOP1");
    expect(typedInviteCode("abcdefghijklmnop")).toBe("ABCDEFGHIJKL");
  });
  it("random code: 6 chars, no 0/O/1/I", () => {
    expect(RANDOM_ALPHABET).not.toMatch(/[0O1I]/);
    for (let i = 0; i < 200; i++) expect(randomInviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
  it("share text = code only, no link", () => {
    const s = shareTextFor("BUDGETUKAY");
    expect(s).toBe("Use my SellerFlowLive invite code: BUDGETUKAY");
    expect(s).not.toMatch(/https?:|\?ref=|www\./i);
  });
});

describe("calls never throw", () => {
  it("checkInviteCode: junk never reaches the database; error → null", async () => {
    expect(await checkInviteCode("!!")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await checkInviteCode("budgetukay")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("check_invite_code", { p_code: "BUDGETUKAY" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await checkInviteCode("ABCD")).toBe(null);
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await checkInviteCode("ABCD")).toBe(null);
  });
  it("setMyInviteCode / claimReferral answer on error", async () => {
    rpc.mockRejectedValueOnce(new Error("boom"));
    expect(await setMyInviteCode("ABCD")).toEqual({ ok: false, reason: "error" });
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: "self" }, error: null });
    expect((await claimReferral("ABCD", "settings")).reason).toBe("self");
  });
});

describe("sign-up claim", () => {
  it("no / bad code → nothing sent", async () => {
    expect(await claimSignupCode(undefined)).toBe("none");
    expect(await claimSignupCode("ab")).toBe("none");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("found → claimed with source signup", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect(await claimSignupCode("budgetukay")).toBe("claimed");
    expect(rpc).toHaveBeenCalledWith("claim_referral", { p_code: "BUDGETUKAY", p_source: "signup" });
  });
  it("wrong code → refused, nothing kept", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: "not_found" }, error: null });
    expect(await claimSignupCode("WRONG1")).toBe("refused");
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBe(null);
  });
  it("network error / no profile yet → kept in sessionStorage for this tab only, taken once", async () => {
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await claimSignupCode("budgetukay")).toBe("kept");
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBe("BUDGETUKAY");
    expect(localStorage.getItem(PENDING_INVITE_KEY)).toBe(null);
    expect(takePendingInvite()).toBe("BUDGETUKAY");
    expect(takePendingInvite()).toBe("");
    savePendingInvite("x!");
    expect(takePendingInvite()).toBe("");
  });
});

describe("summary + admin line", () => {
  it("parses the summary", () => {
    const s = parseSummary({ code: "ABCD", month_days: 10, eligible: true, has_inviter: false, can_enter_code: false,
      invites: [{ email: "abc…", status: "rewarded", days: 10, date: "2026-11-01T00:00:00Z" }, { email: "x", status: "bogus" }] });
    expect(s).toMatchObject({ code: "ABCD", monthDays: 10, eligible: true, canEnterCode: false });
    expect(s!.invites).toHaveLength(1);
    expect(parseSummary(null)).toBe(null);
  });
  const t = buildT("en") as unknown as Record<string, string>;
  it("green line when the inviter would get days", () => {
    expect(referralLine(t, { code: null, linked: true, status: "linked", inviterEmail: "a@x.com", inviterPlan: "pro", wouldReward: true, days: 10, reason: "" }))
      .toEqual({ text: "Invited by a@x.com (Pro). a@x.com gets +10 days when you save.", tone: "ok" });
  });
  it("the reason it won't", () => {
    expect(referralLine(t, { code: null, linked: true, status: "linked", inviterEmail: "a@x.com", inviterPlan: "free", wouldReward: false, days: 0, reason: "inviter_not_paid" })!.text)
      .toBe("Invited by a@x.com (Free) — no free days: the inviter is not on an active paid plan.");
    expect(referralLine(t, { code: null, linked: true, status: "linked", inviterEmail: "a@x.com", inviterPlan: "pro", wouldReward: false, reason: "month_off" })!.text).toMatch(/no reward set for this month/);
    expect(referralLine(t, { code: null, linked: true, status: "rewarded", rewardDays: 7, inviterEmail: "a@x.com", inviterPlan: "pro" })!.text).toBe("Invited by a@x.com · +7 days");
    expect(referralLine(t, { code: "ABCD", linked: false })).toBe(null);
  });
});
