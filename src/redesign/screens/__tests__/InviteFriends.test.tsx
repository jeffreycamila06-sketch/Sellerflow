// Settings → Invite friends (sql/164): choose a code once (own word or random, in-page warning),
// then the code BIG + Copy + Share + this month's line + the invites list; "Enter code" box only
// while allowed. iPhone app: no prices, no buy links, no "subscribe" / "paid plan" wording.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import InviteFriends from "../InviteFriends";
import { TProvider } from "../../i18n";

const summary = (over: Record<string, unknown> = {}) => ({ code: null, month_days: 0, eligible: true, has_inviter: false, can_enter_code: false, invites: [], ...over });
// rpc router: summary + per-name answers
let answers: Record<string, unknown> = {};
const route = () => rpc.mockImplementation(async (name: string) => ({ data: typeof answers[name] === "function" ? (answers[name] as () => unknown)() : answers[name], error: null }));
const renderIt = (ios = false, lang = "en") => render(<TProvider lang={lang}><InviteFriends onBack={() => {}} ios={ios} /></TProvider>);
const confirmSpy = vi.spyOn(window, "confirm");

beforeEach(() => { rpc.mockReset(); answers = {}; confirmSpy.mockClear(); });
afterEach(() => { delete (navigator as unknown as { share?: unknown }).share; });

describe("no code yet → choose once", () => {
  it("live check, in-page warning, then save (no browser confirm)", async () => {
    answers = { my_referral_summary: summary(), invite_code_available: "", set_my_invite_code: { ok: true, code: "BUDGETUKAY" } };
    route();
    renderIt();
    const input = await screen.findByTestId("inv-code-input");
    fireEvent.change(input, { target: { value: "budget ukay!" } });
    expect((input as HTMLInputElement).value).toBe("BUDGETUKAY");
    await waitFor(() => expect(screen.getByTestId("inv-code-state").textContent).toMatch(/Available/), { timeout: 2000 });
    expect(screen.getByText(/can't be changed after you save it/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("inv-save"));
    expect(screen.getByTestId("inv-confirm").textContent).toMatch(/Save BUDGETUKAY as your invite code\? It can't be changed later\./);
    answers.my_referral_summary = summary({ code: "BUDGETUKAY" });
    fireEvent.click(screen.getByTestId("inv-confirm-yes"));
    await waitFor(() => expect(screen.getByTestId("inv-code").textContent).toBe("BUDGETUKAY"));
    expect(rpc).toHaveBeenCalledWith("set_my_invite_code", { p_code: "BUDGETUKAY" });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("inv-choose")).toBeNull(); // no change button, ever
  });

  it("taken / reserved shown, Save off", async () => {
    answers = { my_referral_summary: summary(), invite_code_available: "reserved" };
    route();
    renderIt();
    fireEvent.change(await screen.findByTestId("inv-code-input"), { target: { value: "admin" } });
    await waitFor(() => expect(screen.getByTestId("inv-code-state").textContent).toMatch(/can't be used/), { timeout: 2000 });
    expect((screen.getByTestId("inv-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("full-width typing (Chinese keyboard) becomes plain letters in the box", async () => {
    answers = { my_referral_summary: summary(), invite_code_available: "" };
    route();
    renderIt();
    const input = await screen.findByTestId("inv-code-input");
    fireEvent.change(input, { target: { value: "ｂｕｄｇｅｔ１" } });
    expect((input as HTMLInputElement).value).toBe("BUDGET1");
  });

  it("random code fills 6 characters", async () => {
    answers = { my_referral_summary: summary(), invite_code_available: "" };
    route();
    renderIt();
    fireEvent.click(await screen.findByTestId("inv-random"));
    expect((screen.getByTestId("inv-code-input") as HTMLInputElement).value).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("too short → format hint, never asks the database", async () => {
    answers = { my_referral_summary: summary() };
    route();
    renderIt();
    fireEvent.change(await screen.findByTestId("inv-code-input"), { target: { value: "ab" } });
    expect(screen.getByTestId("inv-code-state").textContent).toMatch(/4–12/);
    await new Promise((r) => setTimeout(r, 500));
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["my_referral_summary"]);
  });
});

describe("has a code", () => {
  const rows = [
    { email: "ann…", status: "linked", days: 0, date: "2026-11-10T00:00:00Z" },
    { email: "bob…", status: "rewarded", days: 10, date: "2026-11-11T00:00:00Z" },
    { email: "cel…", status: "no_reward", days: 0, date: "2026-11-12T00:00:00Z" },
  ];
  it("big code, month line, invites with pills, share = code only", async () => {
    answers = { my_referral_summary: summary({ code: "BUDGETUKAY", month_days: 10, invites: rows }) };
    route();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
    renderIt();
    expect((await screen.findByTestId("inv-code")).textContent).toBe("BUDGETUKAY");
    expect(screen.getByTestId("inv-month").textContent).toBe("This month: +10 free days for every friend who subscribes.");
    expect(screen.getAllByTestId("inv-row")).toHaveLength(3);
    expect(screen.getByText("Signed up")).toBeTruthy();
    expect(screen.getByText("+10 days")).toBeTruthy();
    expect(screen.getByText("Paid · no reward")).toBeTruthy();
    fireEvent.click(screen.getByTestId("inv-share"));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ text: "Use my SellerFlowLive invite code: BUDGETUKAY" }));
  });

  it("share text follows the app language", async () => {
    answers = { my_referral_summary: summary({ code: "ABCD12" }) };
    route();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
    renderIt(false, "zh-TW");
    fireEvent.click(await screen.findByTestId("inv-share"));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ text: "使用我的 SellerFlowLive 邀請碼：ABCD12" }));
  });

  it("copy → Copied", async () => {
    answers = { my_referral_summary: summary({ code: "ABCD" }) };
    route();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
    renderIt();
    fireEvent.click(await screen.findByTestId("inv-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ABCD"));
    expect(await screen.findByText("Copied")).toBeTruthy();
  });

  it("month 0 → no month line; free/expired → the paid-only note", async () => {
    answers = { my_referral_summary: summary({ code: "ABCD", month_days: 0, eligible: false }) };
    route();
    renderIt();
    await screen.findByTestId("inv-code");
    expect(screen.queryByTestId("inv-month")).toBeNull();
    expect(screen.getByTestId("inv-paid-only").textContent).toBe("Free days from invites are for paid plans only.");
  });

  it("iPhone app: no price, no buy link, no subscribe / paid-plan words", async () => {
    answers = { my_referral_summary: summary({ code: "ABCD", month_days: 10, eligible: false, invites: rows }) };
    route();
    const { container } = renderIt(true);
    await screen.findByTestId("inv-code");
    const text = container.textContent!.toLowerCase();
    for (const bad of ["subscri", "paid", "price", "nt$", "$", "upgrade", "buy", "plan"]) expect(text, bad).not.toContain(bad);
    expect(container.querySelectorAll("a").length).toBe(0);
  });
});

describe("Invited by a friend? Enter code", () => {
  it("hidden when not allowed", async () => {
    answers = { my_referral_summary: summary({ code: "ABCD", can_enter_code: false }) };
    route();
    renderIt();
    await screen.findByTestId("inv-code");
    expect(screen.queryByTestId("inv-enter")).toBeNull();
  });
  it("shown when allowed; found → saved → box hides", async () => {
    answers = { my_referral_summary: summary({ code: "MINE1", can_enter_code: true }), check_invite_code: true, claim_referral: { ok: true } };
    route();
    renderIt();
    fireEvent.change(await screen.findByTestId("inv-enter-input"), { target: { value: "friend1" } });
    await waitFor(() => expect(screen.getByTestId("inv-enter-state").textContent).toBe("Code found ✓"), { timeout: 2000 });
    answers.my_referral_summary = summary({ code: "MINE1", can_enter_code: false });
    fireEvent.click(screen.getByTestId("inv-enter-save"));
    await waitFor(() => expect(screen.getByTestId("inv-enter-state").textContent).toMatch(/saved/));
    expect(rpc).toHaveBeenCalledWith("claim_referral", { p_code: "FRIEND1", p_source: "settings" });
    await waitFor(() => expect(screen.queryByTestId("inv-enter")).toBeNull(), { timeout: 3000 });
  });
  it("not found → Add code off; self → the message", async () => {
    answers = { my_referral_summary: summary({ code: "MINE1", can_enter_code: true }), check_invite_code: false };
    route();
    renderIt();
    fireEvent.change(await screen.findByTestId("inv-enter-input"), { target: { value: "nope99" } });
    await waitFor(() => expect(screen.getByTestId("inv-enter-state").textContent).toBe("Code not found"), { timeout: 2000 });
    expect((screen.getByTestId("inv-enter-save") as HTMLButtonElement).disabled).toBe(true);
    answers.check_invite_code = true; answers.claim_referral = { ok: false, reason: "self" };
    fireEvent.change(screen.getByTestId("inv-enter-input"), { target: { value: "MINE1" } });
    await waitFor(() => expect(screen.getByTestId("inv-enter-state").textContent).toBe("Code found ✓"), { timeout: 2000 });
    await act(async () => { fireEvent.click(screen.getByTestId("inv-enter-save")); });
    await waitFor(() => expect(screen.getByTestId("inv-enter-state").textContent).toBe("That's your own code."));
  });
});

it("load failure → honest message + retry (never a blank screen)", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "no function" } });
  renderIt();
  expect((await screen.findByTestId("inv-error")).textContent).toMatch(/Couldn't load/);
  expect(screen.getByTestId("inv-share-app")).toBeTruthy();
});

it("every language has the screen's words", async () => {
  for (const lang of ["fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
    answers = { my_referral_summary: summary() };
    route();
    const { unmount } = renderIt(false, lang);
    const el = await screen.findByTestId("inv-choose");
    expect(el.textContent).not.toMatch(/rd_ref_/);
    unmount();
  }
});
