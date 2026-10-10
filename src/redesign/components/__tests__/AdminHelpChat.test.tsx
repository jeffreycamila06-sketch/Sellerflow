// Admin → Help chat: stats, Tab A batch approve, Tab B answer boxes (save / skip / Save-as-FAQ
// default per type), FAQ list (on/off, edit, needs re-check filter).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";

const rpc = vi.fn();
const faqRows = vi.fn();
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ order: () => ({ limit: async () => faqRows() }) }) }),
  },
}));

import { TProvider } from "../../i18n";
import AdminHelpChat from "../AdminHelpChat";

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, question: `Q ${id}`, answer: `A ${id}`, source: "ai", needs_admin: null, seller_rating: 0, lang: "en", created_at: "2026-10-11T00:00:00Z", total: 12, ...extra });
let queues: Record<string, unknown[]>;
beforeEach(() => {
  queues = { approve: [row("a1", { seller_rating: 1 }), row("a2"), row("a3")], answer: [row("b1", { needs_admin: "billing", source: "handoff" }), row("b2", { needs_admin: "not_covered" }), row("b3", { seller_rating: -1 })] };
  rpc.mockReset();
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "admin_support_stats") return { data: { total: 10, faq: 4, faq_ai_match: 2, ai: 3, handoff: 1, limit: 0, cost_usd: 1.234, cap_usd: 15, saved: 8 }, error: null };
    if (name === "admin_support_queue") return { data: queues[args.p_tab as string], error: null };
    if (name === "admin_support_approve_batch") return { data: (args.p_items as unknown[]).length, error: null };
    if (name === "admin_support_answer_batch") return { data: (args.p_items as unknown[]).length, error: null };
    if (name === "admin_support_faq_update") return { data: true, error: null };
    return { data: null, error: null };
  });
  faqRows.mockResolvedValue({ data: [
    { id: 1, question: "Test print?", answer: "Settings → Printer", enabled: true, needs_recheck: false, lang: "en" },
    { id: 2, question: "Old?", answer: "old", enabled: false, needs_recheck: true, lang: "en" },
  ], error: null });
});
const ui = () => render(<TProvider lang="en"><AdminHelpChat /></TProvider>);

describe("Admin Help chat", () => {
  it("stats: questions, % per type, cost vs cap, messages saved", async () => {
    const r = ui();
    const s = await r.findByTestId("hc-stats");
    expect(s.textContent).toContain("Questions: 10");
    expect(s.textContent).toContain("Free FAQ: 40%");
    expect(s.textContent).toContain("AI match: 20%");
    expect(s.textContent).toContain("Full AI: 30%");
    expect(s.textContent).toContain("Handoff: 10%");
    expect(s.textContent).toContain("Messages saved: 8");
    expect(r.getByTestId("hc-cost").textContent).toBe("Cost: $1.23 of $15.00");
  });

  it("Tab A: numbered, ✅ + Save as FAQ on by default; one button sends the whole batch and reloads", async () => {
    const r = ui();
    const rows = await r.findAllByTestId("hc-approve-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toMatch(/^1\./);
    expect(r.getAllByTestId("hc-ok").every((b) => b.textContent === "✅")).toBe(true);
    expect(r.getAllByTestId("hc-savefaq").every((c) => (c as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(r.getAllByTestId("hc-ok")[1]); // ❌ a2
    fireEvent.click(r.getAllByTestId("hc-savefaq")[2]); // a3 not as FAQ
    fireEvent.click(r.getAllByTestId("hc-edit")[0]); // edit a1
    fireEvent.change(r.getByTestId("hc-edit-a"), { target: { value: "A a1 better" } });
    await act(async () => { fireEvent.click(r.getByTestId("hc-approve-batch")); });
    expect(rpc).toHaveBeenCalledWith("admin_support_approve_batch", { p_items: [
      { id: "a1", ok: true, save_faq: true, question: "Q a1", answer: "A a1 better" },
      { id: "a2", ok: false, save_faq: true },
      { id: "a3", ok: true, save_faq: false },
    ] });
    expect((await r.findByTestId("hc-note")).textContent).toBe("Saved 3.");
    expect(rpc.mock.calls.filter((c) => c[0] === "admin_support_queue")).toHaveLength(2); // next batch loaded
  });

  it("Tab B: Save-as-FAQ off for billing, on otherwise; empty boxes are skipped", async () => {
    const r = ui();
    fireEvent.click(r.getByTestId("hc-tab-answer"));
    const boxes = await r.findAllByTestId("hc-answer-box");
    const faq = r.getAllByTestId("hc-answer-savefaq") as HTMLInputElement[];
    expect(faq.map((c) => c.checked)).toEqual([false, true, true]);
    expect(r.getAllByTestId("hc-answer-row")[0].textContent).toContain("Billing");
    expect(r.getAllByTestId("hc-answer-row")[1].textContent).toContain("Not in guide");
    expect(r.getAllByTestId("hc-answer-row")[2].textContent).toContain("Seller 👎");
    fireEvent.change(boxes[0], { target: { value: "Message on Telegram please." } });
    fireEvent.change(boxes[2], { target: { value: "  Try again.  " } });
    await act(async () => { fireEvent.click(r.getByTestId("hc-save-answers")); });
    expect(rpc).toHaveBeenCalledWith("admin_support_answer_batch", { p_items: [
      { id: "b1", answer: "Message on Telegram please.", save_faq: false },
      { id: "b3", answer: "Try again.", save_faq: true },
    ] });
  });

  it("Tab B: all boxes empty → nothing sent", async () => {
    const r = ui();
    fireEvent.click(r.getByTestId("hc-tab-answer"));
    await r.findAllByTestId("hc-answer-box");
    fireEvent.click(r.getByTestId("hc-save-answers"));
    expect(rpc).not.toHaveBeenCalledWith("admin_support_answer_batch", expect.anything());
  });

  it("FAQ list: needs-re-check filter, on/off, edit", async () => {
    const r = ui();
    fireEvent.click(r.getByTestId("hc-tab-faq"));
    expect(await r.findAllByTestId("hc-faq-row")).toHaveLength(2);
    fireEvent.click(r.getByTestId("hc-recheck-filter"));
    expect(r.getAllByTestId("hc-faq-row")).toHaveLength(1);
    expect(r.getByTestId("hc-recheck-tag")).toBeTruthy();
    fireEvent.click(r.getByTestId("hc-recheck-filter"));
    await act(async () => { fireEvent.click(r.getAllByTestId("hc-faq-toggle")[0]); });
    expect(rpc).toHaveBeenCalledWith("admin_support_faq_update", { p_id: 1, p_question: null, p_answer: null, p_enabled: false });
    fireEvent.click(r.getAllByTestId("hc-faq-edit")[0]);
    fireEvent.change(r.getByTestId("hc-faq-edit-a"), { target: { value: "New answer" } });
    await act(async () => { fireEvent.click(r.getByTestId("hc-faq-save")); });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_support_faq_update", { p_id: 1, p_question: "Test print?", p_answer: "New answer", p_enabled: null }));
  });

  it("a failed save shows an error and keeps the batch", async () => {
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "admin_support_queue") return { data: queues[args.p_tab as string], error: null };
      if (name === "admin_support_approve_batch") return { data: null, error: { message: "x" } };
      return { data: null, error: null };
    });
    const r = ui();
    await r.findAllByTestId("hc-approve-row");
    await act(async () => { fireEvent.click(r.getByTestId("hc-approve-batch")); });
    expect(r.getByTestId("hc-note").textContent).toBe("Couldn't save. Try again.");
    expect(r.getAllByTestId("hc-approve-row")).toHaveLength(3);
  });
});
