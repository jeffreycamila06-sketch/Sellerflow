// Help bot (sql/116): the Settings bubble (drag / tap / snap / saved position / dot / pulse),
// the chat panel (quick questions, Saved answer, 👍/👎, contact buttons, Admin answered), and
// the Settings wiring (bubble only for preview; "Need help?" kept for everyone else).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } },
}));

import { TProvider } from "../../i18n";
import HelpBot from "../HelpBot";
import SettingsHub from "../../screens/SettingsHub";
import {
  snapPos, clampY, defaultPos, loadBubblePos, saveBubblePos, helpBotVisible, loadHelpBotSwitch, BUBBLE, saveFaqDefault, answerItems, pct, type Box,
} from "../../adapters/helpBot";

const BOX: Box = { w: 375, h: 700, top: 80, bottom: 70 };
let rpcAnswers: Record<string, unknown>;
beforeEach(() => {
  localStorage.clear();
  rpcAnswers = { support_admin_answers: [], support_quick_questions: [], support_rate: true, support_admin_answers_seen: 1 };
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) => ({ data: rpcAnswers[name] ?? null, error: null }));
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });
});
const ui = (node: React.ReactNode) => render(<TProvider lang="en">{node}</TProvider>);
const answerWith = (body: Record<string, unknown>, status = 200) =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: status < 400, status, json: async () => body });

describe("bubble position math", () => {
  it("snaps to the nearer edge and stays between header and bottom bar", () => {
    expect(snapPos(10, 300, BOX)).toEqual({ side: "left", y: 300 });
    expect(snapPos(300, 300, BOX)).toEqual({ side: "right", y: 300 });
    expect(snapPos(300, 0, BOX).y).toBe(88); // never over the header
    expect(snapPos(300, 9999, BOX).y).toBe(700 - 70 - BUBBLE - 8);
    expect(clampY(50, BOX)).toBe(88);
  });
  it("default = bottom-right", () => {
    expect(defaultPos(BOX)).toEqual({ side: "right", y: 700 - 70 - BUBBLE - 16 });
  });
  it("saved position survives; broken / blocked storage falls back", () => {
    saveBubblePos({ side: "left", y: 222 });
    expect(loadBubblePos()).toEqual({ side: "left", y: 222 });
    localStorage.setItem("sfl_rd_helpbot_pos", "{bad");
    expect(loadBubblePos()).toBeNull();
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadBubblePos()).toBeNull();
    spy.mockRestore();
  });
});

describe("who sees the bubble", () => {
  it("switch on AND (preview or admin)", () => {
    expect(helpBotVisible(true, true, false)).toBe(true);
    expect(helpBotVisible(true, false, true)).toBe(true);
    expect(helpBotVisible(true, false, false)).toBe(false);
    expect(helpBotVisible(false, true, true)).toBe(false);
  });
  it("the switch read fails closed", async () => {
    expect(await loadHelpBotSwitch()).toBe(false); // the mock has no table access → error → off
  });
  const noop = () => {};
  const base = { onGeneral: noop, onCustomers: noop, onAdmin: noop, onCustomerData: noop, onLegal: noop, onDelete: noop, onLogout: noop };
  it("preview seller: bubble on Settings, the Need help? tile is gone", () => {
    const r = ui(<SettingsHub {...base} helpBot />);
    expect(r.getByTestId("helpbot-bubble")).toBeTruthy();
    expect(r.queryByTestId("help-card")).toBeNull();
  });
  it("everyone else: today's Need help? tile, no bubble", () => {
    const r = ui(<SettingsHub {...base} />);
    expect(r.getByTestId("help-card")).toBeTruthy();
    expect(r.queryByTestId("helpbot-bubble")).toBeNull();
    fireEvent.click(r.getByTestId("help-card"));
    expect(r.getByTestId("support-modal")).toBeTruthy();
  });
});

describe("bubble gestures", () => {
  const press = (el: Element, x: number, y: number) => fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1 });
  const move = (el: Element, x: number, y: number) => fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 });
  const up = (el: Element, x: number, y: number) => fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });

  it("a press that moves less than 6 px is a tap → opens the chat", async () => {
    const r = ui(<HelpBot />);
    const b = r.getByTestId("helpbot-bubble");
    press(b, 340, 500); move(b, 343, 502); up(b, 343, 502);
    expect(await r.findByTestId("helpbot-chat")).toBeTruthy();
  });
  it("a drag snaps to the left edge and saves the position", () => {
    const r = ui(<HelpBot />);
    const b = r.getByTestId("helpbot-bubble");
    expect(b.getAttribute("data-side")).toBe("right");
    press(b, 340, 500); move(b, 200, 400); move(b, 40, 300); up(b, 40, 300);
    expect(r.queryByTestId("helpbot-chat")).toBeNull();
    expect(b.getAttribute("data-side")).toBe("left");
    expect(loadBubblePos()?.side).toBe("left");
  });
  it("opens where it was saved", () => {
    saveBubblePos({ side: "left", y: 300 });
    const r = ui(<HelpBot />);
    const b = r.getByTestId("helpbot-bubble") as HTMLElement;
    expect(b.getAttribute("data-side")).toBe("left");
    expect(b.style.top).toBe("300px");
  });
  it("one pulse class, none with reduced motion", () => {
    expect(ui(<HelpBot />).getByTestId("helpbot-bubble").className).toBe("sfl-hb-pulse");
  });
  it("no pulse when motion is off", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: (q: string) => ({ matches: q.includes("reduce"), media: q }) });
    expect(ui(<HelpBot />).getByTestId("helpbot-bubble").className).toBe("");
    Reflect.deleteProperty(window, "matchMedia");
    const root = document.createElement("div");
    root.setAttribute("data-redesign", "");
    root.setAttribute("data-motion", "off");
    document.body.appendChild(root);
    ui(<HelpBot />);
    expect(root.querySelector("[data-testid=helpbot-bubble]")?.className).toBe("");
    root.remove();
  });
});

describe("chat panel", () => {
  const openChat = async () => {
    const r = ui(<HelpBot />);
    const b = r.getByTestId("helpbot-bubble");
    fireEvent.pointerDown(b, { clientX: 1, clientY: 1 }); fireEvent.pointerUp(b, { clientX: 1, clientY: 1 });
    await r.findByTestId("helpbot-chat");
    return r;
  };
  const ask = async (r: Awaited<ReturnType<typeof openChat>>, q: string) => {
    fireEvent.change(r.getByTestId("helpbot-input"), { target: { value: q } });
    await act(async () => { fireEvent.click(r.getByTestId("helpbot-send")); });
  };

  it("start screen: greeting + starter questions, no contact buttons", async () => {
    const r = await openChat();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("support_quick_questions", { p_lang: "en", p_limit: 6 }));
    expect(r.getAllByTestId("helpbot-quick-q").map((b) => b.textContent)).toContain("My printer is not printing");
    expect(r.queryByTestId("helpbot-contact")).toBeNull();
    expect(r.queryByTestId("helpbot-telegram")).toBeNull();
  });
  it("quick questions come from the most-used FAQ when there are any", async () => {
    rpcAnswers.support_quick_questions = [{ question: "How to reprint?" }, { question: "Bluetooth off?" }];
    const r = await openChat();
    await waitFor(() => expect(r.getAllByTestId("helpbot-quick-q").map((b) => b.textContent)).toEqual(["How to reprint?", "Bluetooth off?"]));
  });
  it("tapping a quick question asks it; typing… shows; FAQ answer gets the Saved label + contact row", async () => {
    let resolve!: (v: unknown) => void;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((res) => { resolve = res; }));
    const r = await openChat();
    await act(async () => { fireEvent.click(r.getAllByTestId("helpbot-quick-q")[0]); });
    expect(r.getByTestId("helpbot-typing")).toBeTruthy();
    await act(async () => { resolve({ ok: true, status: 200, json: async () => ({ success: true, id: "c1", source: "faq", answer: "Do this.", saved: true, contact: false }) }); });
    expect(r.queryByTestId("helpbot-typing")).toBeNull();
    expect(r.getByTestId("helpbot-saved").textContent).toBe("Saved answer");
    expect(r.getByTestId("helpbot-contact").textContent).toContain("Still not fixed? Message Admin");
    const body = JSON.parse(((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as { body: string }).body);
    expect(body).toEqual({ question: "How do I connect TikTok?", lang: "en" });
  });
  it("AI answer: no Saved label; 👍 rates the chat; tapping again clears it", async () => {
    answerWith({ success: true, id: "c2", source: "ai", answer: "Steps…", saved: false, contact: false });
    const r = await openChat();
    await ask(r, "printer?");
    expect(r.queryByTestId("helpbot-saved")).toBeNull();
    fireEvent.click(r.getByTestId("helpbot-up"));
    expect(rpc).toHaveBeenCalledWith("support_rate", { p_chat_id: "c2", p_rating: 1 });
    fireEvent.click(r.getByTestId("helpbot-up"));
    expect(rpc).toHaveBeenLastCalledWith("support_rate", { p_chat_id: "c2", p_rating: 0 });
    fireEvent.click(r.getByTestId("helpbot-down"));
    expect(rpc).toHaveBeenLastCalledWith("support_rate", { p_chat_id: "c2", p_rating: -1 });
  });
  it("handoff and limit: localized text + contact buttons at once, no rating", async () => {
    answerWith({ success: true, id: "c3", source: "handoff", answer: "x", contact: true });
    const r = await openChat();
    await ask(r, "refund");
    expect(r.getAllByTestId("helpbot-msg-bot")[0].textContent).toContain("Admin will help you with this");
    expect(r.getByTestId("helpbot-telegram").getAttribute("href")).toBe("https://t.me/SellerFlowLive");
    expect(r.queryByTestId("helpbot-up")).toBeNull();
    answerWith({ success: true, id: "c4", source: "limit", answer: "x", contact: true });
    await ask(r, "another");
    expect(r.getAllByTestId("helpbot-msg-bot")[1].textContent).toContain("busy for now");
    expect(r.getAllByTestId("helpbot-contact")).toHaveLength(1); // only under the newest answer
  });
  it("friendly errors", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));
    const r = await openChat();
    await ask(r, "hello");
    expect(r.getByTestId("helpbot-msg-bot").textContent).toContain("Can't reach the help chat");
  });
  it("no LINE button while there is no LINE link", async () => {
    answerWith({ success: true, id: "c5", source: "ai", answer: "x" });
    const r = await openChat();
    await ask(r, "x");
    expect(r.queryByTestId("helpbot-line")).toBeNull();
  });
});

describe("Admin answered", () => {
  it("dot on the bubble until read; shown in the chat; then marked seen", async () => {
    rpcAnswers.support_admin_answers = [{ id: "a1", question: "Lazada?", admin_answer: "Not yet.", admin_answered_at: "2026-10-11T00:00:00Z", seen: false }];
    const r = ui(<HelpBot />);
    expect(await r.findByTestId("helpbot-dot")).toBeTruthy();
    const b = r.getByTestId("helpbot-bubble");
    expect(b.getAttribute("aria-label")).toContain("New reply from Admin");
    fireEvent.pointerDown(b, { clientX: 1, clientY: 1 }); fireEvent.pointerUp(b, { clientX: 1, clientY: 1 });
    const msg = await r.findByTestId("helpbot-msg-admin");
    expect(msg.textContent).toContain("Admin answered:");
    expect(msg.textContent).toContain("Not yet.");
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("support_admin_answers_seen"));
    fireEvent.click(r.getByTestId("helpbot-close"));
    expect(r.queryByTestId("helpbot-dot")).toBeNull();
  });
  it("already-seen answers: no dot, nothing marked", async () => {
    rpcAnswers.support_admin_answers = [{ id: "a1", question: "q", admin_answer: "a", admin_answered_at: "x", seen: true }];
    const r = ui(<HelpBot />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("support_admin_answers"));
    expect(r.queryByTestId("helpbot-dot")).toBeNull();
  });
  it("the answers come only from the seller's own RPC (server-scoped to auth.uid())", async () => {
    ui(<HelpBot />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("support_admin_answers"));
    expect(rpc.mock.calls.find((c) => c[0] === "support_admin_answers")).toEqual(["support_admin_answers"]); // no user id sent
  });
});

describe("admin helpers", () => {
  it("Save as FAQ default: off for billing, on otherwise", () => {
    expect(saveFaqDefault({ needs_admin: "billing" })).toBe(false);
    expect(saveFaqDefault({ needs_admin: "not_covered" })).toBe(true);
    expect(saveFaqDefault({ needs_admin: null })).toBe(true);
  });
  it("empty answer boxes are skipped", () => {
    expect(answerItems([{ id: "a", answer: " ", save_faq: true }, { id: "b", answer: " hi ", save_faq: false }])).toEqual([{ id: "b", answer: "hi", save_faq: false }]);
  });
  it("pct", () => { expect(pct(1, 3)).toBe(33); expect(pct(1, 0)).toBe(0); });
});
