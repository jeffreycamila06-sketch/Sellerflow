// Settings → Invite friends — the short timers of its three parts stop when the screen closes
// (the same fix as Pickup Status, CI run 1843):
//   · my code: the "Copied" / "couldn't copy" note (2 s);
//   · enter a friend's code: the short wait before the screen reads itself again (1.2 s / 1.5 s);
//   · share the app: its note (2.5 s).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import InviteFriends from "../InviteFriends";
import { TProvider } from "../../i18n";
import { expectNothingLate, tick, until } from "../../adapters/__tests__/pageGone";

const summary = (over: Record<string, unknown> = {}) => ({ code: null, month_days: 0, eligible: true, has_inviter: false, can_enter_code: false, invites: [], ...over });
let answers: Record<string, unknown> = {};
const route = () => rpc.mockImplementation(async (name: string) => ({ data: answers[name], error: null }));
const view = () => render(<TProvider lang="en"><InviteFriends onBack={() => {}} /></TProvider>);
const reads = () => rpc.mock.calls.filter((c) => c[0] === "my_referral_summary").length;
const clipboard = (ok = true) => {
  const writeText = ok ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error("blocked"));
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
  return writeText;
};
const realExec = document.execCommand;

beforeEach(() => {
  vi.useFakeTimers();   // the clock moves only when a test moves it
  rpc.mockReset(); answers = {};
  delete (navigator as unknown as { share?: unknown }).share;
  document.execCommand = (() => false) as typeof document.execCommand;
});
afterEach(() => { vi.useRealTimers(); document.execCommand = realExec; });

describe("the screen is closed right after …", () => {
  it("a Copy of my code: no timer is left and nothing updates late", async () => {
    answers = { my_referral_summary: summary({ code: "ABCD" }) }; route(); clipboard();
    const r = view();
    await until(() => r.queryByTestId("inv-copy"));
    fireEvent.click(r.getByTestId("inv-copy"));
    await until(() => r.getByTestId("inv-copy-note").textContent === "Copied");
    r.unmount();
    expectNothingLate();
  });
  it("a Copy that could not be done", async () => {
    answers = { my_referral_summary: summary({ code: "ABCD" }) }; route(); clipboard(false);
    const r = view();
    await until(() => r.queryByTestId("inv-copy"));
    fireEvent.click(r.getByTestId("inv-copy"));
    await until(() => r.getByTestId("inv-copy-note").textContent !== "");
    r.unmount();
    expectNothingLate();
  });
  it("a friend's code was saved: the read-again that was waiting never runs", async () => {
    answers = { my_referral_summary: summary({ code: "MINE1", can_enter_code: true }), check_invite_code: true, claim_referral: { ok: true } }; route();
    const r = view();
    await until(() => r.queryByTestId("inv-enter-input"));
    fireEvent.change(r.getByTestId("inv-enter-input"), { target: { value: "friend1" } });
    await until(() => !(r.getByTestId("inv-enter-save") as HTMLButtonElement).disabled);
    fireEvent.click(r.getByTestId("inv-enter-save"));
    await until(() => /saved/.test(r.getByTestId("inv-enter-state").textContent || ""));
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);                                            // the 1.2 s wait is on the clock
    const before = reads();
    r.unmount();
    expectNothingLate();
    expect(reads()).toBe(before);
  });
  it("a friend's code was refused as 'already linked' (1.5 s wait): the same", async () => {
    answers = { my_referral_summary: summary({ code: "MINE1", can_enter_code: true }), check_invite_code: true, claim_referral: { ok: false, reason: "already_linked" } }; route();
    const r = view();
    await until(() => r.queryByTestId("inv-enter-input"));
    fireEvent.change(r.getByTestId("inv-enter-input"), { target: { value: "friend1" } });
    await until(() => !(r.getByTestId("inv-enter-save") as HTMLButtonElement).disabled);
    fireEvent.click(r.getByTestId("inv-enter-save"));
    await until(() => /already/i.test(r.getByTestId("inv-enter-state").textContent || ""));   // the refusal is shown
    expect(rpc).toHaveBeenCalledWith("claim_referral", { p_code: "FRIEND1", p_source: "settings" });
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);                                            // the 1.5 s wait is on the clock
    const before = reads();
    r.unmount();
    expectNothingLate();
    expect(reads()).toBe(before);
  });
  it("Share the app (copied note)", async () => {
    answers = { my_referral_summary: summary({ code: "ABCD" }) }; route(); clipboard();
    const r = view();
    await until(() => r.queryByTestId("inv-code"));
    fireEvent.click(r.getByTestId("inv-share-app"));
    await until(() => r.queryByText("Link copied"));
    r.unmount();
    expectNothingLate();
  });
});

describe("while the screen is open nothing changed", () => {
  it("'Copied' stays 2 seconds", async () => {
    answers = { my_referral_summary: summary({ code: "ABCD" }) }; route(); clipboard();
    const r = view();
    await until(() => r.queryByTestId("inv-copy"));
    fireEvent.click(r.getByTestId("inv-copy"));
    await until(() => r.getByTestId("inv-copy-note").textContent === "Copied");
    await tick(1999);
    expect(r.getByTestId("inv-copy-note").textContent).toBe("Copied");
    await tick(1);
    expect(r.getByTestId("inv-copy-note").textContent).toBe("");
  });
  it("a saved friend's code: the screen reads itself again 1.2 s later and the box goes away", async () => {
    answers = { my_referral_summary: summary({ code: "MINE1", can_enter_code: true }), check_invite_code: true, claim_referral: { ok: true } }; route();
    const r = view();
    await until(() => r.queryByTestId("inv-enter-input"));
    fireEvent.change(r.getByTestId("inv-enter-input"), { target: { value: "friend1" } });
    await until(() => !(r.getByTestId("inv-enter-save") as HTMLButtonElement).disabled);
    answers.my_referral_summary = summary({ code: "MINE1", can_enter_code: false });
    fireEvent.click(r.getByTestId("inv-enter-save"));
    await until(() => /saved/.test(r.getByTestId("inv-enter-state").textContent || ""));
    const before = reads();
    await tick(1199);
    expect(reads()).toBe(before);
    await tick(1);
    expect(reads()).toBe(before + 1);
    await until(() => r.queryByTestId("inv-enter") === null);
  });
  it("a friend's code refused as 'already linked': the screen reads itself again 1.5 s later — once", async () => {
    answers = { my_referral_summary: summary({ code: "MINE1", can_enter_code: true }), check_invite_code: true, claim_referral: { ok: false, reason: "already_linked" } }; route();
    const r = view();
    await until(() => r.queryByTestId("inv-enter-input"));
    fireEvent.change(r.getByTestId("inv-enter-input"), { target: { value: "friend1" } });
    await until(() => !(r.getByTestId("inv-enter-save") as HTMLButtonElement).disabled);
    fireEvent.click(r.getByTestId("inv-enter-save"));
    await until(() => /already/i.test(r.getByTestId("inv-enter-state").textContent || ""));
    const before = reads();
    await tick(1499);
    expect(reads()).toBe(before);
    await tick(1);
    expect(reads()).toBe(before + 1);
    await tick(60_000);
    expect(reads()).toBe(before + 1);
  });
  it("a refusal that is NOT 'already linked / already paid' starts no wait (nothing is read again)", async () => {
    answers = { my_referral_summary: summary({ code: "MINE1", can_enter_code: true }), check_invite_code: true, claim_referral: { ok: false, reason: "self" } }; route();
    const r = view();
    await until(() => r.queryByTestId("inv-enter-input"));
    fireEvent.change(r.getByTestId("inv-enter-input"), { target: { value: "friend1" } });
    await until(() => !(r.getByTestId("inv-enter-save") as HTMLButtonElement).disabled);
    fireEvent.click(r.getByTestId("inv-enter-save"));
    await until(() => rpc.mock.calls.some((c) => c[0] === "claim_referral"));
    await tick(0);
    const before = reads();
    await tick(60_000);
    expect(reads()).toBe(before);
  });
  it("the Share-the-app note stays 2.5 seconds", async () => {
    answers = { my_referral_summary: summary({ code: "ABCD" }) }; route(); clipboard();
    const r = view();
    await until(() => r.queryByTestId("inv-code"));
    fireEvent.click(r.getByTestId("inv-share-app"));
    await until(() => r.queryByText("Link copied"));
    await tick(2499);
    expect(r.queryByText("Link copied")).not.toBeNull();
    await tick(1);
    expect(r.queryByText("Link copied")).toBeNull();
  });
});
