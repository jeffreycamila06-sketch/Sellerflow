// Invite codes (sql/165) — the client half. Pure helpers + every call answers instead of throwing,
// so a sign-up or a screen never breaks because of an invite call.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import {
  normInviteCode, inviteCodeFormatOk, typedInviteCode, randomInviteCode, RANDOM_ALPHABET, shareTextFor,
  checkInviteCode, claimSignupCode, takePendingInvite, savePendingInvite, PENDING_INVITE_KEY, parseSummary, referralLine,
  setMyInviteCode, claimReferral, canRevoke, expiryAfterRevoke, rewardDaysValid,
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
  it("full-width input from a Chinese keyboard (NFKC) → plain ASCII", () => {
    expect(normInviteCode("ｂｕｄｇｅｔｕｋａｙ")).toBe("BUDGETUKAY");
    expect(typedInviteCode("ＢＵＤＧＥＴ　１２")).toBe("BUDGET12");
    expect(inviteCodeFormatOk("ＳＨＯＰ２０２６")).toBe(true);
  });
  it("typing filter drops spaces/symbols, uppercases, max 12", () => {
    expect(typedInviteCode("my shop-1!")).toBe("MYSHOP1");
    expect(typedInviteCode("abcdefghijklmnop")).toBe("ABCDEFGHIJKL");
  });
  it("random code: 6 chars, no 0/O/1/I", () => {
    expect(RANDOM_ALPHABET).not.toMatch(/[0O1I]/);
    for (let i = 0; i < 200; i++) expect(randomInviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
  it("share text = code only, no link; uses the translated template", () => {
    const s = shareTextFor("BUDGETUKAY");
    expect(s).toBe("Use my SellerFlowLive invite code: BUDGETUKAY");
    expect(s).not.toMatch(/https?:|\?ref=|www\./i);
    for (const l of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const tl = (buildT(l) as unknown as Record<string, string>).rd_ref_share_text;
      const out = shareTextFor("ABCD12", tl);
      expect(out, l).toContain("ABCD12");
      expect(out, l).not.toContain("{code}");
      expect(out, l).not.toMatch(/https?:|\?ref=/i);
    }
    expect(shareTextFor("ABCD12", "broken template")).toBe("Use my SellerFlowLive invite code: ABCD12");
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
  const E = "new@shop.com";
  it("no / bad code → nothing sent", async () => {
    expect(await claimSignupCode(undefined, E)).toBe("none");
    expect(await claimSignupCode("ab", E)).toBe("none");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("found → claimed with source signup (full-width typed code works)", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect(await claimSignupCode("ｂｕｄｇｅｔｕｋａｙ", E)).toBe("claimed");
    expect(rpc).toHaveBeenCalledWith("claim_referral", { p_code: "BUDGETUKAY", p_source: "signup" });
  });
  it("wrong code → refused, nothing kept", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: "not_found" }, error: null });
    expect(await claimSignupCode("WRONG1", E)).toBe("refused");
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBe(null);
  });
  it("network error / no profile yet → kept as {code, email} in sessionStorage only, taken once", async () => {
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await claimSignupCode("budgetukay", "New@Shop.com")).toBe("kept");
    expect(JSON.parse(sessionStorage.getItem(PENDING_INVITE_KEY)!)).toEqual({ code: "BUDGETUKAY", email: "new@shop.com" });
    expect(localStorage.getItem(PENDING_INVITE_KEY)).toBe(null);
    expect(takePendingInvite("NEW@shop.com")).toBe("BUDGETUKAY");
    expect(takePendingInvite("new@shop.com")).toBe("");
  });
  it("a different account signing in on this tab → the code is dropped, never claimed for it", () => {
    savePendingInvite("BUDGETUKAY", "new@shop.com");
    expect(takePendingInvite("someone.else@shop.com")).toBe("");
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBe(null);
    expect(takePendingInvite("new@shop.com")).toBe("");
  });
  it("junk / old-format / no-email pending values are ignored", () => {
    sessionStorage.setItem(PENDING_INVITE_KEY, "BUDGETUKAY");
    expect(takePendingInvite("new@shop.com")).toBe("");
    savePendingInvite("x!", "new@shop.com");
    savePendingInvite("ABCD12", "");
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBe(null);
  });
  it("a claim that never answers gives up after the timeout and keeps the code (sign-up never hangs)", async () => {
    vi.useFakeTimers();
    try {
      rpc.mockImplementationOnce(() => new Promise(() => { /* never */ }));
      const p = claimSignupCode("budgetukay", E);
      await vi.advanceTimersByTimeAsync(3999);
      let done = false; void p.then(() => { done = true; });
      await Promise.resolve();
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await p).toBe("kept");
      expect(JSON.parse(sessionStorage.getItem(PENDING_INVITE_KEY)!)).toEqual({ code: "BUDGETUKAY", email: E });
    } finally { vi.useRealTimers(); }
  });
});

describe("admin helpers", () => {
  it("Revoke only on rows that gave days", () => {
    expect(canRevoke({ status: "rewarded", rewardDays: 10 })).toBe(true);
    expect(canRevoke({ status: "rewarded", rewardDays: 0 })).toBe(false);
    for (const st of ["linked", "no_reward", "revoked"] as const) expect(canRevoke({ status: st, rewardDays: 10 })).toBe(false);
  });
  it("expiry after revoke = current − days", () => {
    expect(expiryAfterRevoke("2026-12-31T00:00:00.000Z", 10)).toBe("2026-12-21T00:00:00.000Z");
    expect(expiryAfterRevoke(null, 10)).toBe(null);
  });
  it("reward days box: 0–365 or empty", () => {
    for (const ok of ["", "0", "7", "365"]) expect(rewardDaysValid(ok), ok).toBe(true);
    for (const bad of ["366", "999", "-1", "1.5"]) expect(rewardDaysValid(bad), bad).toBe(false);
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
      .toEqual({ text: "Invited by a@x.com (Pro). a@x.com gets +10 days when you give a paid plan.", tone: "ok" });
  });
  it("the reason it won't", () => {
    expect(referralLine(t, { code: null, linked: true, status: "linked", inviterEmail: "a@x.com", inviterPlan: "free", wouldReward: false, days: 0, reason: "inviter_not_paid" })!.text)
      .toBe("Invited by a@x.com (Free) — no free days: the inviter is not on an active paid plan.");
    expect(referralLine(t, { code: null, linked: true, status: "linked", inviterEmail: "a@x.com", inviterPlan: "pro", wouldReward: false, reason: "month_off" })!.text).toMatch(/no reward set for this month/);
    expect(referralLine(t, { code: null, linked: true, status: "rewarded", rewardDays: 7, inviterEmail: "a@x.com", inviterPlan: "pro" })!.text).toBe("Invited by a@x.com · +7 days");
    expect(referralLine(t, { code: "ABCD", linked: false })).toBe(null);
  });
});
