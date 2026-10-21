// Audit Oct 22 (8) — help bot: in-flight questions count against the limits and a failed chat
// save still records the cost row.
import { describe, it, expect, vi } from "vitest";
import { answerQuestion, MAX_IN_FLIGHT_TOTAL, CLASSIFIER_PROMPT, OUTPUT_CHECK_PROMPT, LIMIT_ANSWER } from "../../../../server/helpBot.js";

function deps(over: Partial<Record<string, unknown>> = {}) {
  const saved: Record<string, unknown>[] = [];
  const logs: string[] = [];
  const d = {
    settings: { capUsd: 15, dailyPerSeller: 20 },
    matchFaq: vi.fn(async () => null),
    usage: vi.fn(async () => ({ day_count: 0, month_cost: 0 })),
    faqs: vi.fn(async () => []),
    guide: vi.fn(async () => [{ id: "printer", title: "Printer", checked: "2026-10-01", keywords: "print", body: "Tap Print." }]),
    callModel: vi.fn(async (a: { system: string; maxTokens: number }) => {
      if (a.system === CLASSIFIER_PROMPT) return { ok: true, text: "HOWTO", usage: { input_tokens: 150, output_tokens: 2 } };
      if (a.system === OUTPUT_CHECK_PROMPT) return { ok: true, text: "NO", usage: { input_tokens: 120, output_tokens: 1 } };
      return { ok: true, text: "Tap Print.", usage: { input_tokens: 1000, output_tokens: 80 } };
    }),
    save: vi.fn(async (row: Record<string, unknown>) => { saved.push(row); return `id-${saved.length}`; }),
    log: (s: string) => logs.push(s),
    ...over,
  };
  return { d, saved, logs };
}
const ask = (d: ReturnType<typeof deps>["d"], inFlight?: { seller: number; total: number }) =>
  answerQuestion({ userId: "u1", question: "how do I print the sticker?", appLang: "en", inFlight }, d as never) as Promise<{ source: string; answer: string; id: string | null; saved: boolean }>;

describe("(8) in-flight questions", () => {
  it("other questions of the same seller still in flight count against the daily limit → limit, no AI", async () => {
    const { d } = deps({ usage: vi.fn(async () => ({ day_count: 19, month_cost: 0 })) });
    const r = await ask(d, { seller: 1, total: 1 });
    expect(r.source).toBe("limit");
    expect(r.answer).toBe(LIMIT_ANSWER);
    expect(d.callModel).not.toHaveBeenCalled();
    const ok = await ask(deps({ usage: vi.fn(async () => ({ day_count: 19, month_cost: 0 })) }).d, { seller: 0, total: 0 });
    expect(ok.source).toBe("ai");
  });
  it(`more than ${MAX_IN_FLIGHT_TOTAL} questions in flight across all sellers → limit`, async () => {
    const { d } = deps();
    expect((await ask(d, { seller: 0, total: MAX_IN_FLIGHT_TOTAL })).source).toBe("limit");
    expect(d.callModel).not.toHaveBeenCalled();
    expect((await ask(deps().d, { seller: 0, total: MAX_IN_FLIGHT_TOTAL - 1 })).source).toBe("ai");
  });
  it("omitted inFlight → today's behaviour", async () => {
    expect((await ask(deps().d)).source).toBe("ai");
  });
  it("chat save fails after the AI answered → the cost row is still recorded, the seller still gets the answer", async () => {
    let calls = 0;
    const save = vi.fn(async (_row: Record<string, unknown>) => { calls++; if (calls === 1) throw Object.assign(new Error("boom"), { code: "23514" }); return "cost-1"; });
    const { d, logs } = deps({ save });
    const r = await ask(d);
    expect(r.answer).toBe("Tap Print.");
    expect(r.saved).toBe(false);
    expect(r.id).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
    const costRow = save.mock.calls[1][0];
    expect(costRow).toMatchObject({ user_id: "u1", question: "[unsaved]", source: "ai", model: expect.any(String) });
    expect(Number(costRow.cost_usd)).toBeGreaterThan(0);
    expect(costRow.answer).toBeUndefined();
    expect(logs.some((l) => l.startsWith("[SUPPORT] save_fail code=23514"))).toBe(true);
    for (const l of logs) expect(l).not.toMatch(/print the sticker|Tap Print/);
  });
  it("a save failure on a no-AI answer (handoff) records nothing twice and still answers", async () => {
    const save = vi.fn(async () => { throw new Error("down"); });
    const { d } = deps({ save });
    const r = await answerQuestion({ userId: "u1", question: "Can I get a refund?", appLang: "en" }, d as never) as { source: string; id: string | null };
    expect(r.source).toBe("handoff");
    expect(r.id).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
