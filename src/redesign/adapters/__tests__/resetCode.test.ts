// Forgot-password 6-digit code — adapter pins (switch reading, neutral send, verifyOtp
// 'recovery', save → sign out everywhere, abandon → sign out locally, the in-flight marker).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const S = vi.hoisted(() => ({
  rpc: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: S.rpc, auth: { resetPasswordForEmail: S.resetPasswordForEmail, verifyOtp: S.verifyOtp, updateUser: S.updateUser, signOut: S.signOut } },
}));

import {
  loadResetCodeEnabled, readResetPreview, sendResetCode, verifyResetCode, saveNewPassword, abandonReset,
  resetInFlight, beginResetSession, endResetSession, cleanCode, RESET_MIN_DELAY_MS,
} from "../resetCode";

beforeEach(() => {
  for (const f of Object.values(S)) f.mockReset();
  S.signOut.mockResolvedValue({ error: null });
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => { vi.useRealTimers(); });

describe("switch", () => {
  it("ON only for a literal true from reset_code_enabled(); error / anything else / throw → OFF", async () => {
    S.rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await loadResetCodeEnabled()).toBe(true);
    expect(S.rpc).toHaveBeenCalledWith("reset_code_enabled");
    S.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await loadResetCodeEnabled()).toBe(false);
    S.rpc.mockResolvedValueOnce({ data: "true", error: null });
    expect(await loadResetCodeEnabled()).toBe(false);
    S.rpc.mockResolvedValueOnce({ data: null, error: { message: "function does not exist" } });
    expect(await loadResetCodeEnabled()).toBe(false);
    S.rpc.mockRejectedValueOnce(new Error("network"));
    expect(await loadResetCodeEnabled()).toBe(false);
  });
  it("?reset_preview=1 turns the preview on for this tab only; no param → off; storage throwing → off", () => {
    expect(readResetPreview()).toBe(false);
    window.history.replaceState(null, "", "/?reset_preview=1");
    expect(readResetPreview()).toBe(true);
    window.history.replaceState(null, "", "/");
    expect(readResetPreview()).toBe(true); // kept for the tab (sessionStorage)
    sessionStorage.clear();
    expect(readResetPreview()).toBe(false);
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readResetPreview()).toBe(false);
    spy.mockRestore();
  });
});

describe("send code — the same neutral answer", () => {
  it("no redirect option; success, unknown email and errors all answer 'sent'; too many → 'wait'", async () => {
    S.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
    expect(await sendResetCode(" Seller@X.com ")).toBe("sent");
    expect(S.resetPasswordForEmail).toHaveBeenCalledWith("seller@x.com");
    expect(S.resetPasswordForEmail.mock.calls[0]).toHaveLength(1);
    S.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: { status: 400, message: "User not found" } });
    expect(await sendResetCode("nobody@x.com")).toBe("sent");
    S.resetPasswordForEmail.mockRejectedValueOnce(new Error("network"));
    expect(await sendResetCode("a@x.com")).toBe("sent");
    S.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: { status: 429, code: "over_email_send_rate_limit" } });
    expect(await sendResetCode("a@x.com")).toBe("wait");
  });
  it("never answers before the fixed minimum delay, even when Supabase is instant", async () => {
    vi.useFakeTimers();
    S.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    let done = false;
    void sendResetCode("a@x.com").then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(RESET_MIN_DELAY_MS - 50);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(60);
    expect(done).toBe(true);
  });
});

describe("verify / save / abandon", () => {
  it("verifyOtp with type 'recovery'; the in-flight marker is set BEFORE the call (the app ignores that session)", async () => {
    let markerDuringCall = false;
    S.verifyOtp.mockImplementationOnce(async () => { markerDuringCall = resetInFlight(); return { data: { session: { user: { id: "u" } } }, error: null }; });
    expect(await verifyResetCode(" A@x.com ", "123456")).toBe(true);
    expect(S.verifyOtp).toHaveBeenCalledWith({ email: "a@x.com", token: "123456", type: "recovery" });
    expect(markerDuringCall).toBe(true);
    expect(resetInFlight()).toBe(true);
  });
  it("wrong / expired code → false and the marker is cleared", async () => {
    S.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: { message: "Token has expired or is invalid" } });
    expect(await verifyResetCode("a@x.com", "000000")).toBe(false);
    expect(resetInFlight()).toBe(false);
  });
  it("save: updateUser, then sign out EVERY session (global), marker cleared", async () => {
    beginResetSession();
    S.updateUser.mockResolvedValueOnce({ data: {}, error: null });
    expect(await saveNewPassword("newpass1")).toBe(true);
    expect(S.updateUser).toHaveBeenCalledWith({ password: "newpass1" });
    expect(S.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(S.updateUser.mock.invocationCallOrder[0]).toBeLessThan(S.signOut.mock.invocationCallOrder[0]);
    expect(resetInFlight()).toBe(false);
  });
  it("save failure → false, nobody signed out yet (the seller can try again)", async () => {
    beginResetSession();
    S.updateUser.mockResolvedValueOnce({ data: null, error: { message: "weak" } });
    expect(await saveNewPassword("newpass1")).toBe(false);
    expect(S.signOut).not.toHaveBeenCalled();
    expect(resetInFlight()).toBe(true);
  });
  it("abandon → sign out on this device only, marker cleared", async () => {
    beginResetSession();
    await abandonReset();
    expect(S.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(resetInFlight()).toBe(false);
  });
  it("a stale marker expires (never blocks a normal login for long)", () => {
    beginResetSession();
    expect(resetInFlight(Date.now() + 31 * 60 * 1000)).toBe(false);
    endResetSession();
    expect(resetInFlight()).toBe(false);
  });
  it("cleanCode: digits only, paste-friendly, max 6", () => {
    expect(cleanCode("12 34-56")).toBe("123456");
    expect(cleanCode("1234567")).toBe("123456");
    expect(cleanCode("ab12")).toBe("12");
  });
});
